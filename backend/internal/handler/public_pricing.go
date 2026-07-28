package handler

import (
	"sort"
	"strings"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/service"
)

const publicGatewayPricingMultiplier = 0.837

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

type publicModelPricingResponse struct {
	Products []publicModelPricingProduct `json:"products"`
}

type publicModelPricingProduct struct {
	ID          string                  `json:"id"`
	Label       string                  `json:"label"`
	Status      string                  `json:"status"`
	Description string                  `json:"description"`
	Multiplier  string                  `json:"multiplier"`
	RuleText    string                  `json:"rule_text"`
	Rows        []publicModelPricingRow `json:"rows"`
}

type publicModelPricingRow struct {
	Model        string           `json:"model"`
	Input        publicPricePair  `json:"input"`
	Output       publicPricePair  `json:"output"`
	CacheWrite   *publicPricePair `json:"cache_write,omitempty"`
	CacheRead    *publicPricePair `json:"cache_read,omitempty"`
	Availability string           `json:"availability"`
}

type publicPricePair struct {
	Gateway  float64 `json:"gateway"`
	Official float64 `json:"official"`
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

func buildPublicModelPricing(billing *service.BillingService) publicModelPricingResponse {
	products := []publicModelPricingProduct{
		{ID: "claude", Label: "Claude", Status: "live", Description: "Claude Code compatible routing", Multiplier: "0.837x official USD", RuleText: "Gateway USD price = official USD rate x 0.837"},
		{ID: "openai", Label: "OpenAI", Status: "live", Description: "Codex and OpenAI compatible models", Multiplier: "0.837x official USD", RuleText: "Gateway USD price = official USD rate x 0.837"},
		{ID: "gemini", Label: "Gemini", Status: "live", Description: "Gemini CLI compatible models", Multiplier: "0.837x official USD", RuleText: "Gateway USD price = official USD rate x 0.837"},
	}
	if billing == nil {
		return publicModelPricingResponse{Products: products}
	}

	models := billing.ListSupportedModels()
	sort.Strings(models)
	for _, model := range models {
		productID := publicProductIDForModel(model)
		if productID == "" {
			continue
		}
		pricing, err := billing.GetModelPricing(model)
		if err != nil || pricing == nil {
			continue
		}
		row := publicModelPricingRow{
			Model:        model,
			Input:        publicPairFromPerToken(pricing.InputPricePerToken),
			Output:       publicPairFromPerToken(pricing.OutputPricePerToken),
			Availability: "available",
		}
		if pricing.CacheCreationPricePerToken > 0 {
			pair := publicPairFromPerToken(pricing.CacheCreationPricePerToken)
			row.CacheWrite = &pair
		}
		if pricing.CacheReadPricePerToken > 0 {
			pair := publicPairFromPerToken(pricing.CacheReadPricePerToken)
			row.CacheRead = &pair
		}
		for i := range products {
			if products[i].ID == productID {
				products[i].Rows = append(products[i].Rows, row)
				break
			}
		}
	}

	return publicModelPricingResponse{Products: products}
}

func publicPairFromPerToken(officialPerToken float64) publicPricePair {
	official := officialPerToken * 1_000_000
	return publicPricePair{
		Gateway:  official * publicGatewayPricingMultiplier,
		Official: official,
	}
}

func publicProductIDForModel(model string) string {
	lower := strings.ToLower(model)
	switch {
	case strings.Contains(lower, "claude"):
		return "claude"
	case strings.HasPrefix(lower, "gpt-") || strings.Contains(lower, "codex") || strings.HasPrefix(lower, "o"):
		return "openai"
	case strings.Contains(lower, "gemini"):
		return "gemini"
	default:
		return ""
	}
}
