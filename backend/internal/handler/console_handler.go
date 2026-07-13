package handler

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

type consoleUserService interface {
	GetByID(ctx context.Context, id int64) (*service.User, error)
}

type consolePaymentConfigService interface {
	ListPlansForSale(ctx context.Context) ([]*dbent.SubscriptionPlan, error)
	ListVisibleGroupIDsForUser(ctx context.Context, allowedGroupIDs []int64) ([]int64, error)
	GetGroupInfoMap(ctx context.Context, plans []*dbent.SubscriptionPlan) map[int64]service.PlanGroupInfo
	GetApplicableGroupInfoMap(ctx context.Context, plans []*dbent.SubscriptionPlan) map[int64]service.PlanApplicableGroupInfo
	GetPaymentConfig(ctx context.Context) (*service.PaymentConfig, error)
}

type consoleAffiliateService interface {
	GetAffiliateDetail(ctx context.Context, userID int64) (*service.AffiliateDetail, error)
}

type consoleUsageService interface {
	GetUserDashboardStats(ctx context.Context, userID int64) (*usagestats.UserDashboardStats, error)
	GetUserUsageTrendByUserID(ctx context.Context, userID int64, startTime, endTime time.Time, granularity string) ([]usagestats.TrendDataPoint, error)
}

type consoleAPIKeyService interface {
	List(ctx context.Context, userID int64, params pagination.PaginationParams, filters service.APIKeyListFilters) ([]service.APIKey, *pagination.PaginationResult, error)
}

type consoleAnnouncementService interface {
	ListForUser(ctx context.Context, userID int64, unreadOnly bool) ([]service.UserAnnouncement, error)
}

type consoleGlobalPlanService interface {
	GetActive(ctx context.Context, userID int64, now time.Time) (*service.GlobalPlanSnapshot, error)
	GetActiveList(ctx context.Context, userID int64, now time.Time) ([]*service.GlobalPlanSnapshot, error)
}

type consolePaymentOrderService interface {
	GetUserOrders(ctx context.Context, userID int64, p service.OrderListParams) ([]*dbent.PaymentOrder, int, error)
}

type consoleSettingService interface {
	GetPublicSettings(ctx context.Context) (*service.PublicSettings, error)
	GetAffiliateInviterSignupReward(ctx context.Context) float64
	GetAffiliateInviterSignupRewardCap(ctx context.Context) float64
	GetAffiliateInviteeSignupReward(ctx context.Context) float64
}

// ConsoleHandler provides BFF-style endpoints for the new user console.
type ConsoleHandler struct {
	userService           consoleUserService
	paymentConfig         consolePaymentConfigService
	affiliate             consoleAffiliateService
	usage                 consoleUsageService
	apiKeys               consoleAPIKeyService
	announcements         consoleAnnouncementService
	globalPlans           consoleGlobalPlanService
	paymentOrders         consolePaymentOrderService
	settings              consoleSettingService
	topUpPresets          []consoleBillingAddOn
	defaultCurrency       string
	defaultGlobalPlanName string
}

func NewConsoleHandler(userService consoleUserService, paymentConfig consolePaymentConfigService, affiliate consoleAffiliateService, usage consoleUsageService, apiKeys consoleAPIKeyService, announcements consoleAnnouncementService, optionalDeps ...any) *ConsoleHandler {
	var globalPlanService consoleGlobalPlanService
	var paymentOrderService consolePaymentOrderService
	var settingService consoleSettingService
	for _, dep := range optionalDeps {
		switch typed := dep.(type) {
		case nil:
			continue
		case consoleGlobalPlanService:
			globalPlanService = typed
		case consolePaymentOrderService:
			paymentOrderService = typed
		case consoleSettingService:
			settingService = typed
		}
	}
	return &ConsoleHandler{
		userService:           userService,
		paymentConfig:         paymentConfig,
		affiliate:             affiliate,
		usage:                 usage,
		apiKeys:               apiKeys,
		announcements:         announcements,
		globalPlans:           globalPlanService,
		paymentOrders:         paymentOrderService,
		settings:              settingService,
		defaultCurrency:       "USD",
		defaultGlobalPlanName: "Add-on Credits",
		topUpPresets: []consoleBillingAddOn{
			{Amount: 10, Credits: 10, Currency: "USD", Preset: true},
			{Amount: 25, Credits: 25, Currency: "USD", Preset: true},
			{Amount: 50, Credits: 50, Currency: "USD", Preset: true},
			{Amount: 100, Credits: 100, Currency: "USD", Preset: true},
		},
	}
}

// Bootstrap returns the minimum state needed to render the console shell.
func (h *ConsoleHandler) Bootstrap(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	user, err := h.userService.GetByID(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	unreadAnnouncements, err := h.announcements.ListForUser(c.Request.Context(), subject.UserID, true)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	globalPlan, err := h.consoleGlobalPlan(c.Request.Context(), subject.UserID, user.Balance)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, consoleBootstrapResponse{
		User: consoleBootstrapUser{
			ID:        user.ID,
			Email:     user.Email,
			Name:      consoleDisplayName(user),
			AvatarURL: user.AvatarURL,
			Role:      user.Role,
		},
		Wallet: consoleBillingWallet{
			AvailableBalance: user.Balance,
			AddOnCredits:     user.Balance,
			Currency:         h.defaultCurrency,
		},
		GlobalPlan:          globalPlan,
		UnreadAnnouncements: len(unreadAnnouncements),
		AffiliateEnabled:    h.consoleAffiliateEnabled(c.Request.Context()),
	})
}

// Overview returns the dashboard summary needed by the new console overview.
func (h *ConsoleHandler) Overview(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	user, err := h.userService.GetByID(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	stats, err := h.usage.GetUserDashboardStats(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	endTime := time.Now().UTC()
	startTime, trendEndTime, granularity := consoleOverviewTrendWindow(c.DefaultQuery("range", "7d"), endTime)
	trend, err := h.usage.GetUserUsageTrendByUserID(c.Request.Context(), subject.UserID, startTime, trendEndTime, granularity)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	keys, _, err := h.apiKeys.List(c.Request.Context(), subject.UserID, pagination.PaginationParams{Page: 1, PageSize: 1, SortBy: "last_used_at", SortOrder: "desc"}, service.APIKeyListFilters{})
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	affiliateDetail, err := h.affiliate.GetAffiliateDetail(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	announcements, err := h.announcements.ListForUser(c.Request.Context(), subject.UserID, false)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	globalPlan, err := h.consoleGlobalPlan(c.Request.Context(), subject.UserID, user.Balance)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	response.Success(c, consoleOverviewResponse{
		Stats: consoleOverviewStats{
			AvailableCredits: user.Balance,
			TotalRequests:    stats.TotalRequests,
			ActiveAPIKeys:    stats.ActiveAPIKeys,
			UsageToday:       stats.TodayActualCost,
			Changes: consoleOverviewChanges{
				AvailableCredits: 0,
				TotalRequests:    0,
				UsageToday:       0,
			},
		},
		GlobalPlan:          globalPlan,
		UsageTrend:          consoleTrendFromUsage(trend),
		PrimaryKey:          consolePrimaryKeyFromList(keys),
		ReferralSummary:     consoleReferralSummaryFromDetail(affiliateDetail),
		AffiliateEnabled:    h.consoleAffiliateEnabled(c.Request.Context()),
		LatestAnnouncements: consoleAnnouncementSummaries(announcements, 5),
	})
}

// Billing returns the billing summary needed by the new console billing page.
func (h *ConsoleHandler) Billing(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	user, err := h.userService.GetByID(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	plans, err := h.paymentConfig.ListPlansForSale(c.Request.Context())
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	out := consoleBillingResponse{
		Wallet: consoleBillingWallet{
			AvailableBalance: user.Balance,
			AddOnCredits:     user.Balance,
			Currency:         h.defaultCurrency,
		},
		Plans:          make([]consoleBillingPlan, 0, len(plans)),
		AddOns:         h.consoleBillingAddOns(c.Request.Context()),
		PaymentMethods: []consolePaymentMethod{{Type: "stripe", Available: true}},
		Activity:       []consoleBillingActivity{},
	}
	activeGlobalPlan, err := h.consoleActiveBillingGlobalPlan(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	out.ActiveGlobalPlan = activeGlobalPlan

	heldGroupIDs, err := h.paymentConfig.ListVisibleGroupIDsForUser(c.Request.Context(), user.AllowedGroups)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	plans = filterConsoleVisibleGlobalPlans(plans, heldGroupIDs)
	groupInfo := h.paymentConfig.GetGroupInfoMap(c.Request.Context(), plans)
	scopeGroupInfo := h.paymentConfig.GetApplicableGroupInfoMap(c.Request.Context(), plans)
	activeGlobalPlans, err := h.consoleActiveBillingGlobalPlans(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	out.ActiveGlobalPlans = activeGlobalPlans
	for _, plan := range plans {
		out.Plans = append(out.Plans, consolePlanFromSubscriptionPlan(plan, h.defaultCurrency, groupInfo, scopeGroupInfo))
	}
	orders, err := h.consoleBillingActivity(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	out.Activity = orders

	response.Success(c, out)
}

// Referral returns a compact invite/rebate summary for the new console page.
func (h *ConsoleHandler) Referral(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}

	detail, err := h.affiliate.GetAffiliateDetail(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	invitees := make([]consoleReferralInvitee, 0, len(detail.Invitees))
	for _, invitee := range detail.Invitees {
		invitees = append(invitees, consoleReferralInviteeFromAffiliate(invitee))
	}

	response.Success(c, consoleReferralResponse{
		InviteLink: buildConsoleInviteLink(c, detail.AffCode),
		Rules: consoleReferralRules{
			SignupBonus:            h.affiliateInviteeSignupReward(c.Request.Context()),
			InviterSignupReward:    h.affiliateInviterSignupReward(c.Request.Context()),
			InviterSignupRewardCap: h.affiliateInviterSignupRewardCap(c.Request.Context()),
			RebateRate:             detail.EffectiveRebateRatePercent / 100,
			AddOnExcluded:          true,
		},
		Stats: consoleReferralStats{
			TotalInvited:   detail.AffCount,
			CreditsEarned:  detail.AffHistoryQuota,
			PendingRewards: detail.AffFrozenQuota,
		},
		RecentInvitees: invitees,
	})
}

type consoleBillingResponse struct {
	Wallet            consoleBillingWallet       `json:"wallet"`
	ActiveGlobalPlan  *consoleBillingGlobalPlan  `json:"active_global_plan,omitempty"`
	ActiveGlobalPlans []consoleBillingGlobalPlan `json:"active_global_plans"`
	Plans             []consoleBillingPlan       `json:"plans"`
	AddOns            []consoleBillingAddOn      `json:"add_ons"`
	PaymentMethods    []consolePaymentMethod     `json:"payment_methods"`
	Activity          []consoleBillingActivity   `json:"activity"`
}

type consolePaymentMethod struct {
	Type      string `json:"type"`
	Available bool   `json:"available"`
}

type consoleBootstrapResponse struct {
	User                consoleBootstrapUser       `json:"user"`
	Wallet              consoleBillingWallet       `json:"wallet"`
	GlobalPlan          consoleBootstrapGlobalPlan `json:"global_plan"`
	UnreadAnnouncements int                        `json:"unread_announcements"`
	AffiliateEnabled    bool                       `json:"affiliate_enabled"`
}

type consoleBootstrapUser struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Role      string `json:"role"`
}

type consoleBootstrapGlobalPlan struct {
	Active           bool    `json:"active"`
	Name             string  `json:"name"`
	QuotaLimit       float64 `json:"quota_limit"`
	QuotaUsed        float64 `json:"quota_used"`
	QuotaRemaining   float64 `json:"quota_remaining"`
	UsedPercent      float64 `json:"used_percent"`
	CurrentPeriodEnd string  `json:"current_period_end,omitempty"`
	ExpiresAt        string  `json:"expires_at,omitempty"`
}

type consoleBillingWallet struct {
	AvailableBalance float64 `json:"available_balance"`
	AddOnCredits     float64 `json:"add_on_credits"`
	Currency         string  `json:"currency"`
}

type consoleOverviewResponse struct {
	Stats               consoleOverviewStats          `json:"stats"`
	GlobalPlan          consoleBootstrapGlobalPlan    `json:"global_plan"`
	UsageTrend          []consoleOverviewTrendPoint   `json:"usage_trend"`
	PrimaryKey          *consoleOverviewPrimaryKey    `json:"primary_key,omitempty"`
	ReferralSummary     consoleOverviewReferral       `json:"referral_summary"`
	AffiliateEnabled    bool                          `json:"affiliate_enabled"`
	LatestAnnouncements []consoleOverviewAnnouncement `json:"latest_announcements"`
}

type consoleOverviewStats struct {
	AvailableCredits float64                `json:"available_credits"`
	TotalRequests    int64                  `json:"total_requests"`
	ActiveAPIKeys    int64                  `json:"active_api_keys"`
	UsageToday       float64                `json:"usage_today"`
	Changes          consoleOverviewChanges `json:"changes"`
}

type consoleOverviewChanges struct {
	AvailableCredits float64 `json:"available_credits"`
	TotalRequests    float64 `json:"total_requests"`
	UsageToday       float64 `json:"usage_today"`
}

type consoleOverviewTrendPoint struct {
	Date     string  `json:"date"`
	Requests int64   `json:"requests"`
	Credits  float64 `json:"credits"`
	Tokens   int64   `json:"tokens"`
}

type consoleOverviewPrimaryKey struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	MaskedKey    string `json:"masked_key"`
	LastUsedAt   string `json:"last_used_at,omitempty"`
	Environments int    `json:"environments"`
}

type consoleOverviewReferral struct {
	Earnings float64 `json:"earnings"`
	Invited  int     `json:"invited"`
	Orders   int     `json:"orders"`
}

type consoleOverviewAnnouncement struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Type        string `json:"type"`
	PublishedAt string `json:"published_at"`
}

type consoleBillingPlan struct {
	ID                  int64                        `json:"id"`
	Name                string                       `json:"name"`
	Price               float64                      `json:"price"`
	Currency            string                       `json:"currency"`
	BillingPeriod       string                       `json:"billing_period"`
	PlanScope           string                       `json:"plan_scope"`
	PlanCategory        string                       `json:"plan_category"`
	ApplicableGroupMode string                       `json:"applicable_group_mode"`
	ApplicableGroups    []consolePlanApplicableGroup `json:"applicable_groups"`
	GroupID             *int64                       `json:"group_id,omitempty"`
	GroupPlatform       string                       `json:"group_platform,omitempty"`
	GroupName           string                       `json:"group_name,omitempty"`
	TierRank            int                          `json:"tier_rank"`
	QuotaPeriod         string                       `json:"quota_period"`
	QuotaPeriodLabel    string                       `json:"quota_period_label"`
	QuotaPerPeriodUSD   float64                      `json:"quota_per_period_usd"`
	WeeklyCredits       float64                      `json:"weekly_credits"`
	MonthlyMaxCredits   float64                      `json:"monthly_max_credits"`
	Features            []string                     `json:"features"`
}

type consoleBillingGlobalPlan struct {
	ID             int64   `json:"id"`
	PlanID         int64   `json:"plan_id"`
	Name           string  `json:"name"`
	PlanCategory   string  `json:"plan_category"`
	Status         string  `json:"status"`
	TierRank       int     `json:"tier_rank"`
	QuotaLimit     float64 `json:"quota_limit"`
	QuotaUsed      float64 `json:"quota_used"`
	QuotaRemaining float64 `json:"quota_remaining"`
	PeriodStart    string  `json:"period_start"`
	PeriodEnd      string  `json:"period_end"`
	ExpiresAt      string  `json:"expires_at"`
}

type consolePlanApplicableGroup struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
}

type consoleBillingAddOn struct {
	Amount   float64 `json:"amount"`
	Credits  float64 `json:"credits"`
	Currency string  `json:"currency"`
	Preset   bool    `json:"preset"`
}

type consoleBillingActivity struct {
	ID              int64   `json:"id"`
	Date            string  `json:"date"`
	Reference       string  `json:"reference"`
	Type            string  `json:"type"`
	Label           string  `json:"label"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	PayAmount       float64 `json:"pay_amount"`
	PaymentCurrency string  `json:"payment_currency"`
	Status          string  `json:"status"`
	PayURL          string  `json:"pay_url,omitempty"`
	ReceiptURL      string  `json:"receipt_url,omitempty"`
}

type consoleReferralResponse struct {
	InviteLink     string                   `json:"invite_link"`
	Rules          consoleReferralRules     `json:"rules"`
	Stats          consoleReferralStats     `json:"stats"`
	RecentInvitees []consoleReferralInvitee `json:"recent_invitees"`
}

type consoleReferralRules struct {
	SignupBonus            float64 `json:"signup_bonus"`
	InviterSignupReward    float64 `json:"inviter_signup_reward"`
	InviterSignupRewardCap float64 `json:"inviter_signup_reward_cap"`
	RebateRate             float64 `json:"rebate_rate"`
	AddOnExcluded          bool    `json:"add_on_excluded"`
}

type consoleReferralStats struct {
	TotalInvited   int     `json:"total_invited"`
	CreditsEarned  float64 `json:"credits_earned"`
	PendingRewards float64 `json:"pending_rewards"`
}

type consoleReferralInvitee struct {
	ID       int64   `json:"id"`
	Email    string  `json:"email"`
	JoinedAt string  `json:"joined_at"`
	Status   string  `json:"status"`
	Earnings float64 `json:"earnings"`
}

func consolePlanFromSubscriptionPlan(plan *dbent.SubscriptionPlan, currency string, groupInfo map[int64]service.PlanGroupInfo, scopeGroupInfo map[int64]service.PlanApplicableGroupInfo) consoleBillingPlan {
	quotaPeriod := strings.ToLower(strings.TrimSpace(plan.QuotaPeriod))
	quotaPerPeriod := plan.QuotaPerPeriodUsd
	if quotaPerPeriod <= 0 {
		quotaPerPeriod = plan.Price
	}
	monthlyMax := plan.MonthlyMaxUsd
	if monthlyMax <= 0 {
		if quotaPeriod == service.GlobalPlanQuotaPeriodMonth {
			monthlyMax = quotaPerPeriod
		} else {
			monthlyMax = quotaPerPeriod * 4
		}
	}
	out := consoleBillingPlan{
		ID:                  int64(plan.ID),
		Name:                plan.Name,
		Price:               plan.Price,
		Currency:            currency,
		BillingPeriod:       consoleBillingPeriod(plan.ValidityDays, plan.ValidityUnit),
		PlanScope:           normalizeConsolePlanScope(plan.PlanScope),
		PlanCategory:        service.NormalizePlanCategoryForDisplay(plan.PlanCategory),
		ApplicableGroupMode: service.NormalizePlanApplicableGroupModeForDisplay(plan.ApplicableGroupMode),
		ApplicableGroups:    consolePlanApplicableGroups(plan.ApplicableGroupIds, scopeGroupInfo),
		TierRank:            plan.TierRank,
		QuotaPeriod:         quotaPeriod,
		QuotaPeriodLabel:    consoleQuotaPeriodLabel(quotaPeriod),
		QuotaPerPeriodUSD:   quotaPerPeriod,
		WeeklyCredits:       quotaPerPeriod,
		MonthlyMaxCredits:   monthlyMax,
		Features:            splitConsoleFeatures(plan.Features),
	}
	if plan.GroupID != nil {
		out.GroupID = plan.GroupID
		if info, ok := groupInfo[*plan.GroupID]; ok {
			out.GroupPlatform = info.Platform
			out.GroupName = info.Name
		}
	}
	return out
}

func consolePlanApplicableGroups(ids []int64, info map[int64]service.PlanApplicableGroupInfo) []consolePlanApplicableGroup {
	if len(ids) == 0 {
		return []consolePlanApplicableGroup{}
	}
	out := make([]consolePlanApplicableGroup, 0, len(ids))
	for _, id := range ids {
		if item, ok := info[id]; ok {
			out = append(out, consolePlanApplicableGroup{ID: item.ID, Name: item.Name, Platform: item.Platform})
		} else {
			out = append(out, consolePlanApplicableGroup{ID: id})
		}
	}
	return out
}

func consoleQuotaPeriodLabel(period string) string {
	switch strings.ToLower(strings.TrimSpace(period)) {
	case service.GlobalPlanQuotaPeriodMonth:
		return "Monthly Credits"
	default:
		return "Weekly Credits"
	}
}

func normalizeConsolePlanScope(scope string) string {
	if strings.EqualFold(strings.TrimSpace(scope), service.PlanScopeGlobal) {
		return service.PlanScopeGlobal
	}
	return service.PlanScopeGroup
}

func filterConsoleVisibleGlobalPlans(plans []*dbent.SubscriptionPlan, heldGroupIDs []int64) []*dbent.SubscriptionPlan {
	if len(plans) == 0 {
		return plans
	}
	out := make([]*dbent.SubscriptionPlan, 0, len(plans))
	for _, plan := range plans {
		if plan == nil || !strings.EqualFold(plan.PlanScope, service.PlanScopeGlobal) {
			out = append(out, plan)
			continue
		}
		if service.IsGlobalPlanVisibleForGroups(plan.ApplicableGroupMode, plan.ApplicableGroupIds, heldGroupIDs) {
			out = append(out, plan)
		}
	}
	return out
}

func (h *ConsoleHandler) consoleBillingActivity(ctx context.Context, userID int64) ([]consoleBillingActivity, error) {
	if h == nil || h.paymentOrders == nil {
		return []consoleBillingActivity{}, nil
	}
	orders, _, err := h.paymentOrders.GetUserOrders(ctx, userID, service.OrderListParams{Page: 1, PageSize: 10})
	if err != nil {
		return nil, err
	}
	out := make([]consoleBillingActivity, 0, len(orders))
	for _, order := range orders {
		if order == nil {
			continue
		}
		out = append(out, consoleBillingActivity{
			ID:              order.ID,
			Date:            order.CreatedAt.UTC().Format(time.RFC3339),
			Reference:       consoleOrderReference(order),
			Type:            order.OrderType,
			Label:           consoleOrderLabel(order),
			Amount:          order.Amount,
			Currency:        service.PaymentOrderAmountCurrency(order, h.defaultCurrency),
			PayAmount:       order.PayAmount,
			PaymentCurrency: service.PaymentOrderCurrency(order),
			Status:          order.Status,
			PayURL:          consoleStringValue(order.PayURL),
			ReceiptURL:      fmt.Sprintf("/api/v1/payment/orders/%d", order.ID),
		})
	}
	return out, nil
}

func consoleStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func consoleOrderReference(order *dbent.PaymentOrder) string {
	if order == nil {
		return ""
	}
	if strings.TrimSpace(order.OutTradeNo) != "" {
		return strings.TrimSpace(order.OutTradeNo)
	}
	return fmt.Sprintf("ORD-%d", order.ID)
}

func consoleOrderLabel(order *dbent.PaymentOrder) string {
	if order == nil {
		return "Payment"
	}
	switch order.OrderType {
	case "balance":
		return "Add-on Credits"
	case "subscription":
		return "Subscription"
	case "global_plan":
		return "Global Plan"
	case "global_plan_upgrade":
		return "Global Plan Upgrade"
	default:
		return "Payment"
	}
}

func consoleReferralInviteeFromAffiliate(invitee service.AffiliateInvitee) consoleReferralInvitee {
	joinedAt := time.Now().UTC().Format(time.RFC3339)
	if invitee.CreatedAt != nil {
		joinedAt = invitee.CreatedAt.UTC().Format(time.RFC3339)
	}
	status := "joined"
	if invitee.TotalRebate > 0 {
		status = "rewarded"
	}
	return consoleReferralInvitee{
		ID:       invitee.UserID,
		Email:    invitee.Email,
		JoinedAt: joinedAt,
		Status:   status,
		Earnings: invitee.TotalRebate,
	}
}

func buildConsoleInviteLink(c *gin.Context, code string) string {
	base := strings.TrimRight(c.Request.Header.Get("X-Frontend-Origin"), "/")
	if base == "" {
		scheme := "https"
		if c.Request.TLS == nil {
			scheme = "http"
		}
		base = scheme + "://" + c.Request.Host
	}
	return base + "/register?ref=" + code
}

func consoleDisplayName(user *service.User) string {
	if user.Username != "" {
		return user.Username
	}
	return user.Email
}

func consoleRangeDays(value string) int {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "30d":
		return 30
	default:
		return 7
	}
}

func consoleOverviewTrendWindow(value string, now time.Time) (time.Time, time.Time, string) {
	now = now.UTC()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "today":
		return dayStart, now, "hour"
	case "lastday", "yesterday":
		start := dayStart.AddDate(0, 0, -1)
		return start, dayStart, "hour"
	default:
		days := consoleRangeDays(value)
		return now.AddDate(0, 0, -days+1), now, "day"
	}
}

func consoleTrendFromUsage(trend []usagestats.TrendDataPoint) []consoleOverviewTrendPoint {
	out := make([]consoleOverviewTrendPoint, 0, len(trend))
	for _, point := range trend {
		out = append(out, consoleOverviewTrendPoint{
			Date:     point.Date,
			Requests: point.Requests,
			Credits:  point.ActualCost,
			Tokens:   point.TotalTokens,
		})
	}
	return out
}

func consolePrimaryKeyFromList(keys []service.APIKey) *consoleOverviewPrimaryKey {
	if len(keys) == 0 {
		return nil
	}
	key := keys[0]
	out := &consoleOverviewPrimaryKey{
		ID:           key.ID,
		Name:         key.Name,
		MaskedKey:    maskConsoleAPIKey(key.Key),
		Environments: 1,
	}
	if key.LastUsedAt != nil {
		out.LastUsedAt = key.LastUsedAt.UTC().Format(time.RFC3339)
	}
	return out
}

func maskConsoleAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return key[:1] + "-...." + key[len(key)-1:]
	}
	return key[:3] + "...." + key[len(key)-4:]
}

func consoleReferralSummaryFromDetail(detail *service.AffiliateDetail) consoleOverviewReferral {
	if detail == nil {
		return consoleOverviewReferral{}
	}
	orders := 0
	for _, invitee := range detail.Invitees {
		if invitee.TotalRebate > 0 {
			orders++
		}
	}
	return consoleOverviewReferral{
		Earnings: detail.AffHistoryQuota,
		Invited:  detail.AffCount,
		Orders:   orders,
	}
}

func consoleAnnouncementSummaries(items []service.UserAnnouncement, limit int) []consoleOverviewAnnouncement {
	if limit <= 0 || limit > len(items) {
		limit = len(items)
	}
	out := make([]consoleOverviewAnnouncement, 0, limit)
	for i := 0; i < limit; i++ {
		item := items[i]
		out = append(out, consoleOverviewAnnouncement{
			ID:          item.Announcement.ID,
			Title:       item.Announcement.Title,
			Type:        consoleAnnouncementType(item.Announcement.NotifyMode),
			PublishedAt: item.Announcement.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func consoleAnnouncementType(notifyMode string) string {
	switch strings.ToLower(strings.TrimSpace(notifyMode)) {
	case service.AnnouncementNotifyModePopup:
		return "maintenance"
	default:
		return "update"
	}
}

func consoleBillingPeriod(days int, unit string) string {
	normalizedUnit := strings.ToLower(strings.TrimSpace(unit))
	if days <= 0 {
		switch normalizedUnit {
		case "year", "years":
			return "year"
		case "week", "weeks":
			return "week"
		case "day", "days":
			return "day"
		default:
			return "month"
		}
	}

	switch normalizedUnit {
	case "year", "years":
		return pluralBillingPeriod(days, "year")
	case "week", "weeks":
		return pluralBillingPeriod(days, "week")
	case "day", "days":
		return pluralBillingPeriod(days, "day")
	case "month", "months":
		return pluralBillingPeriod(days, "month")
	default:
		return pluralBillingPeriod(days, "day")
	}
}

func pluralBillingPeriod(value int, unit string) string {
	if value == 1 {
		return unit
	}
	return fmt.Sprintf("%d %ss", value, unit)
}

func (h *ConsoleHandler) consoleBillingAddOns(ctx context.Context) []consoleBillingAddOn {
	multiplier := 1.0
	if h.paymentConfig != nil {
		cfg, err := h.paymentConfig.GetPaymentConfig(ctx)
		if err == nil && cfg != nil {
			multiplier = normalizeConsoleRechargeMultiplier(cfg.BalanceRechargeMultiplier)
		}
	}
	out := make([]consoleBillingAddOn, 0, len(h.topUpPresets))
	for _, preset := range h.topUpPresets {
		item := preset
		item.Credits = roundConsoleMoney(item.Amount * multiplier)
		out = append(out, item)
	}
	return out
}

func normalizeConsoleRechargeMultiplier(multiplier float64) float64 {
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier <= 0 {
		return 1
	}
	return multiplier
}

func roundConsoleMoney(value float64) float64 {
	return math.Round(value*100) / 100
}

func splitConsoleFeatures(raw string) []string {
	if raw == "" {
		return []string{}
	}
	out := []string{}
	for _, line := range strings.Split(raw, "\n") {
		if item := strings.TrimSpace(line); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func (h *ConsoleHandler) consoleDefaultGlobalPlan(balance float64) consoleBootstrapGlobalPlan {
	return consoleBootstrapGlobalPlan{
		Active:         false,
		Name:           h.defaultGlobalPlanName,
		QuotaLimit:     0,
		QuotaUsed:      0,
		QuotaRemaining: balance,
		UsedPercent:    0,
	}
}

func (h *ConsoleHandler) consoleGlobalPlan(ctx context.Context, userID int64, fallbackBalance float64) (consoleBootstrapGlobalPlan, error) {
	if h.globalPlans == nil {
		return h.consoleDefaultGlobalPlan(fallbackBalance), nil
	}
	active, err := h.globalPlans.GetActive(ctx, userID, time.Now().UTC())
	if err != nil {
		return consoleBootstrapGlobalPlan{}, err
	}
	if active == nil {
		return h.consoleDefaultGlobalPlan(fallbackBalance), nil
	}
	return consoleBootstrapGlobalPlan{
		Active:           true,
		Name:             active.PlanName,
		QuotaLimit:       active.QuotaLimitUSD,
		QuotaUsed:        active.QuotaUsedUSD,
		QuotaRemaining:   active.QuotaRemainingUSD,
		UsedPercent:      consoleUsedPercent(active.QuotaUsedUSD, active.QuotaLimitUSD),
		CurrentPeriodEnd: formatConsoleTime(active.CurrentPeriodEnd),
		ExpiresAt:        formatConsoleTime(active.ExpiresAt),
	}, nil
}

func (h *ConsoleHandler) consoleActiveBillingGlobalPlan(ctx context.Context, userID int64) (*consoleBillingGlobalPlan, error) {
	if h.globalPlans == nil {
		return nil, nil
	}
	active, err := h.globalPlans.GetActive(ctx, userID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, nil
	}
	return &consoleBillingGlobalPlan{
		ID:             active.ID,
		PlanID:         active.PlanID,
		Name:           active.PlanName,
		PlanCategory:   service.NormalizePlanCategoryForDisplay(active.PlanCategory),
		Status:         active.Status,
		TierRank:       active.TierRank,
		QuotaLimit:     active.QuotaLimitUSD,
		QuotaUsed:      active.QuotaUsedUSD,
		QuotaRemaining: active.QuotaRemainingUSD,
		PeriodStart:    formatConsoleTime(active.CurrentPeriodStart),
		PeriodEnd:      formatConsoleTime(active.CurrentPeriodEnd),
		ExpiresAt:      formatConsoleTime(active.ExpiresAt),
	}, nil
}

func (h *ConsoleHandler) consoleActiveBillingGlobalPlans(ctx context.Context, userID int64) ([]consoleBillingGlobalPlan, error) {
	if h.globalPlans == nil {
		return []consoleBillingGlobalPlan{}, nil
	}
	activeList, err := h.globalPlans.GetActiveList(ctx, userID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	out := make([]consoleBillingGlobalPlan, 0, len(activeList))
	for _, active := range activeList {
		if active == nil {
			continue
		}
		out = append(out, consoleBillingGlobalPlan{
			ID:             active.ID,
			PlanID:         active.PlanID,
			Name:           active.PlanName,
			PlanCategory:   service.NormalizePlanCategoryForDisplay(active.PlanCategory),
			Status:         active.Status,
			TierRank:       active.TierRank,
			QuotaLimit:     active.QuotaLimitUSD,
			QuotaUsed:      active.QuotaUsedUSD,
			QuotaRemaining: active.QuotaRemainingUSD,
			PeriodStart:    formatConsoleTime(active.CurrentPeriodStart),
			PeriodEnd:      formatConsoleTime(active.CurrentPeriodEnd),
			ExpiresAt:      formatConsoleTime(active.ExpiresAt),
		})
	}
	return out, nil
}

func consoleUsedPercent(used, limit float64) float64 {
	if limit <= 0 {
		return 0
	}
	percent := used / limit * 100
	if percent < 0 {
		return 0
	}
	if percent > 100 {
		return 100
	}
	return percent
}

func formatConsoleTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func (h *ConsoleHandler) consoleAffiliateEnabled(ctx context.Context) bool {
	if h == nil || h.settings == nil {
		return true
	}
	settings, err := h.settings.GetPublicSettings(ctx)
	if err != nil || settings == nil {
		return true
	}
	return settings.AffiliateEnabled
}

func (h *ConsoleHandler) affiliateInviteeSignupReward(ctx context.Context) float64 {
	if h == nil || h.settings == nil {
		return 0
	}
	return h.settings.GetAffiliateInviteeSignupReward(ctx)
}

func (h *ConsoleHandler) affiliateInviterSignupReward(ctx context.Context) float64 {
	if h == nil || h.settings == nil {
		return 0
	}
	return h.settings.GetAffiliateInviterSignupReward(ctx)
}

func (h *ConsoleHandler) affiliateInviterSignupRewardCap(ctx context.Context) float64 {
	if h == nil || h.settings == nil {
		return 0
	}
	return h.settings.GetAffiliateInviterSignupRewardCap(ctx)
}
