package provider

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/payment"
)

const (
	creemProdAPIBase = "https://api.creem.io/v1"
	creemTestAPIBase = "https://test-api.creem.io/v1"
	creemHTTPTimeout = 15 * time.Second
)

type Creem struct {
	instanceID string
	config     map[string]string
	baseURL    string
	httpClient *http.Client
}

type creemCheckoutRequest struct {
	ProductID  string            `json:"product_id"`
	RequestID  string            `json:"request_id"`
	SuccessURL string            `json:"success_url,omitempty"`
	Customer   creemCustomer     `json:"customer,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

type creemCustomer struct {
	Email string `json:"email,omitempty"`
}

type creemCheckout struct {
	ID          string          `json:"id"`
	CheckoutURL string          `json:"checkout_url"`
	RequestID   string          `json:"request_id"`
	Status      string          `json:"status"`
	Product     json.RawMessage `json:"product"`
	ProductID   string          `json:"product_id"`
	Order       *creemOrder     `json:"order"`
}

type creemOrder struct {
	ID          string          `json:"id"`
	Amount      int64           `json:"amount"`
	AmountPaid  int64           `json:"amount_paid"`
	Currency    string          `json:"currency"`
	Status      string          `json:"status"`
	Transaction json.RawMessage `json:"transaction"`
}

type creemTransaction struct {
	ID             string `json:"id"`
	Amount         int64  `json:"amount"`
	AmountPaid     int64  `json:"amount_paid"`
	Currency       string `json:"currency"`
	Status         string `json:"status"`
	RefundedAmount int64  `json:"refunded_amount"`
}

type creemRefund struct {
	ID             string           `json:"id"`
	Status         string           `json:"status"`
	RefundAmount   int64            `json:"refund_amount"`
	RefundCurrency string           `json:"refund_currency"`
	Transaction    creemTransaction `json:"transaction"`
	Checkout       creemCheckout    `json:"checkout"`
}

type creemEvent struct {
	ID        string          `json:"id"`
	EventType string          `json:"eventType"`
	Object    json.RawMessage `json:"object"`
}

// CreemProduct contains the trusted Product fields used by binding management.
type CreemProduct struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PriceMinor  int64  `json:"price"`
	Currency    string `json:"currency"`
	BillingType string `json:"billing_type"`
	Status      string `json:"status"`
	TaxMode     string `json:"tax_mode"`
}

func NewCreem(instanceID string, config map[string]string) (*Creem, error) {
	if strings.TrimSpace(config["apiKey"]) == "" {
		return nil, fmt.Errorf("creem config missing required key: apiKey")
	}
	if strings.TrimSpace(config["webhookSecret"]) == "" {
		return nil, fmt.Errorf("creem config missing required key: webhookSecret")
	}

	cfg := cloneStringMap(config)
	environment := strings.ToLower(strings.TrimSpace(cfg["environment"]))
	baseURL := creemProdAPIBase
	switch environment {
	case "", "prod", "production":
		cfg["environment"] = "prod"
	case "test":
		baseURL = creemTestAPIBase
		cfg["environment"] = "test"
	default:
		return nil, fmt.Errorf("creem config environment must be prod or test")
	}

	return &Creem{
		instanceID: instanceID,
		config:     cfg,
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: creemHTTPTimeout},
	}, nil
}

func (c *Creem) Name() string        { return "Creem" }
func (c *Creem) ProviderKey() string { return payment.TypeCreem }
func (c *Creem) SupportedTypes() []payment.PaymentType {
	return []payment.PaymentType{payment.TypeCreem}
}

func (c *Creem) MerchantIdentityMetadata() map[string]string {
	if c == nil {
		return nil
	}
	sum := sha256.Sum256([]byte(c.config["apiKey"]))
	return map[string]string{
		"environment":         c.config["environment"],
		"api_key_fingerprint": hex.EncodeToString(sum[:8]),
	}
}

func (c *Creem) CreatePayment(ctx context.Context, req payment.CreatePaymentRequest) (*payment.CreatePaymentResponse, error) {
	if strings.TrimSpace(req.ProductID) == "" {
		return nil, fmt.Errorf("creem create checkout: product ID is required")
	}
	payload := creemCheckoutRequest{
		ProductID:  req.ProductID,
		RequestID:  req.OrderID,
		SuccessURL: req.ReturnURL,
		Customer:   creemCustomer{Email: req.CustomerEmail},
		Metadata:   req.Metadata,
	}
	var checkout creemCheckout
	if err := c.doJSON(ctx, http.MethodPost, "/checkouts", nil, payload, &checkout); err != nil {
		return nil, fmt.Errorf("creem create checkout: %w", err)
	}
	if checkout.ID == "" || checkout.CheckoutURL == "" {
		return nil, fmt.Errorf("creem create checkout: response missing id or checkout_url")
	}
	return &payment.CreatePaymentResponse{
		TradeNo: checkout.ID,
		PayURL:  checkout.CheckoutURL,
	}, nil
}

func (c *Creem) QueryOrder(ctx context.Context, tradeNo string) (*payment.QueryOrderResponse, error) {
	query := url.Values{"checkout_id": []string{tradeNo}}
	var checkout creemCheckout
	if err := c.doJSON(ctx, http.MethodGet, "/checkouts", query, nil, &checkout); err != nil {
		return nil, fmt.Errorf("creem query checkout: %w", err)
	}
	return mapCreemCheckout(checkout)
}

// GetProduct fetches the current upstream Product snapshot by ID.
func (c *Creem) GetProduct(ctx context.Context, productID string) (*CreemProduct, error) {
	if strings.TrimSpace(productID) == "" {
		return nil, fmt.Errorf("creem get product: product ID is required")
	}
	query := url.Values{"product_id": []string{productID}}
	var product CreemProduct
	if err := c.doJSON(ctx, http.MethodGet, "/products", query, nil, &product); err != nil {
		return nil, fmt.Errorf("creem get product: %w", err)
	}
	product.Currency = strings.ToUpper(strings.TrimSpace(product.Currency))
	product.BillingType = strings.ToLower(strings.TrimSpace(product.BillingType))
	product.Status = strings.ToLower(strings.TrimSpace(product.Status))
	product.TaxMode = strings.ToLower(strings.TrimSpace(product.TaxMode))
	return &product, nil
}

func mapCreemCheckout(checkout creemCheckout) (*payment.QueryOrderResponse, error) {
	status := payment.ProviderStatusPending
	if checkout.Order != nil {
		switch strings.ToLower(checkout.Order.Status) {
		case "paid", "completed":
			status = payment.ProviderStatusPaid
		case "failed", "canceled", "cancelled":
			status = payment.ProviderStatusFailed
		case "refunded":
			status = payment.ProviderStatusRefunded
		}
	}
	productID := checkout.ProductID
	if productID == "" {
		productID = creemReferenceID(checkout.Product)
	}
	metadata := map[string]string{
		"order_id":    checkout.RequestID,
		"product_id":  productID,
		"checkout_id": checkout.ID,
	}
	tradeNo := checkout.ID
	amount := float64(0)
	if checkout.Order != nil {
		tradeNo = creemReferenceID(checkout.Order.Transaction)
		if tradeNo == "" {
			tradeNo = checkout.ID
		}
		metadata["currency"] = strings.ToUpper(checkout.Order.Currency)
		metadata["creem_order_id"] = checkout.Order.ID
		metadata["amount_paid_minor"] = strconv.FormatInt(checkout.Order.AmountPaid, 10)
		amount = float64(checkout.Order.Amount) / 100
	}
	return &payment.QueryOrderResponse{TradeNo: tradeNo, Status: status, Amount: amount, Metadata: metadata}, nil
}

func (c *Creem) VerifyNotification(_ context.Context, rawBody string, headers map[string]string) (*payment.PaymentNotification, error) {
	signature := strings.TrimSpace(headers["creem-signature"])
	if signature == "" {
		return nil, fmt.Errorf("creem notification missing creem-signature header")
	}
	provided, err := hex.DecodeString(signature)
	if err != nil {
		return nil, fmt.Errorf("creem notification invalid signature")
	}
	mac := hmac.New(sha256.New, []byte(c.config["webhookSecret"]))
	_, _ = mac.Write([]byte(rawBody))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return nil, fmt.Errorf("creem notification invalid signature")
	}

	var event creemEvent
	if err := json.Unmarshal([]byte(rawBody), &event); err != nil {
		return nil, fmt.Errorf("creem parse notification: %w", err)
	}
	switch event.EventType {
	case "checkout.completed":
		var checkout creemCheckout
		if err := json.Unmarshal(event.Object, &checkout); err != nil {
			return nil, fmt.Errorf("creem parse checkout.completed: %w", err)
		}
		if checkout.Order == nil || !strings.EqualFold(checkout.Status, "completed") || !strings.EqualFold(checkout.Order.Status, "paid") {
			return nil, fmt.Errorf("creem checkout.completed does not contain a paid order")
		}
		query, err := mapCreemCheckout(checkout)
		if err != nil {
			return nil, err
		}
		query.Metadata["provider_instance_id"] = c.instanceID
		return &payment.PaymentNotification{
			Type:     payment.NotificationTypePayment,
			EventID:  event.ID,
			TradeNo:  query.TradeNo,
			OrderID:  checkout.RequestID,
			Amount:   query.Amount,
			Status:   payment.NotificationStatusSuccess,
			RawData:  rawBody,
			Metadata: query.Metadata,
		}, nil
	case "refund.created":
		var refund creemRefund
		if err := json.Unmarshal(event.Object, &refund); err != nil {
			return nil, fmt.Errorf("creem parse refund.created: %w", err)
		}
		if !strings.EqualFold(refund.Status, "succeeded") {
			return nil, fmt.Errorf("creem refund.created is not succeeded")
		}
		cumulative := refund.Transaction.RefundedAmount
		if cumulative == 0 {
			cumulative = refund.RefundAmount
		}
		currency := refund.Transaction.Currency
		if currency == "" {
			currency = refund.RefundCurrency
		}
		productID := firstNonEmptyCreemValue(refund.Checkout.ProductID, creemReferenceID(refund.Checkout.Product))
		if refund.ID == "" || refund.Transaction.ID == "" || refund.Checkout.RequestID == "" || productID == "" || refund.RefundAmount <= 0 || cumulative <= 0 || refund.Transaction.AmountPaid <= 0 || strings.TrimSpace(currency) == "" {
			return nil, fmt.Errorf("creem refund.created is missing required fields")
		}
		return &payment.PaymentNotification{
			Type:                       payment.NotificationTypeRefund,
			EventID:                    event.ID,
			TradeNo:                    refund.Transaction.ID,
			OrderID:                    refund.Checkout.RequestID,
			Status:                     payment.NotificationStatusSuccess,
			RawData:                    rawBody,
			RefundID:                   refund.ID,
			RefundAmountMinor:          refund.RefundAmount,
			CumulativeRefundedMinor:    cumulative,
			TransactionAmountPaidMinor: refund.Transaction.AmountPaid,
			Metadata: map[string]string{
				"currency":             strings.ToUpper(currency),
				"product_id":           productID,
				"checkout_id":          refund.Checkout.ID,
				"provider_instance_id": c.instanceID,
			},
		}, nil
	default:
		return nil, nil
	}
}

func (c *Creem) Refund(context.Context, payment.RefundRequest) (*payment.RefundResponse, error) {
	return nil, fmt.Errorf("CREEM_OUTBOUND_REFUND_UNSUPPORTED: initiate refunds in the Creem Dashboard")
}

func (c *Creem) doJSON(ctx context.Context, method, path string, query url.Values, body any, target any) error {
	var requestBody io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		requestBody = bytes.NewReader(encoded)
	}
	endpoint := strings.TrimRight(c.baseURL, "/") + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, requestBody)
	if err != nil {
		return err
	}
	req.Header.Set("x-api-key", c.config["apiKey"])
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("creem API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func creemReferenceID(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	var object struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(raw, &object) == nil {
		return object.ID
	}
	return ""
}

func firstNonEmptyCreemValue(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
