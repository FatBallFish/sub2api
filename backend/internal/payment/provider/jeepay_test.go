//go:build unit

package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/stretchr/testify/require"
)

func TestJeepayCreatePaymentPostsSignedUnifiedOrder(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/pay/unifiedOrder", r.URL.Path)
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&captured))
		require.Equal(t, "M100", captured["mchNo"])
		require.Equal(t, "APP100", captured["appId"])
		require.Equal(t, "sub2_1001", captured["mchOrderNo"])
		require.Equal(t, "ALI_PC", captured["wayCode"])
		require.Equal(t, float64(1234), captured["amount"])
		require.Equal(t, "usd", captured["currency"])
		require.Equal(t, "MD5", captured["signType"])
		require.NotEmpty(t, captured["sign"])
		require.True(t, jeepayVerifySign(anyMapToStringMap(captured), "secret", captured["sign"].(string)))

		_, _ = w.Write([]byte(`{"code":0,"msg":"SUCCESS","data":{"payOrderId":"P1001","mchOrderNo":"sub2_1001","orderState":0,"payDataType":"payUrl","payData":"https://pay.example.com/checkout"}}`))
	}))
	defer server.Close()

	prov, err := NewJeepay("inst-jeepay", map[string]string{
		"mchNo":    "M100",
		"appId":    "APP100",
		"apiKey":   "secret",
		"apiBase":  server.URL,
		"currency": "USD",
	})
	require.NoError(t, err)

	resp, err := prov.CreatePayment(context.Background(), payment.CreatePaymentRequest{
		OrderID:     "sub2_1001",
		Amount:      "12.34",
		PaymentType: payment.TypeAlipay,
		Subject:     "Credits",
		NotifyURL:   "https://merchant.example.com/api/v1/payment/webhook/jeepay",
		ReturnURL:   "https://merchant.example.com/payment/result",
		ClientIP:    "127.0.0.1",
	})
	require.NoError(t, err)
	require.Equal(t, "P1001", resp.TradeNo)
	require.Equal(t, "https://pay.example.com/checkout", resp.PayURL)
}

func TestJeepayCreatePaymentMapsWechatAndPaypalWayCodes(t *testing.T) {
	var wayCodes []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		wayCodes = append(wayCodes, payload["wayCode"].(string))
		_, _ = w.Write([]byte(`{"code":0,"msg":"SUCCESS","data":{"payOrderId":"P1001","mchOrderNo":"sub2_1001","orderState":0,"payDataType":"codeUrl","payData":"weixin://wxpay/bizpayurl"}}`))
	}))
	defer server.Close()
	prov, err := NewJeepay("inst-jeepay", jeepayTestConfig(server.URL))
	require.NoError(t, err)

	_, err = prov.CreatePayment(context.Background(), payment.CreatePaymentRequest{OrderID: "wx", Amount: "1.00", PaymentType: payment.TypeWxpay, Subject: "Wx"})
	require.NoError(t, err)
	_, err = prov.CreatePayment(context.Background(), payment.CreatePaymentRequest{OrderID: "pp", Amount: "1.00", PaymentType: payment.TypePaypal, Subject: "PayPal"})
	require.NoError(t, err)

	require.Equal(t, []string{"WX_NATIVE", "PP_PC"}, wayCodes)
}

func TestJeepayVerifyNotificationParsesSignedSuccess(t *testing.T) {
	prov, err := NewJeepay("inst-jeepay", jeepayTestConfig("https://pay.example.com"))
	require.NoError(t, err)

	params := map[string]string{
		"payOrderId":  "P1001",
		"mchNo":       "M100",
		"appId":       "APP100",
		"mchOrderNo":  "sub2_1001",
		"wayCode":     "ALI_PC",
		"amount":      "1234",
		"currency":    "usd",
		"state":       "2",
		"successTime": "1781889941000",
		"reqTime":     "1781889941000",
	}
	params["sign"] = jeepaySign(params, "secret")
	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}

	notification, err := prov.VerifyNotification(context.Background(), form.Encode(), nil)
	require.NoError(t, err)
	require.Equal(t, "P1001", notification.TradeNo)
	require.Equal(t, "sub2_1001", notification.OrderID)
	require.Equal(t, 12.34, notification.Amount)
	require.Equal(t, payment.ProviderStatusSuccess, notification.Status)
	require.Equal(t, "M100", notification.Metadata["mchNo"])
	require.Equal(t, "APP100", notification.Metadata["appId"])
}

func TestJeepayVerifyNotificationParsesJSONSuccess(t *testing.T) {
	prov, err := NewJeepay("inst-jeepay", jeepayTestConfig("https://pay.example.com"))
	require.NoError(t, err)

	params := map[string]string{
		"payOrderId": "P1002",
		"mchNo":      "M100",
		"appId":      "APP100",
		"mchOrderNo": "sub2_1002",
		"wayCode":    "PP_PC",
		"amount":     "990",
		"currency":   "usd",
		"state":      "2",
		"reqTime":    "1781889941000",
	}
	params["sign"] = jeepaySign(params, "secret")
	body, err := json.Marshal(params)
	require.NoError(t, err)

	notification, err := prov.VerifyNotification(context.Background(), string(body), nil)
	require.NoError(t, err)
	require.Equal(t, "P1002", notification.TradeNo)
	require.Equal(t, "sub2_1002", notification.OrderID)
	require.Equal(t, 9.90, notification.Amount)
	require.Equal(t, payment.ProviderStatusSuccess, notification.Status)
	require.Equal(t, "PP_PC", notification.Metadata["wayCode"])
}

func TestJeepayRefundPostsSignedRefundOrder(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/refund/refundOrder", r.URL.Path)
		require.NoError(t, json.NewDecoder(r.Body).Decode(&captured))
		require.Equal(t, "P1001", captured["payOrderId"])
		require.NotContains(t, captured, "mchOrderNo")
		require.Equal(t, "sub2_1001_refund_001", captured["mchRefundNo"])
		require.Equal(t, float64(350), captured["refundAmount"])
		require.Equal(t, "requested by user", captured["refundReason"])
		require.Equal(t, "203.0.113.10", captured["clientIp"])
		require.True(t, jeepayVerifySign(anyMapToStringMap(captured), "secret", captured["sign"].(string)))
		_, _ = w.Write([]byte(`{"code":0,"msg":"SUCCESS","data":{"refundOrderId":"R1001","mchRefundNo":"sub2_1001_refund_001","state":1}}`))
	}))
	defer server.Close()
	prov, err := NewJeepay("inst-jeepay", jeepayTestConfig(server.URL))
	require.NoError(t, err)

	resp, err := prov.Refund(context.Background(), payment.RefundRequest{
		TradeNo:  "P1001",
		OrderID:  "sub2_1001",
		RefundID: "sub2_1001_refund_001",
		Amount:   "3.50",
		Reason:   "requested by user",
		ClientIP: "203.0.113.10",
	})
	require.NoError(t, err)
	require.Equal(t, "R1001", resp.RefundID)
	require.Equal(t, payment.ProviderStatusPending, resp.Status)
}

func TestJeepayRefundFallsBackToMerchantOrderNo(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/refund/refundOrder", r.URL.Path)
		require.NoError(t, json.NewDecoder(r.Body).Decode(&captured))
		require.NotContains(t, captured, "payOrderId")
		require.Equal(t, "sub2_1001", captured["mchOrderNo"])
		require.True(t, jeepayVerifySign(anyMapToStringMap(captured), "secret", captured["sign"].(string)))
		_, _ = w.Write([]byte(`{"code":0,"msg":"SUCCESS","data":{"refundOrderId":"R1001","mchRefundNo":"sub2_1001_refund_001","state":2}}`))
	}))
	defer server.Close()
	prov, err := NewJeepay("inst-jeepay", jeepayTestConfig(server.URL))
	require.NoError(t, err)

	resp, err := prov.Refund(context.Background(), payment.RefundRequest{
		OrderID:  "sub2_1001",
		RefundID: "sub2_1001_refund_001",
		Amount:   "3.50",
		Reason:   "requested by user",
	})
	require.NoError(t, err)
	require.Equal(t, "R1001", resp.RefundID)
	require.Equal(t, payment.ProviderStatusSuccess, resp.Status)
}

func jeepayTestConfig(apiBase string) map[string]string {
	return map[string]string{
		"mchNo":    "M100",
		"appId":    "APP100",
		"apiKey":   "secret",
		"apiBase":  apiBase,
		"currency": "USD",
	}
}

func anyMapToStringMap(in map[string]any) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = strings.TrimSpace(strings.Trim(strings.ReplaceAll(strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(strings.TrimSpace(jsonScalar(v)), "\""), "\"")), "\n", ""), " "))
	}
	return out
}

func jsonScalar(v any) string {
	switch typed := v.(type) {
	case string:
		return typed
	default:
		b, _ := json.Marshal(typed)
		return string(b)
	}
}
