package handler

import (
	"strings"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/service"
)

type publicPricingResponse struct {
	Plans  []publicPricingPlan  `json:"plans"`
	Topups []publicTopupPackage `json:"topups"`
	FAQ    []publicFAQItem      `json:"faq"`
}

type publicPricingPlan struct {
	ID                int64    `json:"id"`
	Name              string   `json:"name"`
	Price             float64  `json:"price"`
	Currency          string   `json:"currency"`
	BillingPeriod     string   `json:"billing_period"`
	PlanScope         string   `json:"plan_scope"`
	GroupID           *int64   `json:"group_id,omitempty"`
	GroupPlatform     string   `json:"group_platform,omitempty"`
	GroupName         string   `json:"group_name,omitempty"`
	WeeklyCredits     float64  `json:"weekly_credits"`
	MonthlyMaxCredits float64  `json:"monthly_max_credits"`
	Badge             string   `json:"badge,omitempty"`
	Features          []string `json:"features"`
	Recommended       bool     `json:"recommended"`
}

type publicTopupPackage struct {
	Amount   float64 `json:"amount"`
	Credits  float64 `json:"credits"`
	Currency string  `json:"currency"`
}

type publicFAQItem struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

func defaultPublicTopups() []publicTopupPackage {
	return []publicTopupPackage{
		{Amount: 10, Credits: 10.5, Currency: "USD"},
		{Amount: 25, Credits: 27.5, Currency: "USD"},
		{Amount: 50, Credits: 56, Currency: "USD"},
		{Amount: 100, Credits: 115, Currency: "USD"},
	}
}

func publicPlanFromSubscriptionPlan(plan *dbent.SubscriptionPlan, index int, groupInfo map[int64]service.PlanGroupInfo) publicPricingPlan {
	weeklyCredits := plan.QuotaPerPeriodUsd
	if weeklyCredits <= 0 {
		weeklyCredits = plan.Price
	}
	monthlyMax := plan.MonthlyMaxUsd
	if monthlyMax <= 0 {
		monthlyMax = weeklyCredits * 4
	}
	out := publicPricingPlan{
		ID:                int64(plan.ID),
		Name:              plan.Name,
		Price:             plan.Price,
		Currency:          "USD",
		BillingPeriod:     consoleBillingPeriod(plan.ValidityDays, plan.ValidityUnit),
		PlanScope:         normalizeConsolePlanScope(plan.PlanScope),
		WeeklyCredits:     weeklyCredits,
		MonthlyMaxCredits: monthlyMax,
		Badge:             strings.TrimSpace(plan.PublicBadge),
		Features:          parseFeatures(plan.Features),
		Recommended:       index == 1 || plan.TierRank == 2,
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
