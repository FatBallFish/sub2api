package service

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/payment"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/shopspring/decimal"
)

const defaultPaymentCurrencyExchangeRates = "USD:CNY=7.20,CNY:USD=0.13888889"

func paymentProviderConfigCurrency(providerKey string, cfg map[string]string) string {
	switch strings.TrimSpace(providerKey) {
	case payment.TypeStripe, payment.TypeAirwallex, payment.TypeJeepay:
		currency, err := payment.NormalizePaymentCurrency(cfg["currency"])
		if err == nil {
			return currency
		}
	}
	return payment.DefaultPaymentCurrency
}

func normalizePaymentCurrencyExchangeRates(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return defaultPaymentCurrencyExchangeRates
	}
	return strings.TrimSpace(raw)
}

func parsePaymentCurrencyExchangeRates(raw string) map[string]float64 {
	raw = normalizePaymentCurrencyExchangeRates(raw)
	out := make(map[string]float64)
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		pair, value, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		fromTo := strings.Split(strings.TrimSpace(pair), ":")
		if len(fromTo) != 2 {
			continue
		}
		from, fromErr := payment.NormalizePaymentCurrency(fromTo[0])
		to, toErr := payment.NormalizePaymentCurrency(fromTo[1])
		rate, rateErr := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if fromErr != nil || toErr != nil || rateErr != nil || math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= 0 {
			continue
		}
		out[from+":"+to] = rate
	}
	return out
}

func parsePaymentCurrencyExchangeRatesWithLegacySubscriptionRate(raw string, subscriptionUSDToCNYRate float64) map[string]float64 {
	rates := parsePaymentCurrencyExchangeRates(raw)
	rate := normalizeSubscriptionUSDToCNYRate(subscriptionUSDToCNYRate)
	if rate > 0 {
		rates["USD:"+payment.DefaultPaymentCurrency] = rate
	}
	return rates
}

func orderUsesSubscriptionCurrency(orderType string, subscriptionUSDToCNYRate float64, paymentCurrency string) bool {
	rate := normalizeSubscriptionUSDToCNYRate(subscriptionUSDToCNYRate)
	if rate <= 0 {
		return false
	}
	if paymentCurrency != payment.DefaultPaymentCurrency {
		return false
	}
	switch orderType {
	case payment.OrderTypeSubscription, payment.OrderTypeGlobalPlan, payment.OrderTypeGlobalPlanUpgrade:
		return true
	default:
		return false
	}
}

func convertPaymentBillingAmount(amount float64, fromCurrency, toCurrency string, rates map[string]float64) (float64, float64, error) {
	from, err := payment.NormalizePaymentCurrency(fromCurrency)
	if err != nil {
		return 0, 0, infraerrors.BadRequest("INVALID_AMOUNT_CURRENCY", err.Error())
	}
	to, err := payment.NormalizePaymentCurrency(toCurrency)
	if err != nil {
		return 0, 0, infraerrors.BadRequest("INVALID_PAYMENT_CURRENCY", err.Error())
	}
	if amount <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, 0, infraerrors.BadRequest("INVALID_AMOUNT", "amount must be a positive number")
	}
	if from == to {
		return amount, 1, nil
	}
	key := from + ":" + to
	rate := rates[key]
	if rate <= 0 {
		return 0, 0, infraerrors.BadRequest("PAYMENT_CURRENCY_RATE_MISSING", fmt.Sprintf("missing exchange rate for %s", key)).
			WithMetadata(map[string]string{"from": from, "to": to})
	}
	converted := decimal.NewFromFloat(amount).
		Mul(decimal.NewFromFloat(rate)).
		Round(int32(payment.CurrencyMaxFractionDigits(to))).
		InexactFloat64()
	return converted, rate, nil
}

func PaymentOrderCurrency(order *dbent.PaymentOrder) string {
	if snapshot := psOrderProviderSnapshot(order); snapshot != nil {
		if currency, err := payment.NormalizePaymentCurrency(snapshot.Currency); err == nil {
			return currency
		}
	}
	return payment.DefaultPaymentCurrency
}

func PaymentOrderAmountCurrency(order *dbent.PaymentOrder, fallback string) string {
	if order != nil && len(order.RefundSnapshot) > 0 {
		if currency, err := payment.NormalizePaymentCurrency(psSnapshotStringValue(order.RefundSnapshot["amount_currency"])); err == nil {
			return currency
		}
	}
	if currency, err := payment.NormalizePaymentCurrency(fallback); err == nil {
		return currency
	}
	return PaymentOrderCurrency(order)
}
