package provider

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/payment"
)

const (
	jeepayHTTPTimeout     = 10 * time.Second
	maxJeepayResponseSize = 1 << 20

	jeepayAPIVersion = "1.0"
	jeepaySignType   = "MD5"

	jeepayStatePending    = 0
	jeepayStateProcessing = 1
	jeepayStateSuccess    = 2
	jeepayStateFailed     = 3
	jeepayStateClosed     = 4
	jeepayStateRefunded   = 5
)

// Jeepay implements payment.Provider for the Jeepay aggregation gateway.
type Jeepay struct {
	instanceID string
	config     map[string]string
	httpClient *http.Client
}

// NewJeepay creates a Jeepay provider.
// Required config keys: mchNo, appId, apiKey, apiBase.
// Optional config keys: currency, notifyUrl, returnUrl, refundNotifyUrl,
// alipayWayCode, wxpayWayCode, paypalWayCode.
func NewJeepay(instanceID string, config map[string]string) (*Jeepay, error) {
	for _, key := range []string{"mchNo", "appId", "apiKey", "apiBase"} {
		if strings.TrimSpace(config[key]) == "" {
			return nil, fmt.Errorf("jeepay config missing required key: %s", key)
		}
	}
	cfg := make(map[string]string, len(config)+1)
	for k, v := range config {
		cfg[k] = v
	}
	cfg["apiBase"] = normalizeJeepayAPIBase(cfg["apiBase"])
	if strings.TrimSpace(cfg["currency"]) == "" {
		cfg["currency"] = payment.DefaultPaymentCurrency
	}
	return &Jeepay{
		instanceID: instanceID,
		config:     cfg,
		httpClient: &http.Client{Timeout: jeepayHTTPTimeout},
	}, nil
}

func normalizeJeepayAPIBase(apiBase string) string {
	base := strings.TrimSpace(apiBase)
	if base == "" {
		return ""
	}
	if parsed, err := url.Parse(base); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		parsed.RawQuery = ""
		parsed.Fragment = ""
		parsed.RawPath = ""
		parsed.Path = strings.TrimRight(parsed.Path, "/")
		for _, suffix := range []string{"/api/pay/unifiedOrder", "/api/pay/query", "/api/refund/refundOrder"} {
			if strings.HasSuffix(strings.ToLower(parsed.Path), strings.ToLower(suffix)) {
				parsed.Path = strings.TrimRight(parsed.Path[:len(parsed.Path)-len(suffix)], "/")
				break
			}
		}
		return strings.TrimRight(parsed.String(), "/")
	}
	return strings.TrimRight(base, "/")
}

func (j *Jeepay) Name() string        { return "Jeepay" }
func (j *Jeepay) ProviderKey() string { return payment.TypeJeepay }
func (j *Jeepay) SupportedTypes() []payment.PaymentType {
	return []payment.PaymentType{payment.TypeAlipay, payment.TypeWxpay, payment.TypePaypal}
}

func (j *Jeepay) MerchantIdentityMetadata() map[string]string {
	if j == nil {
		return nil
	}
	metadata := map[string]string{}
	if mchNo := strings.TrimSpace(j.config["mchNo"]); mchNo != "" {
		metadata["mchNo"] = mchNo
	}
	if appID := strings.TrimSpace(j.config["appId"]); appID != "" {
		metadata["appId"] = appID
	}
	if currency := strings.TrimSpace(j.config["currency"]); currency != "" {
		metadata["currency"] = strings.ToUpper(currency)
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

func (j *Jeepay) CreatePayment(ctx context.Context, req payment.CreatePaymentRequest) (*payment.CreatePaymentResponse, error) {
	amount, err := jeepayAmountToCents(req.Amount)
	if err != nil {
		return nil, err
	}
	notifyURL, returnURL := j.resolveURLs(req)
	payload := map[string]any{
		"mchNo":      j.config["mchNo"],
		"appId":      j.config["appId"],
		"mchOrderNo": req.OrderID,
		"wayCode":    j.resolveWayCode(req.PaymentType),
		"amount":     amount,
		"currency":   strings.ToLower(strings.TrimSpace(j.config["currency"])),
		"clientIp":   req.ClientIP,
		"subject":    req.Subject,
		"body":       req.Subject,
		"notifyUrl":  notifyURL,
		"returnUrl":  returnURL,
		"reqTime":    jeepayUnixMilli(),
		"version":    jeepayAPIVersion,
		"signType":   jeepaySignType,
	}
	if channelExtra := j.channelExtra(req.PaymentType); channelExtra != "" {
		payload["channelExtra"] = channelExtra
	}
	payload["sign"] = jeepaySign(anyToJeepaySignMap(payload), j.config["apiKey"])

	var resp jeepayResponse[jeepayUnifiedOrderData]
	if err := j.postJSON(ctx, "/api/pay/unifiedOrder", payload, &resp); err != nil {
		return nil, fmt.Errorf("jeepay create: %w", err)
	}
	if resp.Code != 0 {
		return nil, fmt.Errorf("jeepay error: %s", resp.Msg)
	}

	out := &payment.CreatePaymentResponse{
		TradeNo:  resp.Data.PayOrderID,
		Currency: strings.ToUpper(strings.TrimSpace(resp.Data.Currency)),
	}
	if out.Currency == "" {
		out.Currency = strings.ToUpper(strings.TrimSpace(j.config["currency"]))
	}
	switch strings.ToLower(strings.TrimSpace(resp.Data.PayDataType)) {
	case "codeurl", "code_img_url", "codeimgurl":
		out.QRCode = resp.Data.PayData
		out.PayURL = resp.Data.PayData
	default:
		out.PayURL = resp.Data.PayData
	}
	return out, nil
}

func (j *Jeepay) QueryOrder(ctx context.Context, tradeNo string) (*payment.QueryOrderResponse, error) {
	payload := map[string]any{
		"mchNo":    j.config["mchNo"],
		"appId":    j.config["appId"],
		"reqTime":  jeepayUnixMilli(),
		"version":  jeepayAPIVersion,
		"signType": jeepaySignType,
	}
	if strings.HasPrefix(strings.TrimSpace(tradeNo), "P") {
		payload["payOrderId"] = tradeNo
	} else {
		payload["mchOrderNo"] = tradeNo
	}
	payload["sign"] = jeepaySign(anyToJeepaySignMap(payload), j.config["apiKey"])

	var resp jeepayResponse[jeepayQueryOrderData]
	if err := j.postJSON(ctx, "/api/pay/query", payload, &resp); err != nil {
		return nil, fmt.Errorf("jeepay query: %w", err)
	}
	if resp.Code != 0 {
		return nil, fmt.Errorf("jeepay query error: %s", resp.Msg)
	}
	return &payment.QueryOrderResponse{
		TradeNo:  firstNonEmpty(resp.Data.PayOrderID, tradeNo),
		Status:   jeepayPaymentStatus(resp.Data.State, resp.Data.OrderState),
		Amount:   jeepayCentsToAmount(resp.Data.Amount),
		Metadata: j.metadata(resp.Data.MchNo, resp.Data.AppID, resp.Data.WayCode, resp.Data.Currency),
	}, nil
}

func (j *Jeepay) VerifyNotification(_ context.Context, rawBody string, _ map[string]string) (*payment.PaymentNotification, error) {
	params, err := parseJeepayNotifyParams(rawBody)
	if err != nil {
		return nil, fmt.Errorf("jeepay parse notify: %w", err)
	}
	if !jeepayVerifySign(params, j.config["apiKey"], params["sign"]) {
		return nil, fmt.Errorf("jeepay notify sign mismatch")
	}
	if mchNo := strings.TrimSpace(params["mchNo"]); mchNo != "" && !strings.EqualFold(mchNo, strings.TrimSpace(j.config["mchNo"])) {
		return nil, fmt.Errorf("jeepay notify mchNo mismatch")
	}
	if appID := strings.TrimSpace(params["appId"]); appID != "" && !strings.EqualFold(appID, strings.TrimSpace(j.config["appId"])) {
		return nil, fmt.Errorf("jeepay notify appId mismatch")
	}
	amount, _ := strconv.ParseInt(strings.TrimSpace(params["amount"]), 10, 64)
	status := payment.ProviderStatusFailed
	if jeepayInt(params["state"], -1) == jeepayStateSuccess {
		status = payment.ProviderStatusSuccess
	}
	return &payment.PaymentNotification{
		TradeNo: params["payOrderId"],
		OrderID: params["mchOrderNo"],
		Amount:  jeepayCentsToAmount(amount),
		Status:  status,
		RawData: rawBody,
		Metadata: j.metadata(
			params["mchNo"],
			params["appId"],
			params["wayCode"],
			params["currency"],
		),
	}, nil
}

func parseJeepayNotifyParams(rawBody string) (map[string]string, error) {
	rawBody = strings.TrimSpace(rawBody)
	if rawBody == "" {
		return nil, fmt.Errorf("empty body")
	}
	if strings.HasPrefix(rawBody, "{") {
		var payload map[string]any
		if err := json.Unmarshal([]byte(rawBody), &payload); err != nil {
			return nil, err
		}
		return anyToJeepaySignMap(payload), nil
	}
	values, err := url.ParseQuery(rawBody)
	if err != nil {
		return nil, err
	}
	params := make(map[string]string, len(values))
	for key, vals := range values {
		if len(vals) > 0 {
			params[key] = vals[0]
		}
	}
	return params, nil
}

func (j *Jeepay) Refund(ctx context.Context, req payment.RefundRequest) (*payment.RefundResponse, error) {
	amount, err := jeepayAmountToCents(req.Amount)
	if err != nil {
		return nil, err
	}
	refundNo := strings.TrimSpace(req.RefundID)
	if refundNo == "" {
		refundNo = fmt.Sprintf("%s_refund_%d", firstNonEmpty(req.OrderID, req.TradeNo), jeepayUnixMilli())
	}
	payload := map[string]any{
		"mchNo":        j.config["mchNo"],
		"appId":        j.config["appId"],
		"mchRefundNo":  refundNo,
		"refundAmount": amount,
		"currency":     strings.ToLower(strings.TrimSpace(j.config["currency"])),
		"refundReason": req.Reason,
		"notifyUrl":    strings.TrimSpace(j.config["refundNotifyUrl"]),
		"clientIp":     req.ClientIP,
		"reqTime":      jeepayUnixMilli(),
		"version":      jeepayAPIVersion,
		"signType":     jeepaySignType,
	}
	if tradeNo := strings.TrimSpace(req.TradeNo); tradeNo != "" {
		payload["payOrderId"] = tradeNo
	} else {
		payload["mchOrderNo"] = strings.TrimSpace(req.OrderID)
	}
	payload["sign"] = jeepaySign(anyToJeepaySignMap(payload), j.config["apiKey"])

	var resp jeepayResponse[jeepayRefundData]
	if err := j.postJSON(ctx, "/api/refund/refundOrder", payload, &resp); err != nil {
		return nil, fmt.Errorf("jeepay refund: %w", err)
	}
	if resp.Code != 0 {
		return nil, fmt.Errorf("jeepay refund error: %s", resp.Msg)
	}
	return &payment.RefundResponse{
		RefundID: firstNonEmpty(resp.Data.RefundOrderID, resp.Data.MchRefundNo),
		Status:   jeepayRefundStatus(resp.Data.State),
	}, nil
}

func (j *Jeepay) resolveURLs(req payment.CreatePaymentRequest) (string, string) {
	notifyURL := strings.TrimSpace(req.NotifyURL)
	if notifyURL == "" {
		notifyURL = strings.TrimSpace(j.config["notifyUrl"])
	}
	returnURL := strings.TrimSpace(req.ReturnURL)
	if returnURL == "" {
		returnURL = strings.TrimSpace(j.config["returnUrl"])
	}
	return notifyURL, returnURL
}

func (j *Jeepay) resolveWayCode(paymentType string) string {
	switch payment.GetBasePaymentType(strings.TrimSpace(paymentType)) {
	case payment.TypeWxpay:
		return firstNonEmpty(j.config["wxpayWayCode"], "WX_NATIVE")
	case payment.TypePaypal:
		return firstNonEmpty(j.config["paypalWayCode"], "PP_PC")
	default:
		return firstNonEmpty(j.config["alipayWayCode"], "ALI_PC")
	}
}

func (j *Jeepay) channelExtra(paymentType string) string {
	switch payment.GetBasePaymentType(strings.TrimSpace(paymentType)) {
	case payment.TypeWxpay:
		return `{"payDataType":"codeUrl"}`
	case payment.TypeAlipay, payment.TypePaypal:
		return `{"payDataType":"payUrl"}`
	default:
		return ""
	}
}

func (j *Jeepay) metadata(mchNo, appID, wayCode, currency string) map[string]string {
	metadata := map[string]string{}
	if v := strings.TrimSpace(mchNo); v != "" {
		metadata["mchNo"] = v
	}
	if v := strings.TrimSpace(appID); v != "" {
		metadata["appId"] = v
	}
	if v := strings.TrimSpace(wayCode); v != "" {
		metadata["wayCode"] = v
	}
	if v := strings.TrimSpace(currency); v != "" {
		metadata["currency"] = strings.ToUpper(v)
	}
	return metadata
}

func (j *Jeepay) postJSON(ctx context.Context, path string, payload map[string]any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, normalizeJeepayAPIBase(j.config["apiBase"])+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := j.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxJeepayResponseSize))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http %d: %s", resp.StatusCode, string(respBody))
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return err
	}
	return nil
}

type jeepayResponse[T any] struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data T      `json:"data"`
}

type jeepayUnifiedOrderData struct {
	PayOrderID  string `json:"payOrderId"`
	MchOrderNo  string `json:"mchOrderNo"`
	OrderState  int    `json:"orderState"`
	PayDataType string `json:"payDataType"`
	PayData     string `json:"payData"`
	Currency    string `json:"currency"`
}

type jeepayQueryOrderData struct {
	PayOrderID string `json:"payOrderId"`
	MchOrderNo string `json:"mchOrderNo"`
	MchNo      string `json:"mchNo"`
	AppID      string `json:"appId"`
	WayCode    string `json:"wayCode"`
	Amount     int64  `json:"amount"`
	Currency   string `json:"currency"`
	State      int    `json:"state"`
	OrderState int    `json:"orderState"`
}

type jeepayRefundData struct {
	RefundOrderID string `json:"refundOrderId"`
	MchRefundNo   string `json:"mchRefundNo"`
	State         int    `json:"state"`
}

func jeepaySign(params map[string]string, apiKey string) string {
	keys := make([]string, 0, len(params))
	for key, value := range params {
		if strings.EqualFold(key, "sign") || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		return strings.ToLower(keys[i]) < strings.ToLower(keys[j])
	})
	var builder strings.Builder
	for _, key := range keys {
		_, _ = builder.WriteString(key)
		_, _ = builder.WriteString("=")
		_, _ = builder.WriteString(params[key])
		_, _ = builder.WriteString("&")
	}
	_, _ = builder.WriteString("key=")
	_, _ = builder.WriteString(apiKey)
	sum := md5.Sum([]byte(builder.String()))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func jeepayVerifySign(params map[string]string, apiKey string, sign string) bool {
	sign = strings.TrimSpace(sign)
	if sign == "" {
		return false
	}
	return strings.EqualFold(jeepaySign(params, apiKey), sign)
}

func anyToJeepaySignMap(in map[string]any) map[string]string {
	out := make(map[string]string, len(in))
	for key, value := range in {
		switch typed := value.(type) {
		case nil:
			out[key] = ""
		case string:
			out[key] = typed
		case int:
			out[key] = strconv.Itoa(typed)
		case int64:
			out[key] = strconv.FormatInt(typed, 10)
		case float64:
			out[key] = strconv.FormatFloat(typed, 'f', -1, 64)
		default:
			out[key] = fmt.Sprint(typed)
		}
	}
	return out
}

func jeepayUnixMilli() int64 {
	return time.Now().UnixMilli()
}

func jeepayAmountToCents(amount string) (int64, error) {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(amount), 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount: %w", err)
	}
	return int64(parsed*100 + 0.5), nil
}

func jeepayCentsToAmount(cents int64) float64 {
	return float64(cents) / 100
}

func jeepayPaymentStatus(state int, orderState int) string {
	if state == 0 {
		state = orderState
	}
	switch state {
	case jeepayStateSuccess:
		return payment.ProviderStatusPaid
	case jeepayStateFailed:
		return payment.ProviderStatusFailed
	case jeepayStateRefunded:
		return payment.ProviderStatusRefunded
	default:
		return payment.ProviderStatusPending
	}
}

func jeepayRefundStatus(state int) string {
	switch state {
	case jeepayStateSuccess:
		return payment.ProviderStatusSuccess
	case jeepayStateFailed, jeepayStateClosed:
		return payment.ProviderStatusFailed
	default:
		return payment.ProviderStatusPending
	}
}

func jeepayInt(raw string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return parsed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
