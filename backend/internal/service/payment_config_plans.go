package service

import (
	"context"
	"fmt"
	"strings"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/group"
	"github.com/Wei-Shaw/sub2api/ent/predicate"
	"github.com/Wei-Shaw/sub2api/ent/subscriptionplan"
	"github.com/Wei-Shaw/sub2api/internal/domain"
	"github.com/Wei-Shaw/sub2api/internal/payment"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

// normalizePlanCurrency validates and normalizes the display-only currency label.
// Empty means "no label" and is kept as-is so existing plans stay unchanged.
func normalizePlanCurrency(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	currency, err := payment.NormalizePaymentCurrency(raw)
	if err != nil {
		return "", infraerrors.BadRequest("PLAN_CURRENCY_INVALID", "currency must be a 3-letter ISO currency code")
	}
	return currency, nil
}

const (
	PlanScopeGroup  = "group"
	PlanScopeGlobal = "global"

	PlanApplicableGroupModeAll       = "all"
	PlanApplicableGroupModeWhitelist = "whitelist"
	PlanApplicableGroupModeBlacklist = "blacklist"
)

// validatePlanRequired checks that all required fields for a plan are provided.
func validatePlanRequired(req CreatePlanRequest) error {
	scope := normalizePlanScope(req.PlanScope)
	if strings.TrimSpace(req.Name) == "" {
		return infraerrors.BadRequest("PLAN_NAME_REQUIRED", "plan name is required")
	}
	if scope == PlanScopeGroup && req.GroupID <= 0 {
		return infraerrors.BadRequest("PLAN_GROUP_REQUIRED", "group is required")
	}
	if scope == PlanScopeGlobal && req.QuotaPerPeriodUSD <= 0 {
		return infraerrors.BadRequest("PLAN_QUOTA_INVALID", "global plan quota must be > 0")
	}
	if scope == PlanScopeGlobal && !isValidGlobalPlanQuotaPeriod(req.QuotaPeriod) {
		return infraerrors.BadRequest("PLAN_QUOTA_PERIOD_INVALID", "global plan quota period is invalid")
	}
	if req.Price <= 0 {
		return infraerrors.BadRequest("PLAN_PRICE_INVALID", "price must be > 0")
	}
	if req.ValidityDays <= 0 {
		return infraerrors.BadRequest("PLAN_VALIDITY_REQUIRED", "validity days must be > 0")
	}
	if strings.TrimSpace(req.ValidityUnit) == "" {
		return infraerrors.BadRequest("PLAN_VALIDITY_UNIT_REQUIRED", "validity unit is required")
	}
	if req.OriginalPrice != nil && *req.OriginalPrice < 0 {
		return infraerrors.BadRequest("PLAN_ORIGINAL_PRICE_INVALID", "original price must be >= 0")
	}
	if _, _, err := normalizeCreatePlanApplicableGroups(req); err != nil {
		return err
	}
	return nil
}

// validatePlanPatch validates only the non-nil fields in a patch update.
func validatePlanPatch(req UpdatePlanRequest) error {
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		return infraerrors.BadRequest("PLAN_NAME_REQUIRED", "plan name is required")
	}
	if req.GroupID != nil && *req.GroupID <= 0 {
		return infraerrors.BadRequest("PLAN_GROUP_REQUIRED", "group is required")
	}
	if req.PlanScope != nil {
		scope := normalizePlanScope(*req.PlanScope)
		if scope != PlanScopeGroup && scope != PlanScopeGlobal {
			return infraerrors.BadRequest("PLAN_SCOPE_INVALID", "plan scope is invalid")
		}
	}
	if req.QuotaPeriod != nil && strings.TrimSpace(*req.QuotaPeriod) != "" && !isValidGlobalPlanQuotaPeriod(*req.QuotaPeriod) {
		return infraerrors.BadRequest("PLAN_QUOTA_PERIOD_INVALID", "global plan quota period is invalid")
	}
	if req.QuotaPerPeriodUSD != nil && *req.QuotaPerPeriodUSD < 0 {
		return infraerrors.BadRequest("PLAN_QUOTA_INVALID", "global plan quota must be >= 0")
	}
	if req.Price != nil && *req.Price <= 0 {
		return infraerrors.BadRequest("PLAN_PRICE_INVALID", "price must be > 0")
	}
	if req.ValidityDays != nil && *req.ValidityDays <= 0 {
		return infraerrors.BadRequest("PLAN_VALIDITY_REQUIRED", "validity days must be > 0")
	}
	if req.ValidityUnit != nil && strings.TrimSpace(*req.ValidityUnit) == "" {
		return infraerrors.BadRequest("PLAN_VALIDITY_UNIT_REQUIRED", "validity unit is required")
	}
	if req.OriginalPrice != nil && *req.OriginalPrice < 0 {
		return infraerrors.BadRequest("PLAN_ORIGINAL_PRICE_INVALID", "original price must be >= 0")
	}
	if _, _, ok, err := normalizeUpdatePlanApplicableGroups(req); ok || err != nil {
		if err != nil {
			return err
		}
	}
	return nil
}

// --- Plan CRUD ---

// PlanGroupInfo holds the group details needed for subscription plan display.
type PlanGroupInfo struct {
	Platform           string   `json:"platform"`
	Name               string   `json:"name"`
	RateMultiplier     float64  `json:"rate_multiplier"`
	PeakRateEnabled    bool     `json:"peak_rate_enabled"`
	PeakStart          string   `json:"peak_start"`
	PeakEnd            string   `json:"peak_end"`
	PeakRateMultiplier float64  `json:"peak_rate_multiplier"`
	DailyLimitUSD      *float64 `json:"daily_limit_usd"`
	WeeklyLimitUSD     *float64 `json:"weekly_limit_usd"`
	MonthlyLimitUSD    *float64 `json:"monthly_limit_usd"`
	ModelScopes        []string `json:"supported_model_scopes"`
}

// PlanApplicableGroupInfo holds display details for global plan group scopes.
type PlanApplicableGroupInfo struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
}

// GetGroupPlatformMap returns a map of group_id → platform for the given plans.
func (s *PaymentConfigService) GetGroupPlatformMap(ctx context.Context, plans []*dbent.SubscriptionPlan) map[int64]string {
	info := s.GetGroupInfoMap(ctx, plans)
	m := make(map[int64]string, len(info))
	for id, gi := range info {
		m[id] = gi.Platform
	}
	return m
}

// GetGroupInfoMap returns a map of group_id → PlanGroupInfo for the given plans.
func (s *PaymentConfigService) GetGroupInfoMap(ctx context.Context, plans []*dbent.SubscriptionPlan) map[int64]PlanGroupInfo {
	ids := make([]int64, 0, len(plans))
	seen := make(map[int64]bool)
	for _, p := range plans {
		if p.GroupID == nil {
			continue
		}
		if !seen[*p.GroupID] {
			seen[*p.GroupID] = true
			ids = append(ids, *p.GroupID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	groups, err := s.entClient.Group.Query().Where(group.IDIn(ids...)).All(ctx)
	if err != nil {
		return nil
	}
	m := make(map[int64]PlanGroupInfo, len(groups))
	for _, g := range groups {
		m[int64(g.ID)] = PlanGroupInfo{
			Platform:           g.Platform,
			Name:               g.Name,
			RateMultiplier:     g.RateMultiplier,
			PeakRateEnabled:    g.PeakRateEnabled,
			PeakStart:          g.PeakStart,
			PeakEnd:            g.PeakEnd,
			PeakRateMultiplier: g.PeakRateMultiplier,
			DailyLimitUSD:      g.DailyLimitUsd,
			WeeklyLimitUSD:     g.WeeklyLimitUsd,
			MonthlyLimitUSD:    g.MonthlyLimitUsd,
			ModelScopes:        g.SupportedModelScopes,
		}
	}
	return m
}

func (s *PaymentConfigService) GetApplicableGroupInfoMap(ctx context.Context, plans []*dbent.SubscriptionPlan) map[int64]PlanApplicableGroupInfo {
	seen := make(map[int64]bool)
	ids := make([]int64, 0)
	for _, plan := range plans {
		for _, id := range plan.ApplicableGroupIds {
			if id <= 0 || seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return map[int64]PlanApplicableGroupInfo{}
	}
	groups, err := s.entClient.Group.Query().Where(group.IDIn(ids...)).All(ctx)
	if err != nil {
		return map[int64]PlanApplicableGroupInfo{}
	}
	out := make(map[int64]PlanApplicableGroupInfo, len(groups))
	for _, g := range groups {
		out[g.ID] = PlanApplicableGroupInfo{ID: g.ID, Name: g.Name, Platform: g.Platform}
	}
	return out
}

func (s *PaymentConfigService) ListPlans(ctx context.Context) ([]*dbent.SubscriptionPlan, error) {
	return s.entClient.SubscriptionPlan.Query().Order(subscriptionplan.BySortOrder()).All(ctx)
}

func (s *PaymentConfigService) ListPlansForSale(ctx context.Context) ([]*dbent.SubscriptionPlan, error) {
	return s.entClient.SubscriptionPlan.Query().Where(subscriptionplan.ForSaleEQ(true)).Order(subscriptionplan.BySortOrder()).All(ctx)
}

func (s *PaymentConfigService) ListVisibleGroupIDsForUser(ctx context.Context, allowedGroupIDs []int64) ([]int64, error) {
	visiblePredicates := []predicate.Group{group.IsExclusiveEQ(false)}
	if len(allowedGroupIDs) > 0 {
		visiblePredicates = append(visiblePredicates, group.IDIn(allowedGroupIDs...))
	}
	groups, err := s.entClient.Group.Query().
		Where(group.StatusEQ(domain.StatusActive), group.Or(visiblePredicates...)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]int64, 0, len(groups))
	for _, g := range groups {
		out = append(out, g.ID)
	}
	return out, nil
}

func (s *PaymentConfigService) CreatePlan(ctx context.Context, req CreatePlanRequest) (*dbent.SubscriptionPlan, error) {
	if err := validatePlanRequired(req); err != nil {
		return nil, err
	}
	scope := normalizePlanScope(req.PlanScope)
	if scope == PlanScopeGroup {
		if err := s.validatePlanGroup(ctx, req.GroupID); err != nil {
			return nil, err
		}
	}
	groupMode, groupIDs, _ := normalizeCreatePlanApplicableGroups(req)
	if scope == PlanScopeGlobal {
		if err := s.validatePlanApplicableGroups(ctx, groupIDs); err != nil {
			return nil, err
		}
	} else {
		groupMode = PlanApplicableGroupModeAll
		groupIDs = nil
	}
	currency, err := normalizePlanCurrency(req.Currency)
	if err != nil {
		return nil, err
	}
	b := s.entClient.SubscriptionPlan.Create().
		SetPlanScope(scope).SetPlanCategory(normalizePlanCategory(req.PlanCategory)).
		SetApplicableGroupMode(groupMode).SetApplicableGroupIds(groupIDs).
		SetTierRank(req.TierRank).
		SetQuotaPeriod(normalizePlanQuotaPeriod(req.QuotaPeriod)).
		SetQuotaPerPeriodUsd(req.QuotaPerPeriodUSD).SetMonthlyMaxUsd(req.MonthlyMaxUSD).
		SetSpeedTier(req.SpeedTier).SetSupportTier(req.SupportTier).SetPublicBadge(req.PublicBadge).
		SetName(req.Name).SetDescription(req.Description).
		SetPrice(req.Price).SetCurrency(currency).SetValidityDays(req.ValidityDays).SetValidityUnit(req.ValidityUnit).
		SetFeatures(req.Features).SetProductName(req.ProductName).
		SetForSale(req.ForSale).SetSortOrder(req.SortOrder)
	if scope == PlanScopeGroup {
		b.SetGroupID(req.GroupID)
	}
	if req.OriginalPrice != nil {
		b.SetOriginalPrice(*req.OriginalPrice)
	}
	return b.Save(ctx)
}

// UpdatePlan updates a subscription plan by ID (patch semantics).
// NOTE: This function exceeds 30 lines due to per-field nil-check patch update boilerplate
// plus a validation guard for non-nil fields.
func (s *PaymentConfigService) UpdatePlan(ctx context.Context, id int64, req UpdatePlanRequest) (*dbent.SubscriptionPlan, error) {
	if err := validatePlanPatch(req); err != nil {
		return nil, err
	}
	if err := s.validatePlanGroupPatch(ctx, id, req); err != nil {
		return nil, err
	}
	u := s.entClient.SubscriptionPlan.UpdateOneID(id)
	if req.GroupID != nil {
		u.SetGroupID(*req.GroupID)
	}
	if req.PlanScope != nil {
		scope := normalizePlanScope(*req.PlanScope)
		u.SetPlanScope(scope)
		if scope == PlanScopeGlobal {
			u.ClearGroupID()
		}
	}
	if req.TierRank != nil {
		u.SetTierRank(*req.TierRank)
	}
	if req.QuotaPeriod != nil {
		u.SetQuotaPeriod(normalizePlanQuotaPeriod(*req.QuotaPeriod))
	}
	if req.QuotaPerPeriodUSD != nil {
		u.SetQuotaPerPeriodUsd(*req.QuotaPerPeriodUSD)
	}
	if req.MonthlyMaxUSD != nil {
		u.SetMonthlyMaxUsd(*req.MonthlyMaxUSD)
	}
	if req.SpeedTier != nil {
		u.SetSpeedTier(*req.SpeedTier)
	}
	if req.SupportTier != nil {
		u.SetSupportTier(*req.SupportTier)
	}
	if req.PublicBadge != nil {
		u.SetPublicBadge(*req.PublicBadge)
	}
	if req.Name != nil {
		u.SetName(*req.Name)
	}
	if req.Description != nil {
		u.SetDescription(*req.Description)
	}
	if req.Price != nil {
		u.SetPrice(*req.Price)
	}
	if req.OriginalPrice != nil {
		u.SetOriginalPrice(*req.OriginalPrice)
	}
	if req.Currency != nil {
		currency, err := normalizePlanCurrency(*req.Currency)
		if err != nil {
			return nil, err
		}
		u.SetCurrency(currency)
	}
	if req.ValidityDays != nil {
		u.SetValidityDays(*req.ValidityDays)
	}
	if req.ValidityUnit != nil {
		u.SetValidityUnit(*req.ValidityUnit)
	}
	if req.Features != nil {
		u.SetFeatures(*req.Features)
	}
	if req.ProductName != nil {
		u.SetProductName(*req.ProductName)
	}
	if req.ForSale != nil {
		u.SetForSale(*req.ForSale)
	}
	if req.SortOrder != nil {
		u.SetSortOrder(*req.SortOrder)
	}
	if req.PlanCategory != nil {
		u.SetPlanCategory(normalizePlanCategory(*req.PlanCategory))
	}
	if groupMode, groupIDs, ok, err := normalizeUpdatePlanApplicableGroups(req); ok || err != nil {
		if err != nil {
			return nil, err
		}
		if err := s.validatePlanApplicableGroups(ctx, groupIDs); err != nil {
			return nil, err
		}
		u.SetApplicableGroupMode(groupMode).SetApplicableGroupIds(groupIDs)
	}
	return u.Save(ctx)
}

func (s *PaymentConfigService) validatePlanGroupPatch(ctx context.Context, id int64, req UpdatePlanRequest) error {
	nextScope := ""
	if req.PlanScope != nil {
		nextScope = normalizePlanScope(*req.PlanScope)
	}
	var nextGroupID int64
	if req.GroupID != nil {
		nextGroupID = *req.GroupID
	}
	if nextScope == "" || (nextScope == PlanScopeGroup && nextGroupID <= 0) {
		current, err := s.entClient.SubscriptionPlan.Get(ctx, id)
		if dbent.IsNotFound(err) {
			return infraerrors.NotFound("PLAN_NOT_FOUND", "subscription plan not found")
		}
		if err != nil {
			return err
		}
		if nextScope == "" {
			nextScope = normalizePlanScope(current.PlanScope)
		}
		if nextGroupID <= 0 && current.GroupID != nil {
			nextGroupID = *current.GroupID
		}
	}
	if nextScope == PlanScopeGroup {
		return s.validatePlanGroup(ctx, nextGroupID)
	}
	return nil
}

func (s *PaymentConfigService) validatePlanGroup(ctx context.Context, groupID int64) error {
	if groupID <= 0 {
		return infraerrors.BadRequest("PLAN_GROUP_REQUIRED", "group is required")
	}
	g, err := s.entClient.Group.Get(ctx, groupID)
	if dbent.IsNotFound(err) {
		return infraerrors.NotFound("PLAN_GROUP_NOT_FOUND", "group not found")
	}
	if err != nil {
		return err
	}
	if g.SubscriptionType != domain.SubscriptionTypeSubscription {
		return infraerrors.BadRequest("PLAN_GROUP_TYPE_INVALID", "group plan requires a subscription type group")
	}
	return nil
}

func normalizePlanScope(scope string) string {
	switch strings.ToLower(strings.TrimSpace(scope)) {
	case PlanScopeGlobal:
		return PlanScopeGlobal
	default:
		return PlanScopeGroup
	}
}

func normalizePlanQuotaPeriod(period string) string {
	period = strings.ToLower(strings.TrimSpace(period))
	if period == "" {
		return "none"
	}
	return period
}

func isValidGlobalPlanQuotaPeriod(period string) bool {
	switch normalizePlanQuotaPeriod(period) {
	case "day", "week", "month":
		return true
	default:
		return false
	}
}

func normalizePlanCategory(category string) string {
	category = strings.TrimSpace(category)
	if category == "" {
		return "default"
	}
	return category
}

func NormalizePlanCategoryForDisplay(category string) string {
	return normalizePlanCategory(category)
}

func normalizePlanApplicableGroupMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case PlanApplicableGroupModeWhitelist:
		return PlanApplicableGroupModeWhitelist
	case PlanApplicableGroupModeBlacklist:
		return PlanApplicableGroupModeBlacklist
	default:
		return PlanApplicableGroupModeAll
	}
}

func NormalizePlanApplicableGroupModeForDisplay(mode string) string {
	return normalizePlanApplicableGroupMode(mode)
}

func IsGlobalPlanVisibleForGroups(mode string, applicableGroupIDs []int64, heldGroupIDs []int64) bool {
	normalizedMode := normalizePlanApplicableGroupMode(mode)
	ids := normalizePlanApplicableGroupIDs(applicableGroupIDs)
	if normalizedMode == PlanApplicableGroupModeAll || len(ids) == 0 {
		return true
	}
	held := make(map[int64]bool, len(heldGroupIDs))
	for _, id := range heldGroupIDs {
		if id > 0 {
			held[id] = true
		}
	}
	if normalizedMode == PlanApplicableGroupModeWhitelist {
		for _, id := range ids {
			if held[id] {
				return true
			}
		}
		return false
	}

	blacklisted := make(map[int64]bool, len(ids))
	for _, id := range ids {
		blacklisted[id] = true
	}
	for id := range held {
		if !blacklisted[id] {
			return true
		}
	}
	return false
}

func normalizeCreatePlanApplicableGroups(req CreatePlanRequest) (string, []int64, error) {
	return normalizePlanApplicableGroups(req.ApplicableGroupMode, req.ApplicableGroupIDs, req.ApplicableGroupWhitelistIDs, req.ApplicableGroupBlacklistIDs)
}

func normalizeUpdatePlanApplicableGroups(req UpdatePlanRequest) (string, []int64, bool, error) {
	hasInput := req.ApplicableGroupMode != nil ||
		req.ApplicableGroupIDs != nil ||
		req.ApplicableGroupWhitelistIDs != nil ||
		req.ApplicableGroupBlacklistIDs != nil
	if !hasInput {
		return "", nil, false, nil
	}
	mode := ""
	if req.ApplicableGroupMode != nil {
		mode = *req.ApplicableGroupMode
	}
	normalizedMode, ids, err := normalizePlanApplicableGroups(mode, req.ApplicableGroupIDs, req.ApplicableGroupWhitelistIDs, req.ApplicableGroupBlacklistIDs)
	return normalizedMode, ids, true, err
}

func normalizePlanApplicableGroups(mode string, ids, whitelistIDs, blacklistIDs []int64) (string, []int64, error) {
	normalizedMode := strings.ToLower(strings.TrimSpace(mode))
	hasWhitelist := len(whitelistIDs) > 0 || (normalizedMode == PlanApplicableGroupModeWhitelist && len(ids) > 0)
	hasBlacklist := len(blacklistIDs) > 0 || (normalizedMode == PlanApplicableGroupModeBlacklist && len(ids) > 0)
	if hasWhitelist && hasBlacklist {
		return "", nil, infraerrors.BadRequest("PLAN_GROUP_SCOPE_CONFLICT", "global plan group scope cannot include both whitelist and blacklist")
	}
	if hasWhitelist {
		mode = PlanApplicableGroupModeWhitelist
		if len(whitelistIDs) > 0 {
			ids = whitelistIDs
		}
	}
	if hasBlacklist {
		mode = PlanApplicableGroupModeBlacklist
		if len(blacklistIDs) > 0 {
			ids = blacklistIDs
		}
	}

	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", PlanApplicableGroupModeAll:
		return PlanApplicableGroupModeAll, []int64{}, nil
	case PlanApplicableGroupModeWhitelist:
		normalized := normalizePlanApplicableGroupIDs(ids)
		if len(normalized) == 0 {
			return PlanApplicableGroupModeAll, []int64{}, nil
		}
		return PlanApplicableGroupModeWhitelist, normalized, nil
	case PlanApplicableGroupModeBlacklist:
		normalized := normalizePlanApplicableGroupIDs(ids)
		if len(normalized) == 0 {
			return PlanApplicableGroupModeAll, []int64{}, nil
		}
		return PlanApplicableGroupModeBlacklist, normalized, nil
	default:
		return "", nil, infraerrors.BadRequest("PLAN_GROUP_SCOPE_INVALID", "global plan group scope is invalid")
	}
}

func normalizePlanApplicableGroupIDs(ids []int64) []int64 {
	if len(ids) == 0 {
		return []int64{}
	}
	out := make([]int64, 0, len(ids))
	seen := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func (s *PaymentConfigService) validatePlanApplicableGroups(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	count, err := s.entClient.Group.Query().Where(group.IDIn(ids...)).Count(ctx)
	if err != nil {
		return err
	}
	if count != len(ids) {
		return infraerrors.NotFound("PLAN_GROUP_SCOPE_GROUP_NOT_FOUND", "one or more group scope groups were not found")
	}
	return nil
}

func (s *PaymentConfigService) DeletePlan(ctx context.Context, id int64) error {
	count, err := s.countPendingOrdersByPlan(ctx, id)
	if err != nil {
		return fmt.Errorf("check pending orders: %w", err)
	}
	if count > 0 {
		return infraerrors.Conflict("PENDING_ORDERS",
			fmt.Sprintf("this plan has %d in-progress orders and cannot be deleted — wait for orders to complete first", count))
	}
	return s.entClient.SubscriptionPlan.DeleteOneID(id).Exec(ctx)
}

// GetPlan returns a subscription plan by ID.
func (s *PaymentConfigService) GetPlan(ctx context.Context, id int64) (*dbent.SubscriptionPlan, error) {
	plan, err := s.entClient.SubscriptionPlan.Get(ctx, id)
	if err != nil {
		return nil, infraerrors.NotFound("PLAN_NOT_FOUND", "subscription plan not found")
	}
	return plan, nil
}
