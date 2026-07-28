package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/domain"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type consoleUserServiceStub struct {
	user *service.User
}

func (s *consoleUserServiceStub) GetByID(context.Context, int64) (*service.User, error) {
	return s.user, nil
}

type consolePaymentConfigStub struct {
	plans               []*dbent.SubscriptionPlan
	groupInfo           map[int64]service.PlanGroupInfo
	applicableGroupInfo map[int64]service.PlanApplicableGroupInfo
	visibleGroupIDs     []int64
	paymentConfig       *service.PaymentConfig
}

func (s *consolePaymentConfigStub) ListPlansForSale(context.Context) ([]*dbent.SubscriptionPlan, error) {
	return s.plans, nil
}

func (s *consolePaymentConfigStub) ListVisibleGroupIDsForUser(context.Context, []int64) ([]int64, error) {
	if s.visibleGroupIDs != nil {
		return s.visibleGroupIDs, nil
	}
	return []int64{}, nil
}

func (s *consolePaymentConfigStub) GetGroupInfoMap(context.Context, []*dbent.SubscriptionPlan) map[int64]service.PlanGroupInfo {
	return s.groupInfo
}

func (s *consolePaymentConfigStub) GetApplicableGroupInfoMap(context.Context, []*dbent.SubscriptionPlan) map[int64]service.PlanApplicableGroupInfo {
	return s.applicableGroupInfo
}

func (s *consolePaymentConfigStub) GetPaymentConfig(context.Context) (*service.PaymentConfig, error) {
	if s.paymentConfig != nil {
		return s.paymentConfig, nil
	}
	return &service.PaymentConfig{BalanceRechargeMultiplier: 1}, nil
}

type consoleUsageServiceStub struct {
	stats           *usagestats.UserDashboardStats
	trend           []usagestats.TrendDataPoint
	lastGranularity string
	lastTrendStart  time.Time
	lastTrendEnd    time.Time
}

func (s *consoleUsageServiceStub) GetUserDashboardStats(context.Context, int64) (*usagestats.UserDashboardStats, error) {
	return s.stats, nil
}

func (s *consoleUsageServiceStub) GetUserUsageTrendByUserID(_ context.Context, _ int64, startTime, endTime time.Time, granularity string) ([]usagestats.TrendDataPoint, error) {
	s.lastTrendStart = startTime
	s.lastTrendEnd = endTime
	s.lastGranularity = granularity
	return s.trend, nil
}

type consoleAPIKeyServiceStub struct {
	keys []service.APIKey
}

func (s *consoleAPIKeyServiceStub) List(context.Context, int64, pagination.PaginationParams, service.APIKeyListFilters) ([]service.APIKey, *pagination.PaginationResult, error) {
	return s.keys, &pagination.PaginationResult{Total: int64(len(s.keys))}, nil
}

type consoleAnnouncementServiceStub struct {
	items []service.UserAnnouncement
}

func (s *consoleAnnouncementServiceStub) ListForUser(_ context.Context, _ int64, unreadOnly bool) ([]service.UserAnnouncement, error) {
	if !unreadOnly {
		return s.items, nil
	}
	out := make([]service.UserAnnouncement, 0, len(s.items))
	for _, item := range s.items {
		if item.ReadAt == nil {
			out = append(out, item)
		}
	}
	return out, nil
}

type consoleAffiliateServiceStub struct {
	detail *service.AffiliateDetail
}

func (s *consoleAffiliateServiceStub) GetAffiliateDetail(context.Context, int64) (*service.AffiliateDetail, error) {
	return s.detail, nil
}

type consoleGlobalPlanServiceStub struct {
	active     *service.GlobalPlanSnapshot
	activeList []*service.GlobalPlanSnapshot
}

func (s *consoleGlobalPlanServiceStub) GetActive(context.Context, int64, time.Time) (*service.GlobalPlanSnapshot, error) {
	return s.active, nil
}

func (s *consoleGlobalPlanServiceStub) GetActiveList(context.Context, int64, time.Time) ([]*service.GlobalPlanSnapshot, error) {
	if s.activeList != nil {
		return s.activeList, nil
	}
	if s.active != nil {
		return []*service.GlobalPlanSnapshot{s.active}, nil
	}
	return []*service.GlobalPlanSnapshot{}, nil
}

type consolePaymentOrdersStub struct {
	orders []*dbent.PaymentOrder
}

func (s *consolePaymentOrdersStub) GetUserOrders(context.Context, int64, service.OrderListParams) ([]*dbent.PaymentOrder, int, error) {
	return s.orders, len(s.orders), nil
}

func TestConsoleBootstrapReturnsShellState(t *testing.T) {
	gin.SetMode(gin.TestMode)

	now := time.Date(2026, 6, 18, 8, 0, 0, 0, time.UTC)
	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 7, Email: "loaded@example.com", Username: "Loaded User", Role: "user", Balance: 88.25}},
		&consolePaymentConfigStub{},
		&consoleAffiliateServiceStub{},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{items: []service.UserAnnouncement{
			{Announcement: domain.Announcement{ID: 1, Title: "Unread", CreatedAt: now}},
		}},
	)

	router := gin.New()
	router.GET("/api/v1/console/bootstrap", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		h.Bootstrap(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/bootstrap", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{
		"code": 0,
		"message": "success",
		"data": {
			"user": {
				"id": 7,
				"email": "loaded@example.com",
				"name": "Loaded User",
				"role": "user"
			},
			"wallet": {
				"available_balance": 88.25,
				"add_on_credits": 88.25,
				"currency": "USD"
			},
			"global_plan": {
				"active": false,
				"name": "Add-on Credits",
				"quota_limit": 0,
				"quota_used": 0,
				"quota_remaining": 88.25,
				"used_percent": 0
			},
			"affiliate_enabled": true,
			"unread_announcements": 1
		}
	}`, rec.Body.String())
}

func TestConsoleBootstrapReturnsActiveGlobalPlan(t *testing.T) {
	gin.SetMode(gin.TestMode)

	periodEnd := time.Date(2026, 6, 25, 8, 0, 0, 0, time.UTC)
	expiresAt := time.Date(2026, 7, 18, 8, 0, 0, 0, time.UTC)
	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 7, Email: "loaded@example.com", Role: "user", Balance: 88.25}},
		&consolePaymentConfigStub{},
		&consoleAffiliateServiceStub{},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
		&consoleGlobalPlanServiceStub{active: &service.GlobalPlanSnapshot{
			ID:                99,
			UserID:            7,
			PlanID:            101,
			PlanName:          "Pro",
			Status:            service.GlobalPlanStatusActive,
			QuotaLimitUSD:     60,
			QuotaUsedUSD:      15,
			QuotaRemainingUSD: 45,
			CurrentPeriodEnd:  periodEnd,
			ExpiresAt:         expiresAt,
		}},
	)

	router := gin.New()
	router.GET("/api/v1/console/bootstrap", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		h.Bootstrap(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/bootstrap", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{
		"code": 0,
		"message": "success",
		"data": {
			"user": {
				"id": 7,
				"email": "loaded@example.com",
				"name": "loaded@example.com",
				"role": "user"
			},
			"wallet": {
				"available_balance": 88.25,
				"add_on_credits": 88.25,
				"currency": "USD"
			},
			"global_plan": {
				"active": true,
				"name": "Pro",
				"quota_limit": 60,
				"quota_used": 15,
				"quota_remaining": 45,
				"used_percent": 25,
				"current_period_end": "2026-06-25T08:00:00Z",
				"expires_at": "2026-07-18T08:00:00Z"
			},
			"affiliate_enabled": true,
			"unread_announcements": 0
		}
	}`, rec.Body.String())
}

func TestConsoleOverviewReturnsDashboardSummary(t *testing.T) {
	gin.SetMode(gin.TestMode)

	lastUsedAt := time.Date(2026, 6, 18, 8, 0, 0, 0, time.UTC)
	announcementAt := time.Date(2026, 6, 18, 7, 0, 0, 0, time.UTC)
	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 7, Email: "loaded@example.com", Role: "user", Balance: 88.25}},
		&consolePaymentConfigStub{},
		&consoleAffiliateServiceStub{detail: &service.AffiliateDetail{
			AffCount:        4,
			AffHistoryQuota: 18.5,
			Invitees: []service.AffiliateInvitee{
				{UserID: 2, TotalRebate: 3.5},
				{UserID: 3, TotalRebate: 0},
			},
		}},
		&consoleUsageServiceStub{
			stats: &usagestats.UserDashboardStats{
				TotalRequests:   2401,
				ActiveAPIKeys:   3,
				TodayActualCost: 6.75,
			},
			trend: []usagestats.TrendDataPoint{
				{Date: "2026-06-18", Requests: 24, ActualCost: 1.25, TotalTokens: 1200},
			},
		},
		&consoleAPIKeyServiceStub{keys: []service.APIKey{
			{ID: 10, Name: "Production Gateway", Key: "sk-test-production", LastUsedAt: &lastUsedAt},
		}},
		&consoleAnnouncementServiceStub{items: []service.UserAnnouncement{
			{Announcement: domain.Announcement{ID: 1, Title: "New model routes", NotifyMode: service.AnnouncementNotifyModeSilent, CreatedAt: announcementAt}},
		}},
	)

	router := gin.New()
	router.GET("/api/v1/console/overview", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		h.Overview(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/overview?range=7d", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{
		"code": 0,
		"message": "success",
		"data": {
			"stats": {
				"available_credits": 88.25,
				"total_requests": 2401,
				"active_api_keys": 3,
				"usage_today": 6.75,
				"changes": {
					"available_credits": 0,
					"total_requests": 0,
					"usage_today": 0
				}
			},
			"global_plan": {
				"active": false,
				"name": "Add-on Credits",
				"quota_limit": 0,
				"quota_used": 0,
				"quota_remaining": 88.25,
				"used_percent": 0
			},
			"usage_trend": [
				{"date": "2026-06-18", "requests": 24, "credits": 1.25, "tokens": 1200}
			],
			"primary_key": {
				"id": 10,
				"name": "Production Gateway",
				"masked_key": "sk-....tion",
				"last_used_at": "2026-06-18T08:00:00Z",
				"environments": 1
			},
			"referral_summary": {
				"earnings": 18.5,
				"invited": 4,
				"orders": 1
			},
			"latest_announcements": [
				{"id": 1, "title": "New model routes", "type": "update", "published_at": "2026-06-18T07:00:00Z"}
			],
			"affiliate_enabled": true
		}
	}`, rec.Body.String())
}

func TestConsoleOverviewUsesHourlyTrendForTodayRange(t *testing.T) {
	gin.SetMode(gin.TestMode)

	usageStub := &consoleUsageServiceStub{
		stats: &usagestats.UserDashboardStats{},
		trend: []usagestats.TrendDataPoint{
			{Date: "2026-06-22T10:00:00Z", Requests: 3, ActualCost: 2.5, TotalTokens: 5000},
		},
	}
	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 7, Email: "loaded@example.com", Role: "user", Balance: 88.25}},
		&consolePaymentConfigStub{},
		&consoleAffiliateServiceStub{},
		usageStub,
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
	)

	router := gin.New()
	router.GET("/api/v1/console/overview", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		h.Overview(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/overview?range=today", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "hour", usageStub.lastGranularity)
	require.True(t, usageStub.lastTrendEnd.After(usageStub.lastTrendStart))
	require.Contains(t, rec.Body.String(), `"date":"2026-06-22T10:00:00Z"`)
}

func TestConsoleBillingReturnsWalletAndPlans(t *testing.T) {
	gin.SetMode(gin.TestMode)
	periodStart := time.Date(2026, 6, 18, 8, 0, 0, 0, time.UTC)
	periodEnd := time.Date(2026, 6, 25, 8, 0, 0, 0, time.UTC)
	expiresAt := time.Date(2026, 7, 18, 8, 0, 0, 0, time.UTC)

	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 1, Balance: 210.75}},
		&consolePaymentConfigStub{
			paymentConfig: &service.PaymentConfig{BalanceRechargeMultiplier: 1.05},
			plans: []*dbent.SubscriptionPlan{
				{
					ID:                101,
					Name:              "Pro",
					Price:             49,
					PlanScope:         service.PlanScopeGlobal,
					QuotaPeriod:       service.GlobalPlanQuotaPeriodWeek,
					QuotaPerPeriodUsd: 60,
					MonthlyMaxUsd:     240,
					ValidityUnit:      "month",
					Features:          "Priority routing\nUsage analytics",
				},
				{
					ID:                102,
					Name:              "Max",
					Price:             89,
					PlanScope:         service.PlanScopeGlobal,
					QuotaPeriod:       service.GlobalPlanQuotaPeriodMonth,
					QuotaPerPeriodUsd: 260,
					MonthlyMaxUsd:     260,
					ValidityUnit:      "month",
					Features:          "Monthly pool",
				},
			},
		},
		&consoleAffiliateServiceStub{},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
		&consoleGlobalPlanServiceStub{active: &service.GlobalPlanSnapshot{
			ID:                 900,
			UserID:             1,
			PlanID:             101,
			PlanName:           "Pro",
			Status:             service.GlobalPlanStatusActive,
			TierRank:           20,
			CurrentPeriodStart: periodStart,
			CurrentPeriodEnd:   periodEnd,
			ExpiresAt:          expiresAt,
			QuotaLimitUSD:      60,
			QuotaUsedUSD:       30,
			QuotaRemainingUSD:  30,
		}},
	)

	router := gin.New()
	router.GET("/api/v1/console/billing", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
		h.Billing(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/billing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{
		"code": 0,
		"message": "success",
		"data": {
			"wallet": {
				"available_balance": 210.75,
				"add_on_credits": 210.75,
				"currency": "USD"
			},
				"active_global_plan": {
					"id": 900,
					"plan_id": 101,
					"name": "Pro",
					"plan_category": "default",
					"status": "active",
				"tier_rank": 20,
				"quota_limit": 60,
				"quota_used": 30,
				"quota_remaining": 30,
				"period_start": "2026-06-18T08:00:00Z",
				"period_end": "2026-06-25T08:00:00Z",
					"expires_at": "2026-07-18T08:00:00Z"
				},
				"active_global_plans": [
					{
						"id": 900,
						"plan_id": 101,
						"name": "Pro",
						"plan_category": "default",
						"status": "active",
						"tier_rank": 20,
						"quota_limit": 60,
						"quota_used": 30,
						"quota_remaining": 30,
						"period_start": "2026-06-18T08:00:00Z",
						"period_end": "2026-06-25T08:00:00Z",
						"expires_at": "2026-07-18T08:00:00Z"
					}
				],
				"plans": [
					{
					"id": 101,
					"name": "Pro",
					"price": 49,
					"currency": "USD",
						"billing_period": "month",
						"plan_scope": "global",
						"plan_category": "default",
						"applicable_group_mode": "all",
						"applicable_groups": [],
						"tier_rank": 0,
					"quota_period": "week",
					"quota_period_label": "Weekly Credits",
					"quota_per_period_usd": 60,
					"weekly_credits": 60,
					"monthly_max_credits": 240,
					"features": ["Priority routing", "Usage analytics"]
				},
				{
					"id": 102,
					"name": "Max",
					"price": 89,
					"currency": "USD",
						"billing_period": "month",
						"plan_scope": "global",
						"plan_category": "default",
						"applicable_group_mode": "all",
						"applicable_groups": [],
						"tier_rank": 0,
					"quota_period": "month",
					"quota_period_label": "Monthly Credits",
					"quota_per_period_usd": 260,
					"weekly_credits": 260,
					"monthly_max_credits": 260,
					"features": ["Monthly pool"]
				}
			],
			"add_ons": [
				{"amount": 10, "credits": 10.5, "currency": "USD", "preset": true},
				{"amount": 25, "credits": 26.25, "currency": "USD", "preset": true},
				{"amount": 50, "credits": 52.5, "currency": "USD", "preset": true},
				{"amount": 100, "credits": 105, "currency": "USD", "preset": true}
			],
			"payment_methods": [
				{"type": "stripe", "available": true}
			],
			"activity": []
		}
	}`, rec.Body.String())
}

func TestConsoleBillingIncludesGroupPlanMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	groupID := int64(66)

	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 1, Balance: 0}},
		&consolePaymentConfigStub{
			plans: []*dbent.SubscriptionPlan{
				{
					ID:           202,
					GroupID:      &groupID,
					Name:         "Claude Team",
					Price:        39,
					PlanScope:    service.PlanScopeGroup,
					ValidityDays: 30,
					ValidityUnit: "days",
					Features:     "Claude routing",
				},
			},
			groupInfo: map[int64]service.PlanGroupInfo{
				groupID: {Platform: service.PlatformAnthropic, Name: "Claude Subscription"},
			},
		},
		&consoleAffiliateServiceStub{},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
	)

	router := gin.New()
	router.GET("/api/v1/console/billing", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
		h.Billing(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/billing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"plan_scope":"group"`)
	require.Contains(t, rec.Body.String(), `"group_id":66`)
	require.Contains(t, rec.Body.String(), `"group_platform":"anthropic"`)
	require.Contains(t, rec.Body.String(), `"group_name":"Claude Subscription"`)
}

func TestConsoleBillingFiltersBlacklistedGlobalPlanForHeldGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	groupID := int64(88)

	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 1, Balance: 0, AllowedGroups: []int64{groupID}}},
		&consolePaymentConfigStub{
			visibleGroupIDs: []int64{groupID},
			plans: []*dbent.SubscriptionPlan{
				{
					ID:                  301,
					Name:                "Hidden Global",
					Price:               29,
					PlanScope:           service.PlanScopeGlobal,
					PlanCategory:        "default",
					ApplicableGroupMode: service.PlanApplicableGroupModeBlacklist,
					ApplicableGroupIds:  []int64{groupID},
					QuotaPeriod:         service.GlobalPlanQuotaPeriodWeek,
					QuotaPerPeriodUsd:   30,
					ValidityUnit:        "month",
				},
				{
					ID:                302,
					Name:              "Visible Global",
					Price:             49,
					PlanScope:         service.PlanScopeGlobal,
					PlanCategory:      "default",
					QuotaPeriod:       service.GlobalPlanQuotaPeriodWeek,
					QuotaPerPeriodUsd: 50,
					ValidityUnit:      "month",
				},
			},
		},
		&consoleAffiliateServiceStub{},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
	)

	router := gin.New()
	router.GET("/api/v1/console/billing", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
		h.Billing(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/billing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotContains(t, rec.Body.String(), "Hidden Global")
	require.Contains(t, rec.Body.String(), "Visible Global")
}

func TestConsoleBillingKeepsBlacklistedGlobalPlanWhenUserHasOtherEligibleGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	blockedGroupID := int64(88)
	eligibleGroupID := int64(89)

	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 1, Balance: 0, AllowedGroups: []int64{blockedGroupID, eligibleGroupID}}},
		&consolePaymentConfigStub{
			visibleGroupIDs: []int64{blockedGroupID, eligibleGroupID},
			plans: []*dbent.SubscriptionPlan{
				{
					ID:                  301,
					Name:                "Partially Available Global",
					Price:               29,
					PlanScope:           service.PlanScopeGlobal,
					PlanCategory:        "default",
					ApplicableGroupMode: service.PlanApplicableGroupModeBlacklist,
					ApplicableGroupIds:  []int64{blockedGroupID},
					QuotaPeriod:         service.GlobalPlanQuotaPeriodWeek,
					QuotaPerPeriodUsd:   30,
					ValidityUnit:        "month",
				},
			},
			applicableGroupInfo: map[int64]service.PlanApplicableGroupInfo{
				blockedGroupID: {ID: blockedGroupID, Name: "OpenAI - Test", Platform: service.PlatformOpenAI},
			},
		},
		&consoleAffiliateServiceStub{},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
	)

	router := gin.New()
	router.GET("/api/v1/console/billing", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
		h.Billing(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/billing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "Partially Available Global")
	require.Contains(t, rec.Body.String(), `"applicable_group_mode":"blacklist"`)
	require.Contains(t, rec.Body.String(), "OpenAI - Test")
}

func TestConsoleBillingPeriodUsesConfiguredValidity(t *testing.T) {
	require.Equal(t, "22 days", consoleBillingPeriod(22, "days"))
	require.Equal(t, "day", consoleBillingPeriod(1, "day"))
	require.Equal(t, "2 weeks", consoleBillingPeriod(2, "weeks"))
	require.Equal(t, "3 months", consoleBillingPeriod(3, "months"))
	require.Equal(t, "year", consoleBillingPeriod(1, "year"))
	require.Equal(t, "month", consoleBillingPeriod(0, "month"))
}

func TestConsoleBillingReturnsRecentOrderActivity(t *testing.T) {
	gin.SetMode(gin.TestMode)

	createdAt := time.Date(2026, 6, 18, 8, 0, 0, 0, time.UTC)
	payURL := "https://checkout.example/pay/77"
	h := NewConsoleHandler(
		&consoleUserServiceStub{user: &service.User{ID: 1, Email: "billing@example.com", Balance: 210.75}},
		&consolePaymentConfigStub{},
		&consoleAffiliateServiceStub{},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
		nil,
		&consolePaymentOrdersStub{orders: []*dbent.PaymentOrder{
			{
				ID:         77,
				CreatedAt:  createdAt,
				OutTradeNo: "ORD-REAL-77",
				OrderType:  "global_plan_upgrade",
				Amount:     20,
				PayAmount:  144,
				PayURL:     &payURL,
				Status:     service.OrderStatusCompleted,
				ProviderSnapshot: map[string]any{
					"schema_version": 2,
					"provider_key":   "jeepay",
					"currency":       "CNY",
				},
				RefundSnapshot: map[string]any{
					"amount_currency":        "USD",
					"payment_currency":       "CNY",
					"currency_exchange_rate": 7.2,
				},
			},
		}},
	)

	router := gin.New()
	router.GET("/api/v1/console/billing", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
		h.Billing(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/billing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"activity"`)
	require.Contains(t, rec.Body.String(), `"reference":"ORD-REAL-77"`)
	require.Contains(t, rec.Body.String(), `"type":"global_plan_upgrade"`)
	require.Contains(t, rec.Body.String(), `"label":"Global Plan Upgrade"`)
	require.Contains(t, rec.Body.String(), `"amount":20`)
	require.Contains(t, rec.Body.String(), `"currency":"USD"`)
	require.Contains(t, rec.Body.String(), `"pay_amount":144`)
	require.Contains(t, rec.Body.String(), `"payment_currency":"CNY"`)
	require.Contains(t, rec.Body.String(), `"pay_url":"https://checkout.example/pay/77"`)
}

func TestConsoleReferralReturnsInviteSummary(t *testing.T) {
	gin.SetMode(gin.TestMode)

	joinedAt := time.Date(2026, 6, 18, 8, 30, 0, 0, time.UTC)
	h := NewConsoleHandler(
		&consoleUserServiceStub{},
		&consolePaymentConfigStub{},
		&consoleAffiliateServiceStub{detail: &service.AffiliateDetail{
			UserID:                     1,
			AffCode:                    "PRO-REF",
			AffCount:                   8,
			AffHistoryQuota:            31.5,
			AffFrozenQuota:             4,
			EffectiveRebateRatePercent: 12.5,
			Invitees: []service.AffiliateInvitee{
				{UserID: 3, Email: "al***@gmail.com", CreatedAt: &joinedAt, TotalRebate: 7.25},
				{UserID: 4, Email: "bo***@gmail.com", CreatedAt: &joinedAt, TotalRebate: 0},
			},
		}},
		&consoleUsageServiceStub{},
		&consoleAPIKeyServiceStub{},
		&consoleAnnouncementServiceStub{},
	)

	router := gin.New()
	router.GET("/api/v1/console/referral", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
		h.Referral(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/console/referral", nil)
	req.Header.Set("X-Frontend-Origin", "https://example.com/")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{
		"code": 0,
		"message": "success",
		"data": {
			"invite_link": "https://example.com/register?ref=PRO-REF",
			"rules": {
				"signup_bonus": 0,
				"inviter_signup_reward": 0,
				"inviter_signup_reward_cap": 0,
				"rebate_rate": 0.125,
				"add_on_excluded": true
			},
			"stats": {
				"total_invited": 8,
				"credits_earned": 31.5,
				"pending_rewards": 4
			},
			"recent_invitees": [
				{
					"id": 3,
					"email": "al***@gmail.com",
					"joined_at": "2026-06-18T08:30:00Z",
					"status": "rewarded",
					"earnings": 7.25
				},
				{
					"id": 4,
					"email": "bo***@gmail.com",
					"joined_at": "2026-06-18T08:30:00Z",
					"status": "joined",
					"earnings": 0
				}
			]
		}
	}`, rec.Body.String())
}
