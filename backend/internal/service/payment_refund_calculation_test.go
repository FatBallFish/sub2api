//go:build unit

package service

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func buildBalanceRefundSnapshotForTest(limitAmount, creditedBalance, feeRate float64) balanceRefundSnapshot {
	paidAmount := decimal.NewFromFloat(limitAmount)
	if feeRate > 0 {
		paidAmount = paidAmount.Mul(decimal.NewFromFloat(1).Add(decimal.NewFromFloat(feeRate)))
	}
	return buildBalanceRefundSnapshotWithPaid(paidAmount.Round(2).InexactFloat64(), limitAmount, creditedBalance, feeRate)
}

func TestBalanceRefundFromSnapshotUsesOriginalExchangeRate(t *testing.T) {
	snapshot := buildBalanceRefundSnapshotForTest(100, 125, 0)

	out := calculateBalanceRefundFromSnapshot(snapshot, 50)

	require.InDelta(t, 100, snapshot.PaidAmount, 1e-9)
	require.InDelta(t, 125, snapshot.CreditedBalance, 1e-9)
	require.InDelta(t, 1.25, snapshot.CreditPerPaidUnit, 1e-9)
	require.InDelta(t, 40, out.RefundAmount, 1e-9)
	require.InDelta(t, 50, out.BalanceToDeduct, 1e-9)
}

func TestBalanceRefundFromSnapshotCapsAtOriginalPayment(t *testing.T) {
	snapshot := buildBalanceRefundSnapshotForTest(100, 125, 0)

	out := calculateBalanceRefundFromSnapshot(snapshot, 200)

	require.InDelta(t, 100, out.RefundAmount, 1e-9)
	require.InDelta(t, 125, out.BalanceToDeduct, 1e-9)
}

func TestSubscriptionRefundUsesSmallerDurationOrQuotaRatio(t *testing.T) {
	now := time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC)
	start := now.Add(-10 * 24 * time.Hour)
	expires := now.Add(20 * 24 * time.Hour)

	out := calculateSubscriptionRefundAmount(subscriptionRefundInput{
		Price:               90,
		StartsAt:            start,
		ExpiresAt:           expires,
		TotalQuotaUSD:       300,
		RemainingQuotaUSD:   120,
		Now:                 now,
		DurationBasisReason: "remaining duration",
		QuotaBasisReason:    "remaining quota",
	})

	require.InDelta(t, 2.0/3.0, out.DurationRatio, 1e-9)
	require.InDelta(t, 0.4, out.QuotaRatio, 1e-9)
	require.Equal(t, "quota", out.Basis)
	require.Contains(t, out.ReasonSuffix, "remaining quota")
	require.InDelta(t, 36, out.RefundAmount, 1e-9)
}

func TestSubscriptionRefundUsesDurationWhenDurationRatioIsLower(t *testing.T) {
	now := time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC)
	start := now.Add(-20 * 24 * time.Hour)
	expires := now.Add(10 * 24 * time.Hour)

	out := calculateSubscriptionRefundAmount(subscriptionRefundInput{
		Price:               90,
		StartsAt:            start,
		ExpiresAt:           expires,
		TotalQuotaUSD:       300,
		RemainingQuotaUSD:   210,
		Now:                 now,
		DurationBasisReason: "remaining duration",
		QuotaBasisReason:    "remaining quota",
	})

	require.InDelta(t, 1.0/3.0, out.DurationRatio, 1e-9)
	require.InDelta(t, 0.7, out.QuotaRatio, 1e-9)
	require.Equal(t, "duration", out.Basis)
	require.Contains(t, out.ReasonSuffix, "remaining duration")
	require.InDelta(t, 30, out.RefundAmount, 1e-9)
}

func TestRemainingQuotaCountsOnlyCurrentAndFuturePeriods(t *testing.T) {
	now := time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC)
	expires := now.Add(16 * 24 * time.Hour)

	require.InDelta(t, 250, calculateRemainingPeriodQuotaUSD(periodQuotaInput{
		Period:         GlobalPlanQuotaPeriodWeek,
		PeriodLimitUSD: 100,
		CurrentUsedUSD: 50,
		CurrentEnd:     now.Add(2 * 24 * time.Hour),
		ExpiresAt:      expires,
		Now:            now,
	}), 1e-9)
}
