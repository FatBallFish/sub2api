//go:build unit

package provider

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/stretchr/testify/require"
)

func TestNewCreemValidatesConfig(t *testing.T) {
	t.Parallel()

	_, err := NewCreem("1", map[string]string{"webhookSecret": "secret"})
	require.ErrorContains(t, err, "apiKey")

	_, err = NewCreem("1", map[string]string{"apiKey": "key"})
	require.ErrorContains(t, err, "webhookSecret")

	_, err = NewCreem("1", map[string]string{
		"apiKey":        "key",
		"webhookSecret": "secret",
		"environment":   "staging",
	})
	require.ErrorContains(t, err, "environment")

	prov, err := NewCreem("1", map[string]string{
		"apiKey":        "key",
		"webhookSecret": "secret",
		"environment":   "test",
	})
	require.NoError(t, err)
	require.Equal(t, payment.TypeCreem, prov.ProviderKey())
	require.Equal(t, []payment.PaymentType{payment.TypeCreem}, prov.SupportedTypes())
	require.Equal(t, creemTestAPIBase, prov.baseURL)
}

func TestCreemCreatePaymentUsesFixedProduct(t *testing.T) {
	t.Parallel()

	var captured creemCheckoutRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/v1/checkouts", r.URL.Path)
		require.Equal(t, "key", r.Header.Get("x-api-key"))
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&captured))
		_, _ = w.Write([]byte(`{"id":"ch_123","checkout_url":"https://checkout.creem.io/ch_123","product_id":"prod_123","status":"pending"}`))
	}))
	defer server.Close()

	prov := mustTestCreemProvider(t, server)
	resp, err := prov.CreatePayment(context.Background(), payment.CreatePaymentRequest{
		OrderID:       "sub2_order",
		ProductID:     "prod_123",
		CustomerEmail: "user@example.com",
		ReturnURL:     "https://merchant.example.com/payment/result",
		Metadata: map[string]string{
			"creem_binding_id": "12",
		},
	})
	require.NoError(t, err)
	require.Equal(t, "ch_123", resp.TradeNo)
	require.Equal(t, "https://checkout.creem.io/ch_123", resp.PayURL)
	require.Equal(t, "prod_123", captured.ProductID)
	require.Equal(t, "sub2_order", captured.RequestID)
	require.Equal(t, "https://merchant.example.com/payment/result", captured.SuccessURL)
	require.Equal(t, "user@example.com", captured.Customer.Email)
	require.Equal(t, "12", captured.Metadata["creem_binding_id"])
}

func TestCreemQueryOrderMapsPaidCheckout(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodGet, r.Method)
		require.Equal(t, "/v1/checkouts", r.URL.Path)
		require.Equal(t, "ch_123", r.URL.Query().Get("checkout_id"))
		_, _ = w.Write([]byte(`{
			"id":"ch_123",
			"request_id":"sub2_order",
			"status":"completed",
			"product":{"id":"prod_123"},
			"order":{"id":"ord_123","amount":2000,"amount_paid":2420,"currency":"USD","status":"paid","transaction":"tran_123"}
		}`))
	}))
	defer server.Close()

	prov := mustTestCreemProvider(t, server)
	resp, err := prov.QueryOrder(context.Background(), "ch_123")
	require.NoError(t, err)
	require.Equal(t, "tran_123", resp.TradeNo)
	require.Equal(t, payment.ProviderStatusPaid, resp.Status)
	require.Equal(t, 20.0, resp.Amount)
	require.Equal(t, "USD", resp.Metadata["currency"])
	require.Equal(t, "sub2_order", resp.Metadata["order_id"])
	require.Equal(t, "prod_123", resp.Metadata["product_id"])
	require.Equal(t, "ch_123", resp.Metadata["checkout_id"])
}

func TestCreemGetProductReturnsTrustedFields(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/products", r.URL.Path)
		require.Equal(t, "prod_123", r.URL.Query().Get("product_id"))
		require.Equal(t, "key", r.Header.Get("x-api-key"))
		_, _ = w.Write([]byte(`{"id":"prod_123","name":"Starter","price":2000,"currency":"USD","billing_type":"onetime","status":"active","tax_mode":"exclusive"}`))
	}))
	defer server.Close()

	prov := mustTestCreemProvider(t, server)
	product, err := prov.GetProduct(context.Background(), "prod_123")
	require.NoError(t, err)
	require.Equal(t, "prod_123", product.ID)
	require.Equal(t, int64(2000), product.PriceMinor)
	require.Equal(t, "onetime", product.BillingType)
	require.Equal(t, "active", product.Status)
}

func TestCreemVerifyNotificationMapsCheckoutCompleted(t *testing.T) {
	t.Parallel()

	prov := mustTestCreemProvider(t, nil)
	raw := `{
		"id":"evt_pay_1",
		"eventType":"checkout.completed",
		"object":{
			"id":"ch_123",
			"request_id":"sub2_order",
			"status":"completed",
			"product":{"id":"prod_123"},
			"order":{"id":"ord_123","amount":2000,"amount_paid":2420,"currency":"USD","status":"paid","transaction":"tran_123"}
		}
	}`

	n, err := prov.VerifyNotification(context.Background(), raw, creemSignedHeaders(raw, "secret"))
	require.NoError(t, err)
	require.NotNil(t, n)
	require.Equal(t, payment.NotificationTypePayment, n.Type)
	require.Equal(t, "evt_pay_1", n.EventID)
	require.Equal(t, "tran_123", n.TradeNo)
	require.Equal(t, "sub2_order", n.OrderID)
	require.Equal(t, payment.NotificationStatusSuccess, n.Status)
	require.Equal(t, 20.0, n.Amount)
	require.Equal(t, "USD", n.Metadata["currency"])
	require.Equal(t, "prod_123", n.Metadata["product_id"])
	require.Equal(t, "ch_123", n.Metadata["checkout_id"])

	_, err = prov.VerifyNotification(context.Background(), raw, map[string]string{"creem-signature": "invalid"})
	require.ErrorContains(t, err, "invalid signature")
}

func TestCreemVerifyNotificationRejectsCompletedEventWithoutPaidOrder(t *testing.T) {
	prov := mustTestCreemProvider(t, nil)
	raw := `{"id":"evt_unpaid","eventType":"checkout.completed","object":{"id":"ch_123","request_id":"sub2_order","status":"completed","product":"prod_123","order":{"id":"ord_123","amount":2000,"amount_paid":0,"currency":"USD","status":"pending","transaction":"tran_123"}}}`
	_, err := prov.VerifyNotification(context.Background(), raw, creemSignedHeaders(raw, "secret"))
	require.ErrorContains(t, err, "paid order")
}

func TestCreemVerifyNotificationMapsRefundCreated(t *testing.T) {
	t.Parallel()

	prov := mustTestCreemProvider(t, nil)
	raw := `{
		"id":"evt_ref_1",
		"eventType":"refund.created",
		"object":{
			"id":"ref_123",
			"status":"succeeded",
			"refund_amount":1210,
			"refund_currency":"USD",
			"transaction":{"id":"tran_123","amount":2000,"amount_paid":2420,"currency":"USD","status":"partialRefund","refunded_amount":1210},
			"checkout":{"id":"ch_123","request_id":"sub2_order","product":"prod_123"}
		}
	}`

	n, err := prov.VerifyNotification(context.Background(), raw, creemSignedHeaders(raw, "secret"))
	require.NoError(t, err)
	require.NotNil(t, n)
	require.Equal(t, payment.NotificationTypeRefund, n.Type)
	require.Equal(t, "evt_ref_1", n.EventID)
	require.Equal(t, "sub2_order", n.OrderID)
	require.Equal(t, "tran_123", n.TradeNo)
	require.Equal(t, "ref_123", n.RefundID)
	require.Equal(t, int64(1210), n.RefundAmountMinor)
	require.Equal(t, int64(1210), n.CumulativeRefundedMinor)
	require.Equal(t, int64(2420), n.TransactionAmountPaidMinor)
	require.Equal(t, "USD", n.Metadata["currency"])
}

func TestCreemVerifyNotificationRejectsUnsuccessfulRefund(t *testing.T) {
	prov := mustTestCreemProvider(t, nil)
	raw := `{"id":"evt_ref_failed","eventType":"refund.created","object":{"id":"ref_failed","status":"failed","refund_amount":1210,"refund_currency":"USD","transaction":{"id":"tran_123","amount_paid":2420,"currency":"USD","refunded_amount":1210},"checkout":{"id":"ch_123","request_id":"sub2_order","product":"prod_123"}}}`
	_, err := prov.VerifyNotification(context.Background(), raw, creemSignedHeaders(raw, "secret"))
	require.ErrorContains(t, err, "not succeeded")
}

func TestCreemRefundIsExplicitlyUnsupported(t *testing.T) {
	t.Parallel()

	prov := mustTestCreemProvider(t, nil)
	_, err := prov.Refund(context.Background(), payment.RefundRequest{TradeNo: "tran_123", Amount: "10.00"})
	require.ErrorContains(t, err, "CREEM_OUTBOUND_REFUND_UNSUPPORTED")
}

func mustTestCreemProvider(t *testing.T, server *httptest.Server) *Creem {
	t.Helper()
	prov, err := NewCreem("1", map[string]string{
		"apiKey":        "key",
		"webhookSecret": "secret",
		"environment":   "test",
	})
	require.NoError(t, err)
	if server != nil {
		prov.baseURL = server.URL + "/v1"
		prov.httpClient = server.Client()
	}
	return prov
}

func creemSignedHeaders(rawBody, secret string) map[string]string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(rawBody))
	return map[string]string{"creem-signature": hex.EncodeToString(mac.Sum(nil))}
}
