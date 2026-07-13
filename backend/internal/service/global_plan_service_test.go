//go:build unit

package service_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/enttest"
	"github.com/Wei-Shaw/sub2api/internal/domain"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "modernc.org/sqlite"
)

func newGlobalPlanEntClient(t *testing.T) *dbent.Client {
	t.Helper()

	db, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared&_fk=1")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec("PRAGMA foreign_keys = ON")
	require.NoError(t, err)

	drv := entsql.OpenDB(dialect.SQLite, db)
	client := enttest.NewClient(t, enttest.WithOptions(dbent.Driver(drv)))
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestGlobalPlanServiceGetActiveResetsExpiredWeeklyWindow(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	initialPeriodStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	expectedPeriodStart := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	expectedPeriodEnd := time.Date(2026, 6, 22, 0, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("global-plan@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	plan := client.SubscriptionPlan.Create().
		SetPlanScope("global").
		SetTierRank(20).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(60).
		SetMonthlyMaxUsd(240).
		SetName("Pro").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("day").
		SaveX(ctx)
	sub := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(plan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(initialPeriodStart).
		SetExpiresAt(now.AddDate(0, 0, 16)).
		SetCurrentPeriodStart(initialPeriodStart).
		SetCurrentPeriodEnd(initialPeriodStart.AddDate(0, 0, 7)).
		SetQuotaPeriod("week").
		SetQuotaLimitUsd(60).
		SetQuotaUsedUsd(51).
		SetTierRank(20).
		SetPlanNameSnapshot("Pro").
		SaveX(ctx)

	svc := service.NewGlobalPlanService(client)
	snapshot, err := svc.GetActive(ctx, user.ID, now)
	require.NoError(t, err)
	require.NotNil(t, snapshot)
	require.Equal(t, sub.ID, snapshot.ID)
	require.Equal(t, 60.0, snapshot.QuotaLimitUSD)
	require.Equal(t, 0.0, snapshot.QuotaUsedUSD)
	require.Equal(t, 60.0, snapshot.QuotaRemainingUSD)
	require.True(t, snapshot.CurrentPeriodStart.Equal(expectedPeriodStart))
	require.True(t, snapshot.CurrentPeriodEnd.Equal(expectedPeriodEnd))

	stored := client.UserGlobalPlanSubscription.GetX(ctx, sub.ID)
	require.Equal(t, 0.0, stored.QuotaUsedUsd)
	require.True(t, stored.CurrentPeriodStart.Equal(expectedPeriodStart))
	require.True(t, stored.CurrentPeriodEnd.Equal(expectedPeriodEnd))
}

func TestGlobalPlanServiceCalculateUpgradeQuoteProratesRemainingValidity(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("global-plan-upgrade@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	currentPlan := client.SubscriptionPlan.Create().
		SetPlanScope("global").
		SetTierRank(10).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(30).
		SetMonthlyMaxUsd(120).
		SetName("Starter").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("day").
		SaveX(ctx)
	targetPlan := client.SubscriptionPlan.Create().
		SetPlanScope("global").
		SetTierRank(20).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(80).
		SetMonthlyMaxUsd(320).
		SetName("Pro").
		SetPrice(99).
		SetValidityDays(30).
		SetValidityUnit("day").
		SaveX(ctx)
	sub := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(currentPlan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -10)).
		SetExpiresAt(now.AddDate(0, 0, 20)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -3)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 4)).
		SetQuotaPeriod("week").
		SetQuotaLimitUsd(30).
		SetQuotaUsedUsd(7).
		SetTierRank(10).
		SetPlanNameSnapshot("Starter").
		SaveX(ctx)

	svc := service.NewGlobalPlanService(client)
	quote, err := svc.CalculateUpgradeQuote(ctx, user.ID, targetPlan.ID, now)
	require.NoError(t, err)
	require.Equal(t, sub.ID, quote.CurrentSubscriptionID)
	require.Equal(t, currentPlan.ID, quote.FromPlanID)
	require.Equal(t, targetPlan.ID, quote.ToPlanID)
	require.Equal(t, int64(20*24*time.Hour/time.Second), quote.RemainingSeconds)
	require.Equal(t, int64(30*24*time.Hour/time.Second), quote.CycleSeconds)
	require.Equal(t, 49.0, quote.CurrentPlanPrice)
	require.Equal(t, 99.0, quote.TargetPlanPrice)
	require.InDelta(t, 33.33, quote.UpgradePrice, 0.01)
	require.Equal(t, "USD", quote.Currency)
	require.True(t, quote.ExpiresAt.Equal(sub.ExpiresAt))
}

func TestGlobalPlanServiceCalculateUpgradeQuoteRejectsLowerOrEqualTier(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("global-plan-upgrade-downgrade@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	currentPlan := client.SubscriptionPlan.Create().
		SetPlanScope("global").
		SetTierRank(20).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(80).
		SetMonthlyMaxUsd(320).
		SetName("Pro").
		SetPrice(99).
		SetValidityDays(30).
		SetValidityUnit("day").
		SaveX(ctx)
	targetPlan := client.SubscriptionPlan.Create().
		SetPlanScope("global").
		SetTierRank(10).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(30).
		SetMonthlyMaxUsd(120).
		SetName("Starter").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("day").
		SaveX(ctx)
	client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(currentPlan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -10)).
		SetExpiresAt(now.AddDate(0, 0, 20)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -3)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 4)).
		SetQuotaPeriod("week").
		SetQuotaLimitUsd(80).
		SetQuotaUsedUsd(7).
		SetTierRank(20).
		SetPlanNameSnapshot("Pro").
		SaveX(ctx)

	quote, err := service.NewGlobalPlanService(client).CalculateUpgradeQuote(ctx, user.ID, targetPlan.ID, now)
	require.Error(t, err)
	require.Empty(t, quote)
}

func TestGlobalPlanServiceAssignCreatesManualGlobalPlanSubscription(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("manual-global-plan@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	admin := client.User.Create().
		SetEmail("admin-global-plan@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	plan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetTierRank(30).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaPerPeriodUsd(88).
		SetMonthlyMaxUsd(352).
		SetName("Manual Pro").
		SetPrice(99).
		SetValidityDays(30).
		SetValidityUnit("days").
		SaveX(ctx)

	sub, err := service.NewGlobalPlanService(client).Assign(ctx, service.AssignGlobalPlanInput{
		UserID:       user.ID,
		PlanID:       plan.ID,
		ValidityDays: 14,
		AssignedBy:   admin.ID,
		Notes:        "compensation",
		Now:          now,
	})

	require.NoError(t, err)
	require.Equal(t, user.ID, sub.UserID)
	require.Equal(t, plan.ID, sub.PlanID)
	require.Equal(t, service.GlobalPlanStatusActive, sub.Status)
	require.Equal(t, admin.ID, *sub.AssignedBy)
	require.Equal(t, "compensation", *sub.Notes)
	require.True(t, sub.StartsAt.Equal(now))
	require.True(t, sub.ExpiresAt.Equal(now.AddDate(0, 0, 30)))
	require.Equal(t, 88.0, sub.QuotaLimitUsd)
	require.Nil(t, sub.SourceOrderID)
}

func TestGlobalPlanServiceAssignReplacesCurrentPlanAndResetsCurrentPeriod(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("manual-global-plan-replace@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	oldPlan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetTierRank(30).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaPerPeriodUsd(120).
		SetMonthlyMaxUsd(480).
		SetName("Manual Pro").
		SetPrice(99).
		SetValidityDays(30).
		SetValidityUnit("days").
		SaveX(ctx)
	newPlan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetTierRank(10).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaPerPeriodUsd(20).
		SetMonthlyMaxUsd(80).
		SetName("Manual Lite").
		SetPrice(19).
		SetValidityDays(22).
		SetValidityUnit("days").
		SaveX(ctx)
	admin := client.User.Create().
		SetEmail("manual-global-plan-replace-admin@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	existing := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(oldPlan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -5)).
		SetExpiresAt(now.AddDate(0, 0, 25)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -5)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 2)).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaLimitUsd(120).
		SetQuotaUsedUsd(75).
		SetTierRank(30).
		SetPlanNameSnapshot("Manual Pro").
		SaveX(ctx)

	sub, err := service.NewGlobalPlanService(client).Assign(ctx, service.AssignGlobalPlanInput{
		UserID:     user.ID,
		PlanID:     newPlan.ID,
		AssignedBy: admin.ID,
		Notes:      "downgrade",
		Now:        now,
	})

	require.NoError(t, err)
	require.Equal(t, existing.ID, sub.ID)
	require.Equal(t, newPlan.ID, sub.PlanID)
	require.Equal(t, "Manual Lite", sub.PlanNameSnapshot)
	require.Equal(t, 10, sub.TierRank)
	require.Equal(t, 20.0, sub.QuotaLimitUsd)
	require.Equal(t, 0.0, sub.QuotaUsedUsd)
	require.True(t, sub.StartsAt.Equal(now))
	require.True(t, sub.ExpiresAt.Equal(now.AddDate(0, 0, 22)))
	require.True(t, sub.CurrentPeriodStart.Equal(now))
	require.True(t, sub.CurrentPeriodEnd.Equal(now.AddDate(0, 0, 7)))
}

func TestGlobalPlanServiceListAdminAssignmentsReturnsActiveGlobalPlans(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("893721708@qq.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	admin := client.User.Create().
		SetEmail("admin-list-global@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	plan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetTierRank(20).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodMonth).
		SetQuotaPerPeriodUsd(100).
		SetMonthlyMaxUsd(100).
		SetName("Monthly Global").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("days").
		SaveX(ctx)
	client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(plan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -1)).
		SetExpiresAt(now.AddDate(0, 0, 29)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -1)).
		SetCurrentPeriodEnd(now.AddDate(0, 1, -1)).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodMonth).
		SetQuotaLimitUsd(100).
		SetQuotaUsedUsd(23).
		SetTierRank(20).
		SetPlanNameSnapshot("Monthly Global").
		SetAssignedBy(admin.ID).
		SetAssignedAt(now).
		SetNotes("manual grant").
		SaveX(ctx)

	items, page, err := service.NewGlobalPlanService(client).ListAdminAssignments(
		ctx,
		pagination.PaginationParams{Page: 1, PageSize: 20},
		&user.ID,
		service.GlobalPlanStatusActive,
	)

	require.NoError(t, err)
	require.NotNil(t, page)
	require.Equal(t, int64(1), page.Total)
	require.Len(t, items, 1)
	require.Equal(t, "893721708@qq.com", items[0].UserEmail)
	require.Equal(t, "Monthly Global", items[0].PlanName)
	require.Equal(t, service.GlobalPlanQuotaPeriodMonth, items[0].QuotaPeriod)
	require.Equal(t, 100.0, items[0].QuotaLimitUSD)
	require.Equal(t, 23.0, items[0].QuotaUsedUSD)
	require.Equal(t, 77.0, items[0].QuotaRemainingUSD)
	require.Equal(t, "admin-list-global@example.com", items[0].AssignedByEmail)
	require.Equal(t, "manual grant", *items[0].Notes)
}

func TestGlobalPlanServiceAssignRejectsGroupPlan(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()

	user := client.User.Create().
		SetEmail("manual-group-plan@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	groupPlan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGroup).
		SetName("Group Plan").
		SetPrice(29).
		SetValidityDays(30).
		SetValidityUnit("days").
		SaveX(ctx)

	sub, err := service.NewGlobalPlanService(client).Assign(ctx, service.AssignGlobalPlanInput{
		UserID: user.ID,
		PlanID: groupPlan.ID,
	})

	require.Error(t, err)
	require.Nil(t, sub)
}

func TestGlobalPlanServiceAdjustExtendsAndShortensActiveAssignment(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("adjust-global-plan@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	plan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetTierRank(20).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaPerPeriodUsd(60).
		SetMonthlyMaxUsd(240).
		SetName("Adjustable Global").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("days").
		SaveX(ctx)
	sub := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(plan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -5)).
		SetExpiresAt(now.AddDate(0, 0, 25)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -5)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 2)).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaLimitUsd(60).
		SetQuotaUsedUsd(12).
		SetTierRank(20).
		SetPlanNameSnapshot("Adjustable Global").
		SaveX(ctx)

	svc := service.NewGlobalPlanService(client)
	extended, err := svc.Adjust(ctx, sub.ID, 5, now)
	require.NoError(t, err)
	require.True(t, extended.ExpiresAt.Equal(now.AddDate(0, 0, 30)))

	shortened, err := svc.Adjust(ctx, sub.ID, -10, now)
	require.NoError(t, err)
	require.True(t, shortened.ExpiresAt.Equal(now.AddDate(0, 0, 20)))
	require.Equal(t, 12.0, shortened.QuotaUsedUsd)
}

func TestGlobalPlanServiceAdjustRejectsExpiredResult(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("adjust-global-plan-expire@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	plan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetName("Short Global").
		SetPrice(19).
		SetValidityDays(7).
		SetValidityUnit("days").
		SaveX(ctx)
	sub := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(plan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -6)).
		SetExpiresAt(now.AddDate(0, 0, 1)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -6)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 1)).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaLimitUsd(20).
		SetQuotaUsedUsd(2).
		SetTierRank(1).
		SetPlanNameSnapshot("Short Global").
		SaveX(ctx)

	updated, err := service.NewGlobalPlanService(client).Adjust(ctx, sub.ID, -2, now)
	require.Error(t, err)
	require.Nil(t, updated)
}

func TestGlobalPlanServiceResetQuotaClearsCurrentWindowUsage(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("reset-global-plan@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	plan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetName("Reset Global").
		SetPrice(19).
		SetValidityDays(30).
		SetValidityUnit("days").
		SaveX(ctx)
	sub := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(plan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -3)).
		SetExpiresAt(now.AddDate(0, 0, 27)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -3)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 4)).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaLimitUsd(20).
		SetQuotaUsedUsd(17).
		SetTierRank(1).
		SetPlanNameSnapshot("Reset Global").
		SaveX(ctx)

	updated, err := service.NewGlobalPlanService(client).ResetQuota(ctx, sub.ID, now)
	require.NoError(t, err)
	require.Equal(t, 0.0, updated.QuotaUsedUsd)
	require.NotNil(t, updated.LastResetAt)
	require.True(t, updated.LastResetAt.Equal(now))
	require.True(t, updated.CurrentPeriodStart.Equal(sub.CurrentPeriodStart))
	require.True(t, updated.CurrentPeriodEnd.Equal(sub.CurrentPeriodEnd))
}

func TestGlobalPlanServiceRevokeCancelsAssignment(t *testing.T) {
	client := newGlobalPlanEntClient(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user := client.User.Create().
		SetEmail("revoke-global-plan@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	plan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetName("Revoke Global").
		SetPrice(19).
		SetValidityDays(30).
		SetValidityUnit("days").
		SaveX(ctx)
	sub := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(plan.ID).
		SetStatus(service.GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -3)).
		SetExpiresAt(now.AddDate(0, 0, 27)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -3)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 4)).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaLimitUsd(20).
		SetQuotaUsedUsd(17).
		SetTierRank(1).
		SetPlanNameSnapshot("Revoke Global").
		SaveX(ctx)

	err := service.NewGlobalPlanService(client).Revoke(ctx, sub.ID, now)
	require.NoError(t, err)

	stored := client.UserGlobalPlanSubscription.GetX(ctx, sub.ID)
	require.Equal(t, service.GlobalPlanStatusCancelled, stored.Status)
	require.True(t, stored.ExpiresAt.Equal(now))
	require.True(t, stored.CurrentPeriodEnd.Equal(now))
}
