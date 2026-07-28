//go:build unit

package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/enttest"
	"github.com/Wei-Shaw/sub2api/internal/domain"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "modernc.org/sqlite"
)

func TestPaymentHandlerGlobalPlanUpgradeQuote(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := context.Background()
	client := newPaymentHandlerGlobalPlanTestClient(t)
	now := time.Now().UTC()

	user := client.User.Create().
		SetEmail("upgrade-quote-handler@example.com").
		SetPasswordHash("hash").
		SetStatus(domain.StatusActive).
		SaveX(ctx)
	currentPlan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetTierRank(10).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaPerPeriodUsd(30).
		SetMonthlyMaxUsd(120).
		SetName("Starter").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("day").
		SaveX(ctx)
	targetPlan := client.SubscriptionPlan.Create().
		SetPlanScope(service.PlanScopeGlobal).
		SetTierRank(20).
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
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
		SetQuotaPeriod(service.GlobalPlanQuotaPeriodWeek).
		SetQuotaLimitUsd(30).
		SetQuotaUsedUsd(7).
		SetTierRank(10).
		SetPlanNameSnapshot("Starter").
		SaveX(ctx)

	paymentSvc := &service.PaymentService{}
	paymentSvc.SetGlobalPlanService(service.NewGlobalPlanService(client))
	h := NewPaymentHandler(paymentSvc, nil, nil)
	router := gin.New()
	router.POST("/api/v1/payment/global-plans/upgrade-quote", func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: user.ID})
		h.GlobalPlanUpgradeQuote(c)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payment/global-plans/upgrade-quote", bytes.NewBufferString(`{"target_plan_id":`+strconv.FormatInt(targetPlan.ID, 10)+`}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var parsed struct {
		Code int                            `json:"code"`
		Data service.GlobalPlanUpgradeQuote `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &parsed))
	require.Equal(t, 0, parsed.Code)
	require.Equal(t, sub.ID, parsed.Data.CurrentSubscriptionID)
	require.Equal(t, currentPlan.ID, parsed.Data.FromPlanID)
	require.Equal(t, targetPlan.ID, parsed.Data.ToPlanID)
	require.Equal(t, 49.0, parsed.Data.CurrentPlanPrice)
	require.Equal(t, 99.0, parsed.Data.TargetPlanPrice)
	require.InDelta(t, 33.33, parsed.Data.UpgradePrice, 0.02)
	require.Equal(t, "USD", parsed.Data.Currency)
	require.True(t, parsed.Data.RemainingSeconds > 0)
	require.True(t, parsed.Data.CycleSeconds > parsed.Data.RemainingSeconds)
	require.True(t, parsed.Data.ExpiresAt.After(now))
}

func newPaymentHandlerGlobalPlanTestClient(t *testing.T) *dbent.Client {
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
