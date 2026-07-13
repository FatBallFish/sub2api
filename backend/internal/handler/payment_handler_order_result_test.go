//go:build unit

package handler

import (
	"testing"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/stretchr/testify/require"
)

func TestBuildPublicOrderResultSeparatesPaymentAndAmountCurrencies(t *testing.T) {
	order := &dbent.PaymentOrder{
		ID:         4,
		OutTradeNo: "sub2_20260622Kl262EbX",
		Amount:     10,
		PayAmount:  68,
		FeeRate:    0,
		ProviderSnapshot: map[string]any{
			"currency": "CNY",
		},
		RefundSnapshot: map[string]any{
			"amount_currency":  "USD",
			"payment_currency": "CNY",
		},
		PaymentType:  payment.TypeJeepay,
		OrderType:    payment.OrderTypeBalance,
		Status:       payment.OrderStatusCompleted,
		CreatedAt:    time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC),
		ExpiresAt:    time.Date(2026, 6, 22, 9, 0, 0, 0, time.UTC),
		RefundAmount: 0,
	}

	result := buildPublicOrderResult(order)

	require.Equal(t, "CNY", result.Currency)
	require.Equal(t, "CNY", result.PaymentCurrency)
	require.Equal(t, "USD", result.AmountCurrency)
	require.InDelta(t, 68, result.PayAmount, 1e-9)
	require.InDelta(t, 10, result.Amount, 1e-9)
}
