package service

import (
	"fmt"
	"math"
	"time"

	"github.com/shopspring/decimal"
)

type balanceRefundSnapshot struct {
	SchemaVersion     int     `json:"schema_version"`
	PaidAmount        float64 `json:"paid_amount"`
	CreditedBalance   float64 `json:"credited_balance"`
	FeeAmount         float64 `json:"fee_amount"`
	CreditPerPaidUnit float64 `json:"credit_per_paid_unit"`
}

func balanceRefundSnapshotFromMap(snapshot map[string]any, fallbackPaidAmount, fallbackCreditedBalance float64) balanceRefundSnapshot {
	root := snapshot
	if nested, ok := snapshot["balance"].(map[string]any); ok {
		root = nested
	}
	out := balanceRefundSnapshot{
		SchemaVersion:     int(int64FromSnapshot(root, "schema_version")),
		PaidAmount:        float64FromSnapshot(root, "paid_amount"),
		CreditedBalance:   float64FromSnapshot(root, "credited_balance"),
		FeeAmount:         float64FromSnapshot(root, "fee_amount"),
		CreditPerPaidUnit: float64FromSnapshot(root, "credit_per_paid_unit"),
	}
	if out.PaidAmount <= 0 {
		out.PaidAmount = fallbackPaidAmount
	}
	if out.CreditedBalance <= 0 {
		out.CreditedBalance = fallbackCreditedBalance
	}
	if out.CreditPerPaidUnit <= 0 && out.PaidAmount > 0 && out.CreditedBalance > 0 {
		out.CreditPerPaidUnit = decimal.NewFromFloat(out.CreditedBalance).
			Div(decimal.NewFromFloat(out.PaidAmount)).
			Round(10).
			InexactFloat64()
	}
	return out
}

type balanceRefundCalculation struct {
	RefundAmount    float64
	BalanceToDeduct float64
}

func buildBalanceRefundSnapshotWithPaid(paidAmount, limitAmount, creditedBalance, feeRate float64) balanceRefundSnapshot {
	creditPerPaid := 0.0
	if paidAmount > 0 && creditedBalance > 0 {
		creditPerPaid = decimal.NewFromFloat(creditedBalance).
			Div(decimal.NewFromFloat(paidAmount)).
			Round(10).
			InexactFloat64()
	}
	return balanceRefundSnapshot{
		SchemaVersion:     1,
		PaidAmount:        paidAmount,
		CreditedBalance:   creditedBalance,
		FeeAmount:         roundMoney(paidAmount - limitAmount),
		CreditPerPaidUnit: creditPerPaid,
	}
}

func calculateBalanceRefundFromSnapshot(snapshot balanceRefundSnapshot, requestedBalanceRefund float64) balanceRefundCalculation {
	if requestedBalanceRefund <= 0 || snapshot.PaidAmount <= 0 || snapshot.CreditedBalance <= 0 {
		return balanceRefundCalculation{}
	}
	balanceToDeduct := math.Min(requestedBalanceRefund, snapshot.CreditedBalance)
	creditPerPaid := snapshot.CreditPerPaidUnit
	if creditPerPaid <= 0 {
		creditPerPaid = decimal.NewFromFloat(snapshot.CreditedBalance).
			Div(decimal.NewFromFloat(snapshot.PaidAmount)).
			InexactFloat64()
	}
	refundAmount := decimal.NewFromFloat(balanceToDeduct).
		Div(decimal.NewFromFloat(creditPerPaid)).
		Round(2).
		InexactFloat64()
	if refundAmount > snapshot.PaidAmount {
		refundAmount = snapshot.PaidAmount
	}
	return balanceRefundCalculation{
		RefundAmount:    refundAmount,
		BalanceToDeduct: balanceToDeduct,
	}
}

type subscriptionRefundInput struct {
	Price               float64
	StartsAt            time.Time
	ExpiresAt           time.Time
	TotalQuotaUSD       float64
	RemainingQuotaUSD   float64
	Now                 time.Time
	DurationBasisReason string
	QuotaBasisReason    string
}

type subscriptionRefundCalculation struct {
	RefundAmount  float64
	DurationRatio float64
	QuotaRatio    float64
	Basis         string
	ReasonSuffix  string
}

func calculateSubscriptionRefundAmount(input subscriptionRefundInput) subscriptionRefundCalculation {
	if input.Price <= 0 || input.StartsAt.IsZero() || input.ExpiresAt.IsZero() || !input.ExpiresAt.After(input.StartsAt) {
		return subscriptionRefundCalculation{Basis: "none", ReasonSuffix: "refund basis unavailable"}
	}
	now := input.Now
	if now.IsZero() {
		now = time.Now()
	}
	totalSeconds := input.ExpiresAt.Sub(input.StartsAt).Seconds()
	remainingSeconds := input.ExpiresAt.Sub(now).Seconds()
	durationRatio := clampRatio(remainingSeconds / totalSeconds)
	quotaRatio := 1.0
	if input.TotalQuotaUSD > 0 {
		quotaRatio = clampRatio(input.RemainingQuotaUSD / input.TotalQuotaUSD)
	}
	basis := "duration"
	reason := input.DurationBasisReason
	ratio := durationRatio
	if quotaRatio < durationRatio {
		basis = "quota"
		reason = input.QuotaBasisReason
		ratio = quotaRatio
	}
	if reason == "" {
		reason = basis
	}
	return subscriptionRefundCalculation{
		RefundAmount:  roundMoney(input.Price * ratio),
		DurationRatio: durationRatio,
		QuotaRatio:    quotaRatio,
		Basis:         basis,
		ReasonSuffix:  fmt.Sprintf("refund basis: %s (duration %.2f%%, quota %.2f%%)", reason, durationRatio*100, quotaRatio*100),
	}
}

type periodQuotaInput struct {
	Period         string
	PeriodLimitUSD float64
	CurrentUsedUSD float64
	CurrentEnd     time.Time
	ExpiresAt      time.Time
	Now            time.Time
}

func calculateRemainingPeriodQuotaUSD(input periodQuotaInput) float64 {
	if input.PeriodLimitUSD <= 0 || input.ExpiresAt.IsZero() || input.Now.IsZero() || !input.ExpiresAt.After(input.Now) {
		return 0
	}
	currentRemaining := input.PeriodLimitUSD - input.CurrentUsedUSD
	if currentRemaining < 0 {
		currentRemaining = 0
	}
	remaining := currentRemaining
	windowStart := input.CurrentEnd
	if windowStart.IsZero() || !windowStart.After(input.Now) {
		windowStart = input.Now
	}
	for windowStart.Before(input.ExpiresAt) {
		next := nextGlobalPlanPeriodStart(windowStart, input.Period)
		if !next.After(windowStart) {
			break
		}
		remaining += input.PeriodLimitUSD
		windowStart = next
	}
	return remaining
}

func calculateTotalPeriodQuotaUSD(period string, periodLimitUSD float64, startsAt, expiresAt time.Time) float64 {
	if periodLimitUSD <= 0 || startsAt.IsZero() || expiresAt.IsZero() || !expiresAt.After(startsAt) {
		return 0
	}
	total := 0.0
	windowStart := startsAt
	for windowStart.Before(expiresAt) {
		total += periodLimitUSD
		next := nextGlobalPlanPeriodStart(windowStart, period)
		if !next.After(windowStart) {
			break
		}
		windowStart = next
	}
	return total
}

func clampRatio(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
