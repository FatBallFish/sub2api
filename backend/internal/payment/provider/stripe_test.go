//go:build unit

package provider

import (
	"bytes"
	"context"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/stretchr/testify/require"
	stripe "github.com/stripe/stripe-go/v85"
)

type stripeRefundBackend struct {
	params []*stripe.RefundCreateParams
}

func (b *stripeRefundBackend) Call(_ string, _ string, _ string, params stripe.ParamsContainer, v stripe.LastResponseSetter) error {
	b.params = append(b.params, params.(*stripe.RefundCreateParams))
	refund := v.(*stripe.Refund)
	refund.ID = "re_123"
	refund.Status = stripe.RefundStatusSucceeded
	return nil
}

func (*stripeRefundBackend) CallStreaming(string, string, string, stripe.ParamsContainer, stripe.StreamingLastResponseSetter) error {
	return nil
}

func (*stripeRefundBackend) CallRaw(string, string, string, []byte, *stripe.Params, stripe.LastResponseSetter) error {
	return nil
}

func (*stripeRefundBackend) CallMultipart(string, string, string, string, *bytes.Buffer, *stripe.Params, stripe.LastResponseSetter) error {
	return nil
}

func (*stripeRefundBackend) SetMaxNetworkRetries(int64) {}

func TestStripeRefundUsesStableAmountSpecificIdempotencyKey(t *testing.T) {
	backend := &stripeRefundBackend{}
	client := stripe.NewClient("sk_test", stripe.WithBackends(&stripe.Backends{API: backend}))
	provider := &Stripe{
		config:      map[string]string{"currency": "CNY"},
		initialized: true,
		sc:          client,
	}

	refund := func(amount string) {
		_, err := provider.Refund(context.Background(), payment.RefundRequest{
			TradeNo: "pi_123",
			OrderID: "sub2_order_456",
			Amount:  amount,
		})
		require.NoError(t, err)
	}

	refund("12.34")
	refund("12.34")
	refund("12.35")

	require.Len(t, backend.params, 3)
	require.Equal(t, int64(1234), *backend.params[0].Amount)
	require.Equal(t, "re-sub2_order_456-1234", *backend.params[0].IdempotencyKey)
	require.Equal(t, backend.params[0].IdempotencyKey, backend.params[1].IdempotencyKey)
	require.Equal(t, int64(1235), *backend.params[2].Amount)
	require.Equal(t, "re-sub2_order_456-1235", *backend.params[2].IdempotencyKey)
	require.NotEqual(t, *backend.params[0].IdempotencyKey, *backend.params[2].IdempotencyKey)
}

func TestNewStripeNormalizesWalletPreferences(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		config     map[string]string
		wantApple  string
		wantGoogle string
	}{
		{
			name:       "missing values use Stripe defaults",
			config:     map[string]string{"secretKey": "sk_test"},
			wantApple:  stripeWalletAuto,
			wantGoogle: stripeWalletAuto,
		},
		{
			name: "explicit values are normalized",
			config: map[string]string{
				"secretKey": "sk_test",
				"applePay":  " NEVER ",
				"googlePay": "auto",
			},
			wantApple:  stripeWalletNever,
			wantGoogle: stripeWalletAuto,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			stripeProvider, err := NewStripe("test", tt.config)

			require.NoError(t, err)
			require.Equal(t, tt.wantApple, stripeProvider.config[stripeConfigApplePay])
			require.Equal(t, tt.wantGoogle, stripeProvider.config[stripeConfigGooglePay])
		})
	}
}

func TestNewStripeRejectsInvalidWalletPreference(t *testing.T) {
	t.Parallel()

	for _, key := range []string{stripeConfigApplePay, stripeConfigGooglePay} {
		key := key
		t.Run(key, func(t *testing.T) {
			t.Parallel()

			_, err := NewStripe("test", map[string]string{
				"secretKey": "sk_test",
				key:         "always",
			})

			require.ErrorContains(t, err, key)
			require.ErrorContains(t, err, "auto or never")
		})
	}
}

func TestNewStripeRejectsMissingSecretAndInvalidCurrency(t *testing.T) {
	t.Parallel()

	_, err := NewStripe("test", map[string]string{})
	require.ErrorContains(t, err, "secretKey")

	_, err = NewStripe("test", map[string]string{
		"secretKey": "sk_test",
		"currency":  "US1",
	})
	require.ErrorContains(t, err, "currency")
}
