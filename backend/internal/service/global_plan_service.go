package service

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/subscriptionplan"
	"github.com/Wei-Shaw/sub2api/ent/userglobalplansubscription"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
)

const (
	GlobalPlanStatusActive    = "active"
	GlobalPlanStatusExpired   = "expired"
	GlobalPlanStatusCancelled = "cancelled"

	GlobalPlanQuotaPeriodWeek  = "week"
	GlobalPlanQuotaPeriodMonth = "month"
)

type GlobalPlanService struct {
	client *ent.Client
}

type GlobalPlanSnapshot struct {
	ID                   int64     `json:"id"`
	UserID               int64     `json:"user_id"`
	PlanID               int64     `json:"plan_id"`
	PlanName             string    `json:"plan_name"`
	PlanCategory         string    `json:"plan_category"`
	ApplicableGroupMode  string    `json:"applicable_group_mode"`
	ApplicableGroupIDs   []int64   `json:"applicable_group_ids"`
	Status               string    `json:"status"`
	TierRank             int       `json:"tier_rank"`
	StartsAt             time.Time `json:"starts_at"`
	ExpiresAt            time.Time `json:"expires_at"`
	CurrentPeriodStart   time.Time `json:"current_period_start"`
	CurrentPeriodEnd     time.Time `json:"current_period_end"`
	QuotaPeriod          string    `json:"quota_period"`
	QuotaLimitUSD        float64   `json:"quota_limit_usd"`
	QuotaUsedUSD         float64   `json:"quota_used_usd"`
	QuotaRemainingUSD    float64   `json:"quota_remaining_usd"`
	QuotaRemainingPct    float64   `json:"quota_remaining_pct"`
	CurrentPeriodExpired bool      `json:"current_period_expired"`
}

type GlobalPlanUpgradeQuote struct {
	CurrentSubscriptionID int64     `json:"current_subscription_id"`
	FromPlanID            int64     `json:"from_plan_id"`
	ToPlanID              int64     `json:"to_plan_id"`
	RemainingSeconds      int64     `json:"remaining_seconds"`
	CycleSeconds          int64     `json:"cycle_seconds"`
	CurrentPlanPrice      float64   `json:"current_plan_price"`
	TargetPlanPrice       float64   `json:"target_plan_price"`
	UpgradePrice          float64   `json:"upgrade_price"`
	Currency              string    `json:"currency"`
	ExpiresAt             time.Time `json:"expires_at"`
}

type FulfillGlobalPlanPurchaseInput struct {
	UserID       int64
	Plan         *ent.SubscriptionPlan
	OrderID      int64
	ValidityDays int
	Now          time.Time
}

type AssignGlobalPlanInput struct {
	UserID       int64
	PlanID       int64
	ValidityDays int
	AssignedBy   int64
	Notes        string
	Now          time.Time
}

type AdminGlobalPlanAssignment struct {
	ID                    int64      `json:"id"`
	UserID                int64      `json:"user_id"`
	PlanID                int64      `json:"plan_id"`
	PlanName              string     `json:"plan_name"`
	PlanCategory          string     `json:"plan_category"`
	ApplicableGroupMode   string     `json:"applicable_group_mode"`
	ApplicableGroupIDs    []int64    `json:"applicable_group_ids"`
	Status                string     `json:"status"`
	TierRank              int        `json:"tier_rank"`
	StartsAt              time.Time  `json:"starts_at"`
	ExpiresAt             time.Time  `json:"expires_at"`
	CurrentPeriodStart    time.Time  `json:"current_period_start"`
	CurrentPeriodEnd      time.Time  `json:"current_period_end"`
	QuotaPeriod           string     `json:"quota_period"`
	QuotaLimitUSD         float64    `json:"quota_limit_usd"`
	QuotaUsedUSD          float64    `json:"quota_used_usd"`
	QuotaRemainingUSD     float64    `json:"quota_remaining_usd"`
	TierRankSnapshot      int        `json:"tier_rank_snapshot"`
	AssignedBy            *int64     `json:"assigned_by,omitempty"`
	AssignedAt            *time.Time `json:"assigned_at,omitempty"`
	Notes                 *string    `json:"notes,omitempty"`
	SourceOrderID         *int64     `json:"source_order_id,omitempty"`
	UserEmail             string     `json:"user_email"`
	UserUsername          string     `json:"user_username"`
	AssignedByEmail       string     `json:"assigned_by_email,omitempty"`
	AssignedByUsername    string     `json:"assigned_by_username,omitempty"`
	ConfiguredPlanName    string     `json:"configured_plan_name,omitempty"`
	ConfiguredPlanForSale bool       `json:"configured_plan_for_sale"`
}

func NewGlobalPlanService(client *ent.Client) *GlobalPlanService {
	return &GlobalPlanService{client: client}
}

func (s *GlobalPlanService) GetActive(ctx context.Context, userID int64, now time.Time) (*GlobalPlanSnapshot, error) {
	if s == nil || s.client == nil {
		return nil, nil
	}
	sub, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.UserIDEQ(userID),
			userglobalplansubscription.StatusEQ(GlobalPlanStatusActive),
			userglobalplansubscription.DeletedAtIsNil(),
			userglobalplansubscription.StartsAtLTE(now),
			userglobalplansubscription.ExpiresAtGT(now),
		).
		Order(ent.Desc(userglobalplansubscription.FieldTierRank), ent.Desc(userglobalplansubscription.FieldExpiresAt)).
		First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	sub, err = s.ensureCurrentPeriod(ctx, sub, now)
	if err != nil {
		return nil, err
	}
	return buildGlobalPlanSnapshot(sub, now), nil
}

func (s *GlobalPlanService) GetActiveList(ctx context.Context, userID int64, now time.Time) ([]*GlobalPlanSnapshot, error) {
	if s == nil || s.client == nil {
		return nil, nil
	}
	subs, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.UserIDEQ(userID),
			userglobalplansubscription.StatusEQ(GlobalPlanStatusActive),
			userglobalplansubscription.DeletedAtIsNil(),
			userglobalplansubscription.StartsAtLTE(now),
			userglobalplansubscription.ExpiresAtGT(now),
		).
		Order(ent.Asc(userglobalplansubscription.FieldCreatedAt), ent.Asc(userglobalplansubscription.FieldID)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*GlobalPlanSnapshot, 0, len(subs))
	for _, sub := range subs {
		updated, ensureErr := s.ensureCurrentPeriod(ctx, sub, now)
		if ensureErr != nil {
			return nil, ensureErr
		}
		out = append(out, buildGlobalPlanSnapshot(updated, now))
	}
	return out, nil
}

func (s *GlobalPlanService) FulfillPurchase(ctx context.Context, input FulfillGlobalPlanPurchaseInput) (*ent.UserGlobalPlanSubscription, error) {
	if input.Plan == nil {
		return nil, ErrSubscriptionNilInput
	}
	if input.OrderID > 0 {
		existingByOrder, err := s.client.UserGlobalPlanSubscription.Query().
			Where(
				userglobalplansubscription.UserIDEQ(input.UserID),
				userglobalplansubscription.SourceOrderIDEQ(input.OrderID),
				userglobalplansubscription.DeletedAtIsNil(),
			).
			First(ctx)
		if err == nil {
			return existingByOrder, nil
		}
		if !ent.IsNotFound(err) {
			return nil, err
		}
	}
	now := input.Now
	if now.IsZero() {
		now = time.Now()
	}
	validityDays := input.ValidityDays
	if validityDays <= 0 {
		validityDays = psComputeValidityDays(input.Plan.ValidityDays, input.Plan.ValidityUnit)
	}
	if validityDays <= 0 {
		validityDays = 30
	}

	category := normalizePlanCategory(input.Plan.PlanCategory)
	active, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.UserIDEQ(input.UserID),
			userglobalplansubscription.PlanCategoryEQ(category),
			userglobalplansubscription.StatusEQ(GlobalPlanStatusActive),
			userglobalplansubscription.DeletedAtIsNil(),
		).
		First(ctx)
	if ent.IsNotFound(err) {
		return s.createPurchase(ctx, input, now, validityDays)
	}
	if err != nil {
		return nil, err
	}
	return s.renewPurchase(ctx, active, input, now, validityDays)
}

func (s *GlobalPlanService) Assign(ctx context.Context, input AssignGlobalPlanInput) (*ent.UserGlobalPlanSubscription, error) {
	if s == nil || s.client == nil {
		return nil, ErrSubscriptionNilInput
	}
	if input.UserID <= 0 || input.PlanID <= 0 {
		return nil, infraerrors.BadRequest("INVALID_INPUT", "user and global plan are required")
	}
	plan, err := s.client.SubscriptionPlan.Get(ctx, input.PlanID)
	if ent.IsNotFound(err) {
		return nil, infraerrors.NotFound("PLAN_NOT_FOUND", "global plan not found")
	}
	if err != nil {
		return nil, err
	}
	if plan.PlanScope != PlanScopeGlobal {
		return nil, infraerrors.BadRequest("PLAN_NOT_GLOBAL", "plan is not a global plan")
	}
	now := input.Now
	if now.IsZero() {
		now = time.Now()
	}
	validityDays := psComputeValidityDays(plan.ValidityDays, plan.ValidityUnit)
	if validityDays <= 0 {
		validityDays = 30
	}
	category := normalizePlanCategory(plan.PlanCategory)
	active, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.UserIDEQ(input.UserID),
			userglobalplansubscription.PlanCategoryEQ(category),
			userglobalplansubscription.StatusEQ(GlobalPlanStatusActive),
			userglobalplansubscription.DeletedAtIsNil(),
		).
		First(ctx)
	if ent.IsNotFound(err) {
		sub, createErr := s.createPurchase(ctx, FulfillGlobalPlanPurchaseInput{
			UserID:       input.UserID,
			Plan:         plan,
			ValidityDays: validityDays,
			Now:          now,
		}, now, validityDays)
		if createErr != nil {
			return nil, createErr
		}
		return s.decorateManualAssignment(ctx, sub.ID, input.AssignedBy, input.Notes, now)
	}
	if err != nil {
		return nil, err
	}
	return s.replaceManualAssignment(ctx, active.ID, plan, input.AssignedBy, input.Notes, now, validityDays)
}

func (s *GlobalPlanService) ListAdminAssignments(ctx context.Context, params pagination.PaginationParams, userID *int64, status string) ([]AdminGlobalPlanAssignment, *pagination.PaginationResult, error) {
	if s == nil || s.client == nil {
		return nil, nil, ErrSubscriptionNilInput
	}
	q := s.client.UserGlobalPlanSubscription.Query().
		Where(userglobalplansubscription.DeletedAtIsNil())
	if userID != nil {
		q = q.Where(userglobalplansubscription.UserIDEQ(*userID))
	}
	if strings.TrimSpace(status) != "" {
		q = q.Where(userglobalplansubscription.StatusEQ(strings.TrimSpace(status)))
	}

	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, nil, err
	}
	rows, err := q.
		WithUser().
		WithPlan().
		WithAssignedByUser().
		Order(ent.Desc(userglobalplansubscription.FieldAssignedAt), ent.Desc(userglobalplansubscription.FieldCreatedAt)).
		Offset(params.Offset()).
		Limit(params.Limit()).
		All(ctx)
	if err != nil {
		return nil, nil, err
	}
	out := make([]AdminGlobalPlanAssignment, 0, len(rows))
	now := time.Now().UTC()
	for _, row := range rows {
		if row.Status == GlobalPlanStatusActive {
			updated, ensureErr := s.ensureCurrentPeriod(ctx, row, now)
			if ensureErr != nil {
				return nil, nil, ensureErr
			}
			row = updated
		}
		out = append(out, adminGlobalPlanAssignmentFromEnt(row))
	}
	return out, globalPlanPaginationResult(int64(total), params), nil
}

func (s *GlobalPlanService) Adjust(ctx context.Context, subscriptionID int64, days int, now time.Time) (*ent.UserGlobalPlanSubscription, error) {
	if s == nil || s.client == nil {
		return nil, ErrSubscriptionNilInput
	}
	sub, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.IDEQ(subscriptionID),
			userglobalplansubscription.DeletedAtIsNil(),
		).
		First(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrSubscriptionNotFound
	}
	if err != nil {
		return nil, err
	}
	if days > MaxValidityDays {
		days = MaxValidityDays
	}
	if days < -MaxValidityDays {
		days = -MaxValidityDays
	}
	if now.IsZero() {
		now = time.Now()
	}

	expiresBase := sub.ExpiresAt
	if !expiresBase.After(now) {
		if days < 0 {
			return nil, infraerrors.BadRequest("CANNOT_SHORTEN_EXPIRED", "cannot shorten an expired global plan")
		}
		expiresBase = now
	}
	newExpiresAt := expiresBase.AddDate(0, 0, days)
	if newExpiresAt.After(MaxExpiresAt) {
		newExpiresAt = MaxExpiresAt
	}
	if !newExpiresAt.After(now) {
		return nil, ErrAdjustWouldExpire
	}

	update := s.client.UserGlobalPlanSubscription.UpdateOneID(sub.ID).
		SetExpiresAt(newExpiresAt)
	if sub.Status == GlobalPlanStatusExpired && newExpiresAt.After(now) {
		update.SetStatus(GlobalPlanStatusActive)
	}
	if sub.CurrentPeriodEnd.After(newExpiresAt) {
		update.SetCurrentPeriodEnd(newExpiresAt)
	}
	return update.Save(ctx)
}

func (s *GlobalPlanService) ResetQuota(ctx context.Context, subscriptionID int64, now time.Time) (*ent.UserGlobalPlanSubscription, error) {
	if s == nil || s.client == nil {
		return nil, ErrSubscriptionNilInput
	}
	if now.IsZero() {
		now = time.Now()
	}
	sub, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.IDEQ(subscriptionID),
			userglobalplansubscription.DeletedAtIsNil(),
		).
		First(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrSubscriptionNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.client.UserGlobalPlanSubscription.UpdateOneID(sub.ID).
		SetQuotaUsedUsd(0).
		SetLastResetAt(now).
		Save(ctx)
}

func (s *GlobalPlanService) Revoke(ctx context.Context, subscriptionID int64, now time.Time) error {
	if s == nil || s.client == nil {
		return ErrSubscriptionNilInput
	}
	if now.IsZero() {
		now = time.Now()
	}
	sub, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.IDEQ(subscriptionID),
			userglobalplansubscription.DeletedAtIsNil(),
		).
		First(ctx)
	if ent.IsNotFound(err) {
		return ErrSubscriptionNotFound
	}
	if err != nil {
		return err
	}
	update := s.client.UserGlobalPlanSubscription.UpdateOneID(sub.ID).
		SetStatus(GlobalPlanStatusCancelled)
	if sub.ExpiresAt.After(now) {
		update.SetExpiresAt(now)
	}
	if sub.CurrentPeriodEnd.After(now) {
		update.SetCurrentPeriodEnd(now)
	}
	_, err = update.Save(ctx)
	return err
}

func (s *GlobalPlanService) decorateManualAssignment(ctx context.Context, subID int64, assignedBy int64, notes string, now time.Time) (*ent.UserGlobalPlanSubscription, error) {
	update := s.client.UserGlobalPlanSubscription.UpdateOneID(subID).
		SetNillableAssignedBy(nillablePositiveInt64(assignedBy)).
		SetAssignedAt(now)
	if strings.TrimSpace(notes) != "" {
		update.SetNotes(strings.TrimSpace(notes))
	} else {
		update.ClearNotes()
	}
	return update.Save(ctx)
}

func (s *GlobalPlanService) CalculateUpgradeQuote(ctx context.Context, userID int64, targetPlanID int64, now time.Time) (GlobalPlanUpgradeQuote, error) {
	if s == nil || s.client == nil {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("NO_ACTIVE_GLOBAL_PLAN", "no active global plan")
	}
	if now.IsZero() {
		now = time.Now()
	}
	if targetPlanID <= 0 {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("INVALID_INPUT", "target plan is required")
	}

	targetPlan, err := s.client.SubscriptionPlan.Get(ctx, targetPlanID)
	if ent.IsNotFound(err) {
		return GlobalPlanUpgradeQuote{}, infraerrors.NotFound("PLAN_NOT_AVAILABLE", "plan not found or not for sale")
	}
	if err != nil {
		return GlobalPlanUpgradeQuote{}, err
	}
	if targetPlan.PlanScope != PlanScopeGlobal {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("PLAN_NOT_GLOBAL", "target plan is not a global plan")
	}
	if !targetPlan.ForSale {
		return GlobalPlanUpgradeQuote{}, infraerrors.NotFound("PLAN_NOT_AVAILABLE", "plan not found or not for sale")
	}

	currentSub, err := s.client.UserGlobalPlanSubscription.Query().
		Where(
			userglobalplansubscription.UserIDEQ(userID),
			userglobalplansubscription.PlanCategoryEQ(normalizePlanCategory(targetPlan.PlanCategory)),
			userglobalplansubscription.StatusEQ(GlobalPlanStatusActive),
			userglobalplansubscription.DeletedAtIsNil(),
		).
		Order(ent.Desc(userglobalplansubscription.FieldTierRank), ent.Desc(userglobalplansubscription.FieldExpiresAt)).
		First(ctx)
	if ent.IsNotFound(err) {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("NO_ACTIVE_GLOBAL_PLAN", "no active global plan")
	}
	if err != nil {
		return GlobalPlanUpgradeQuote{}, err
	}
	if currentSub.StartsAt.After(now) || !currentSub.ExpiresAt.After(now) {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("GLOBAL_PLAN_EXPIRED", "current global plan is expired")
	}

	if targetPlan.TierRank <= currentSub.TierRank {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("PLAN_NOT_UPGRADE", "target plan is not a higher tier")
	}

	currentPlan, err := s.client.SubscriptionPlan.Query().
		Where(
			subscriptionplan.IDEQ(currentSub.PlanID),
			subscriptionplan.PlanCategoryEQ(currentSub.PlanCategory),
		).
		Only(ctx)
	if ent.IsNotFound(err) {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("CURRENT_PLAN_NOT_AVAILABLE", "current global plan is unavailable")
	}
	if err != nil {
		return GlobalPlanUpgradeQuote{}, err
	}

	remainingSeconds := int64(currentSub.ExpiresAt.Sub(now).Seconds())
	cycleSeconds := int64(currentSub.ExpiresAt.Sub(currentSub.StartsAt).Seconds())
	if remainingSeconds <= 0 || cycleSeconds <= 0 {
		return GlobalPlanUpgradeQuote{}, infraerrors.BadRequest("GLOBAL_PLAN_EXPIRED", "current global plan is expired")
	}
	delta := targetPlan.Price - currentPlan.Price
	if delta < 0 {
		delta = 0
	}
	upgradePrice := roundMoney(delta * float64(remainingSeconds) / float64(cycleSeconds))
	return GlobalPlanUpgradeQuote{
		CurrentSubscriptionID: currentSub.ID,
		FromPlanID:            currentPlan.ID,
		ToPlanID:              targetPlan.ID,
		RemainingSeconds:      remainingSeconds,
		CycleSeconds:          cycleSeconds,
		CurrentPlanPrice:      currentPlan.Price,
		TargetPlanPrice:       targetPlan.Price,
		UpgradePrice:          upgradePrice,
		Currency:              "USD",
		ExpiresAt:             currentSub.ExpiresAt,
	}, nil
}

func (s *GlobalPlanService) createPurchase(ctx context.Context, input FulfillGlobalPlanPurchaseInput, now time.Time, validityDays int) (*ent.UserGlobalPlanSubscription, error) {
	periodEnd := nextGlobalPlanPeriodStart(now, input.Plan.QuotaPeriod)
	expiresAt := now.AddDate(0, 0, validityDays)
	if periodEnd.After(expiresAt) {
		periodEnd = expiresAt
	}
	return s.client.UserGlobalPlanSubscription.Create().
		SetUserID(input.UserID).
		SetPlanID(input.Plan.ID).
		SetPlanCategory(normalizePlanCategory(input.Plan.PlanCategory)).
		SetApplicableGroupMode(normalizePlanApplicableGroupMode(input.Plan.ApplicableGroupMode)).
		SetApplicableGroupIds(normalizePlanApplicableGroupIDs(input.Plan.ApplicableGroupIds)).
		SetStatus(GlobalPlanStatusActive).
		SetStartsAt(now).
		SetExpiresAt(expiresAt).
		SetCurrentPeriodStart(now).
		SetCurrentPeriodEnd(periodEnd).
		SetQuotaPeriod(input.Plan.QuotaPeriod).
		SetQuotaLimitUsd(input.Plan.QuotaPerPeriodUsd).
		SetQuotaUsedUsd(0).
		SetTierRank(input.Plan.TierRank).
		SetPlanNameSnapshot(input.Plan.Name).
		SetNillableSourceOrderID(nillablePositiveInt64(input.OrderID)).
		Save(ctx)
}

func (s *GlobalPlanService) replaceManualAssignment(ctx context.Context, subID int64, plan *ent.SubscriptionPlan, assignedBy int64, notes string, now time.Time, validityDays int) (*ent.UserGlobalPlanSubscription, error) {
	expiresAt := now.AddDate(0, 0, validityDays)
	periodEnd := nextGlobalPlanPeriodStart(now, plan.QuotaPeriod)
	if periodEnd.After(expiresAt) {
		periodEnd = expiresAt
	}
	update := s.client.UserGlobalPlanSubscription.UpdateOneID(subID).
		SetPlanID(plan.ID).
		SetPlanCategory(normalizePlanCategory(plan.PlanCategory)).
		SetApplicableGroupMode(normalizePlanApplicableGroupMode(plan.ApplicableGroupMode)).
		SetApplicableGroupIds(normalizePlanApplicableGroupIDs(plan.ApplicableGroupIds)).
		SetStatus(GlobalPlanStatusActive).
		SetStartsAt(now).
		SetExpiresAt(expiresAt).
		SetCurrentPeriodStart(now).
		SetCurrentPeriodEnd(periodEnd).
		SetQuotaPeriod(plan.QuotaPeriod).
		SetQuotaLimitUsd(plan.QuotaPerPeriodUsd).
		SetQuotaUsedUsd(0).
		SetTierRank(plan.TierRank).
		SetPlanNameSnapshot(plan.Name).
		ClearSourceOrderID().
		SetNillableAssignedBy(nillablePositiveInt64(assignedBy)).
		SetAssignedAt(now)
	if strings.TrimSpace(notes) != "" {
		update.SetNotes(strings.TrimSpace(notes))
	} else {
		update.ClearNotes()
	}
	return update.Save(ctx)
}

func (s *GlobalPlanService) renewPurchase(ctx context.Context, active *ent.UserGlobalPlanSubscription, input FulfillGlobalPlanPurchaseInput, now time.Time, validityDays int) (*ent.UserGlobalPlanSubscription, error) {
	expiresBase := active.ExpiresAt
	if expiresBase.Before(now) {
		expiresBase = now
	}
	newExpiresAt := expiresBase.AddDate(0, 0, validityDays)
	return s.client.UserGlobalPlanSubscription.UpdateOneID(active.ID).
		SetPlanID(input.Plan.ID).
		SetPlanCategory(normalizePlanCategory(input.Plan.PlanCategory)).
		SetApplicableGroupMode(normalizePlanApplicableGroupMode(input.Plan.ApplicableGroupMode)).
		SetApplicableGroupIds(normalizePlanApplicableGroupIDs(input.Plan.ApplicableGroupIds)).
		SetPlanNameSnapshot(input.Plan.Name).
		SetTierRank(input.Plan.TierRank).
		SetQuotaPeriod(input.Plan.QuotaPeriod).
		SetQuotaLimitUsd(input.Plan.QuotaPerPeriodUsd).
		SetExpiresAt(newExpiresAt).
		SetNillableSourceOrderID(nillablePositiveInt64(input.OrderID)).
		Save(ctx)
}

func (s *GlobalPlanService) ensureCurrentPeriod(ctx context.Context, sub *ent.UserGlobalPlanSubscription, now time.Time) (*ent.UserGlobalPlanSubscription, error) {
	if sub == nil || now.Before(sub.CurrentPeriodEnd) {
		return sub, nil
	}

	periodStart, periodEnd := advanceGlobalPlanWindow(sub.CurrentPeriodStart, sub.CurrentPeriodEnd, sub.QuotaPeriod, now, sub.ExpiresAt)
	return s.client.UserGlobalPlanSubscription.UpdateOneID(sub.ID).
		SetCurrentPeriodStart(periodStart).
		SetCurrentPeriodEnd(periodEnd).
		SetQuotaUsedUsd(0).
		SetLastResetAt(now).
		Save(ctx)
}

func advanceGlobalPlanWindow(start, end time.Time, period string, now, expiresAt time.Time) (time.Time, time.Time) {
	if end.IsZero() || !end.After(start) {
		end = nextGlobalPlanPeriodStart(start, period)
	}
	for !end.After(now) && end.Before(expiresAt) {
		start = end
		end = nextGlobalPlanPeriodStart(start, period)
	}
	if end.After(expiresAt) {
		end = expiresAt
	}
	return start, end
}

func nextGlobalPlanPeriodStart(start time.Time, period string) time.Time {
	switch period {
	case "day":
		return start.AddDate(0, 0, 1)
	case GlobalPlanQuotaPeriodMonth:
		return start.AddDate(0, 1, 0)
	default:
		return start.AddDate(0, 0, 7)
	}
}

func buildGlobalPlanSnapshot(sub *ent.UserGlobalPlanSubscription, now time.Time) *GlobalPlanSnapshot {
	remaining := sub.QuotaLimitUsd - sub.QuotaUsedUsd
	if remaining < 0 {
		remaining = 0
	}
	pct := 0.0
	if sub.QuotaLimitUsd > 0 {
		pct = remaining / sub.QuotaLimitUsd * 100
	}
	return &GlobalPlanSnapshot{
		ID:                   sub.ID,
		UserID:               sub.UserID,
		PlanID:               sub.PlanID,
		PlanName:             sub.PlanNameSnapshot,
		PlanCategory:         sub.PlanCategory,
		ApplicableGroupMode:  sub.ApplicableGroupMode,
		ApplicableGroupIDs:   append([]int64(nil), sub.ApplicableGroupIds...),
		Status:               sub.Status,
		TierRank:             sub.TierRank,
		StartsAt:             sub.StartsAt,
		ExpiresAt:            sub.ExpiresAt,
		CurrentPeriodStart:   sub.CurrentPeriodStart,
		CurrentPeriodEnd:     sub.CurrentPeriodEnd,
		QuotaPeriod:          sub.QuotaPeriod,
		QuotaLimitUSD:        sub.QuotaLimitUsd,
		QuotaUsedUSD:         sub.QuotaUsedUsd,
		QuotaRemainingUSD:    remaining,
		QuotaRemainingPct:    pct,
		CurrentPeriodExpired: !now.Before(sub.CurrentPeriodEnd),
	}
}

func adminGlobalPlanAssignmentFromEnt(sub *ent.UserGlobalPlanSubscription) AdminGlobalPlanAssignment {
	remaining := sub.QuotaLimitUsd - sub.QuotaUsedUsd
	if remaining < 0 {
		remaining = 0
	}
	out := AdminGlobalPlanAssignment{
		ID:                  sub.ID,
		UserID:              sub.UserID,
		PlanID:              sub.PlanID,
		PlanName:            sub.PlanNameSnapshot,
		PlanCategory:        sub.PlanCategory,
		ApplicableGroupMode: sub.ApplicableGroupMode,
		ApplicableGroupIDs:  append([]int64(nil), sub.ApplicableGroupIds...),
		Status:              sub.Status,
		TierRank:            sub.TierRank,
		TierRankSnapshot:    sub.TierRank,
		StartsAt:            sub.StartsAt,
		ExpiresAt:           sub.ExpiresAt,
		CurrentPeriodStart:  sub.CurrentPeriodStart,
		CurrentPeriodEnd:    sub.CurrentPeriodEnd,
		QuotaPeriod:         sub.QuotaPeriod,
		QuotaLimitUSD:       sub.QuotaLimitUsd,
		QuotaUsedUSD:        sub.QuotaUsedUsd,
		QuotaRemainingUSD:   remaining,
		AssignedBy:          sub.AssignedBy,
		AssignedAt:          &sub.AssignedAt,
		Notes:               sub.Notes,
		SourceOrderID:       sub.SourceOrderID,
	}
	if sub.Edges.User != nil {
		out.UserEmail = sub.Edges.User.Email
		out.UserUsername = sub.Edges.User.Username
	}
	if sub.Edges.AssignedByUser != nil {
		out.AssignedByEmail = sub.Edges.AssignedByUser.Email
		out.AssignedByUsername = sub.Edges.AssignedByUser.Username
	}
	if sub.Edges.Plan != nil {
		out.ConfiguredPlanName = sub.Edges.Plan.Name
		out.ConfiguredPlanForSale = sub.Edges.Plan.ForSale
	}
	return out
}

func globalPlanPaginationResult(total int64, params pagination.PaginationParams) *pagination.PaginationResult {
	limit := params.Limit()
	pages := int(total) / limit
	if int(total)%limit > 0 {
		pages++
	}
	page := params.Page
	if page < 1 {
		page = 1
	}
	return &pagination.PaginationResult{Total: total, Page: page, PageSize: limit, Pages: pages}
}

func nillablePositiveInt64(v int64) *int64 {
	if v <= 0 {
		return nil
	}
	return &v
}

func roundMoney(v float64) float64 {
	return math.Round(v*100) / 100
}
