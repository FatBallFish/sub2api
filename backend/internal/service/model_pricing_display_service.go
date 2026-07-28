package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const SettingKeyModelPricingDisplayConfig = "model_pricing_display_config"

type ModelPricingDisplayConfig struct {
	Categories []ModelPricingDisplayCategoryConfig `json:"categories"`
}

type ModelPricingDisplayCategoryConfig struct {
	ID          string                           `json:"id"`
	Label       string                           `json:"label"`
	Description string                           `json:"description"`
	ModelScopes []string                         `json:"model_scopes"`
	Models      []ModelPricingDisplayModelConfig `json:"models"`
}

type ModelPricingDisplayModelConfig struct {
	Model string `json:"model"`
	Label string `json:"label"`
}

type ModelPricingDisplayResponse struct {
	Groups          []ModelPricingDisplayGroup   `json:"groups,omitempty"`
	SelectedGroupID int64                        `json:"selected_group_id,omitempty"`
	Products        []ModelPricingDisplayProduct `json:"products"`
}

type ModelPricingDisplayGroup struct {
	ID                   int64    `json:"id"`
	Name                 string   `json:"name"`
	Platform             string   `json:"platform"`
	RateMultiplier       float64  `json:"rate_multiplier"`
	ImageRateIndependent bool     `json:"image_rate_independent"`
	ImageRateMultiplier  float64  `json:"image_rate_multiplier"`
	SupportedModelScopes []string `json:"supported_model_scopes"`
}

type ModelPricingDisplayProduct struct {
	ID                string                   `json:"id"`
	Label             string                   `json:"label"`
	Status            string                   `json:"status"`
	Description       string                   `json:"description"`
	Multiplier        string                   `json:"multiplier"`
	RuleText          string                   `json:"rule_text"`
	Supported         bool                     `json:"supported"`
	UnsupportedReason string                   `json:"unsupported_reason,omitempty"`
	Rows              []ModelPricingDisplayRow `json:"rows"`
}

type ModelPricingDisplayRow struct {
	Model               string                 `json:"model"`
	Label               string                 `json:"label"`
	Input               ModelPricingPricePair  `json:"input"`
	Output              ModelPricingPricePair  `json:"output"`
	CacheWrite          *ModelPricingPricePair `json:"cache_write,omitempty"`
	CacheRead           *ModelPricingPricePair `json:"cache_read,omitempty"`
	Availability        string                 `json:"availability"`
	Multiplier          float64                `json:"multiplier"`
	MultiplierGroupID   *int64                 `json:"multiplier_group_id,omitempty"`
	MultiplierGroupName string                 `json:"multiplier_group_name,omitempty"`
	PricingSource       string                 `json:"pricing_source,omitempty"`
}

type ModelPricingPricePair struct {
	Gateway  float64 `json:"gateway"`
	Official float64 `json:"official"`
}

type ModelPricingDisplayService struct {
	settingRepo    SettingRepository
	groupRepo      GroupRepository
	channelService *ChannelService
	resolver       *ModelPricingResolver
}

func NewModelPricingDisplayService(settingRepo SettingRepository, groupRepo GroupRepository, channelService *ChannelService, resolver *ModelPricingResolver) *ModelPricingDisplayService {
	return &ModelPricingDisplayService{
		settingRepo:    settingRepo,
		groupRepo:      groupRepo,
		channelService: channelService,
		resolver:       resolver,
	}
}

func (s *ModelPricingDisplayService) GetConfig(ctx context.Context) (ModelPricingDisplayConfig, error) {
	if s == nil || s.settingRepo == nil {
		return ModelPricingDisplayConfig{}, nil
	}
	raw, err := s.settingRepo.GetValue(ctx, SettingKeyModelPricingDisplayConfig)
	if err != nil {
		if errorsIsSettingNotFound(err) {
			return ModelPricingDisplayConfig{}, nil
		}
		return ModelPricingDisplayConfig{}, fmt.Errorf("get model pricing display config: %w", err)
	}
	cfg, err := normalizeModelPricingDisplayConfig(raw)
	if err != nil {
		return ModelPricingDisplayConfig{}, err
	}
	return cfg, nil
}

func (s *ModelPricingDisplayService) UpdateConfig(ctx context.Context, cfg ModelPricingDisplayConfig) (ModelPricingDisplayConfig, error) {
	normalized := sanitizeModelPricingDisplayConfig(cfg)
	body, err := json.Marshal(normalized)
	if err != nil {
		return ModelPricingDisplayConfig{}, fmt.Errorf("marshal model pricing display config: %w", err)
	}
	if err := s.settingRepo.Set(ctx, SettingKeyModelPricingDisplayConfig, string(body)); err != nil {
		return ModelPricingDisplayConfig{}, fmt.Errorf("save model pricing display config: %w", err)
	}
	return normalized, nil
}

func (s *ModelPricingDisplayService) BuildPublicPricing(ctx context.Context) (ModelPricingDisplayResponse, error) {
	cfg, err := s.GetConfig(ctx)
	if err != nil {
		return ModelPricingDisplayResponse{}, err
	}
	groups, err := s.groupRepo.ListActive(ctx)
	if err != nil {
		return ModelPricingDisplayResponse{}, fmt.Errorf("list active groups: %w", err)
	}
	return ModelPricingDisplayResponse{
		Products: s.buildPublicProducts(ctx, cfg, groups),
	}, nil
}

func (s *ModelPricingDisplayService) BuildConsolePricing(ctx context.Context, groups []Group, selectedGroupID int64) (ModelPricingDisplayResponse, error) {
	cfg, err := s.GetConfig(ctx)
	if err != nil {
		return ModelPricingDisplayResponse{}, err
	}
	sort.SliceStable(groups, func(i, j int) bool {
		if groups[i].SortOrder != groups[j].SortOrder {
			return groups[i].SortOrder < groups[j].SortOrder
		}
		return strings.ToLower(groups[i].Name) < strings.ToLower(groups[j].Name)
	})
	selected := selectModelPricingGroup(groups, selectedGroupID)
	outGroups := make([]ModelPricingDisplayGroup, 0, len(groups))
	for _, g := range groups {
		outGroups = append(outGroups, modelPricingDisplayGroupFromService(g))
	}
	var selectedID int64
	if selected != nil {
		selectedID = selected.ID
	}
	return ModelPricingDisplayResponse{
		Groups:          outGroups,
		SelectedGroupID: selectedID,
		Products:        s.buildProducts(ctx, cfg, selected, true),
	}, nil
}

func (s *ModelPricingDisplayService) buildProducts(ctx context.Context, cfg ModelPricingDisplayConfig, group *Group, enforceSupport bool) []ModelPricingDisplayProduct {
	products := make([]ModelPricingDisplayProduct, 0, len(cfg.Categories))
	for _, cat := range cfg.Categories {
		supported := group != nil && categorySupportedByGroup(cat, group)
		if !enforceSupport && group != nil {
			supported = true
		}
		product := ModelPricingDisplayProduct{
			ID:          cat.ID,
			Label:       cat.Label,
			Status:      "live",
			Description: cat.Description,
			Supported:   !enforceSupport || supported,
			Rows:        []ModelPricingDisplayRow{},
		}
		if group != nil {
			rate := effectiveDisplayRateForCategory(group, cat)
			product.Multiplier = formatDisplayMultiplier(rate)
			product.RuleText = "Actual price = official price x " + formatDisplayMultiplier(rate)
		}
		if enforceSupport && !supported {
			product.UnsupportedReason = "This group does not support this model category."
			products = append(products, product)
			continue
		}
		for _, m := range cat.Models {
			row, ok := s.buildRow(ctx, cat, m, group)
			if ok {
				product.Rows = append(product.Rows, row)
			}
		}
		products = append(products, product)
	}
	return products
}

func (s *ModelPricingDisplayService) buildPublicProducts(ctx context.Context, cfg ModelPricingDisplayConfig, groups []Group) []ModelPricingDisplayProduct {
	products := make([]ModelPricingDisplayProduct, 0, len(cfg.Categories))
	for _, cat := range cfg.Categories {
		group := lowestPublicRateGroupForCategory(groups, cat)
		product := ModelPricingDisplayProduct{
			ID:          cat.ID,
			Label:       cat.Label,
			Status:      "live",
			Description: cat.Description,
			Supported:   true,
			Rows:        []ModelPricingDisplayRow{},
		}
		if group != nil {
			rate := effectiveDisplayRateForCategory(group, cat)
			product.Multiplier = formatDisplayMultiplier(rate)
			product.RuleText = "Actual price = official price x " + formatDisplayMultiplier(rate)
		}
		for _, m := range cat.Models {
			row, ok := s.buildRow(ctx, cat, m, group)
			if ok {
				product.Rows = append(product.Rows, row)
			}
		}
		products = append(products, product)
	}
	return products
}

func (s *ModelPricingDisplayService) buildRow(ctx context.Context, cat ModelPricingDisplayCategoryConfig, m ModelPricingDisplayModelConfig, group *Group) (ModelPricingDisplayRow, bool) {
	model := strings.TrimSpace(m.Model)
	if model == "" || s.resolver == nil {
		return ModelPricingDisplayRow{}, false
	}
	var groupID *int64
	if group != nil {
		groupID = &group.ID
	}
	resolved := s.resolver.Resolve(ctx, PricingInput{Model: model, GroupID: groupID})
	pricing := s.pricingForDisplay(model, resolved)
	if pricing == nil {
		return ModelPricingDisplayRow{}, false
	}
	rate := 0.0
	var rateGroupID *int64
	var rateGroupName string
	if group != nil {
		rate = effectiveDisplayRateForCategory(group, cat)
		gid := group.ID
		rateGroupID = &gid
		rateGroupName = group.Name
	}
	row := ModelPricingDisplayRow{
		Model:               model,
		Label:               firstNonEmptyString(m.Label, model),
		Input:               displayPairFromPerToken(pricing.InputPricePerToken, rate),
		Output:              displayPairFromPerToken(pricing.OutputPricePerToken, rate),
		Availability:        "available",
		Multiplier:          rate,
		MultiplierGroupID:   rateGroupID,
		MultiplierGroupName: rateGroupName,
		PricingSource:       resolved.Source,
	}
	if cacheWritePrice := cacheWritePriceForDisplay(pricing); cacheWritePrice > 0 {
		pair := displayPairFromPerToken(cacheWritePrice, rate)
		row.CacheWrite = &pair
	}
	if pricing.CacheReadPricePerToken > 0 {
		pair := displayPairFromPerToken(pricing.CacheReadPricePerToken, rate)
		row.CacheRead = &pair
	}
	return row, true
}

func normalizeModelPricingDisplayConfig(raw string) (ModelPricingDisplayConfig, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ModelPricingDisplayConfig{}, nil
	}
	var cfg ModelPricingDisplayConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return ModelPricingDisplayConfig{}, fmt.Errorf("parse model pricing display config: %w", err)
	}
	return sanitizeModelPricingDisplayConfig(cfg), nil
}

func sanitizeModelPricingDisplayConfig(cfg ModelPricingDisplayConfig) ModelPricingDisplayConfig {
	out := ModelPricingDisplayConfig{Categories: []ModelPricingDisplayCategoryConfig{}}
	for _, cat := range cfg.Categories {
		id := strings.TrimSpace(cat.ID)
		label := strings.TrimSpace(cat.Label)
		if id == "" {
			id = strings.ToLower(strings.ReplaceAll(label, " ", "-"))
		}
		if label == "" {
			label = id
		}
		if id == "" {
			continue
		}
		next := ModelPricingDisplayCategoryConfig{
			ID:          id,
			Label:       label,
			Description: strings.TrimSpace(cat.Description),
			ModelScopes: normalizeStringList(cat.ModelScopes),
			Models:      []ModelPricingDisplayModelConfig{},
		}
		for _, m := range cat.Models {
			model := strings.TrimSpace(m.Model)
			if model == "" {
				continue
			}
			next.Models = append(next.Models, ModelPricingDisplayModelConfig{
				Model: model,
				Label: strings.TrimSpace(m.Label),
			})
		}
		out.Categories = append(out.Categories, next)
	}
	return out
}

func lowestPublicRateGroup(groups []Group) *Group {
	var selected *Group
	for i := range groups {
		g := groups[i]
		if !g.IsActive() || g.IsExclusive {
			continue
		}
		if selected == nil || g.RateMultiplier < selected.RateMultiplier {
			selected = &groups[i]
		}
	}
	return selected
}

func lowestPublicRateGroupForCategory(groups []Group, cat ModelPricingDisplayCategoryConfig) *Group {
	required := normalizeStringList(cat.ModelScopes)
	if len(required) == 0 {
		return lowestPublicRateGroup(groups)
	}
	var selected *Group
	for i := range groups {
		g := groups[i]
		if !g.IsActive() || g.IsExclusive {
			continue
		}
		if !categorySupportedByGroup(cat, &g) {
			continue
		}
		if selected == nil || g.RateMultiplier < selected.RateMultiplier {
			selected = &groups[i]
		}
	}
	return selected
}

func selectModelPricingGroup(groups []Group, selectedGroupID int64) *Group {
	if len(groups) == 0 {
		return nil
	}
	if selectedGroupID > 0 {
		for i := range groups {
			if groups[i].ID == selectedGroupID {
				return &groups[i]
			}
		}
	}
	return &groups[0]
}

func modelPricingDisplayGroupFromService(g Group) ModelPricingDisplayGroup {
	return ModelPricingDisplayGroup{
		ID:                   g.ID,
		Name:                 g.Name,
		Platform:             g.Platform,
		RateMultiplier:       g.RateMultiplier,
		ImageRateIndependent: g.ImageRateIndependent,
		ImageRateMultiplier:  g.ImageRateMultiplier,
		SupportedModelScopes: normalizeStringList(g.SupportedModelScopes),
	}
}

func categorySupportedByGroup(cat ModelPricingDisplayCategoryConfig, group *Group) bool {
	if group == nil {
		return false
	}
	required := normalizeStringList(cat.ModelScopes)
	if len(required) == 0 {
		return true
	}
	supported := normalizeStringList(group.SupportedModelScopes)
	if len(supported) == 0 {
		supported = defaultModelScopesForPlatform(group.Platform)
	}
	return modelScopesOverlap(required, supported)
}

func modelScopesOverlap(required []string, supported []string) bool {
	supportedSet := map[string]struct{}{}
	for _, scope := range supported {
		supportedSet[scope] = struct{}{}
	}
	for _, scope := range required {
		if _, ok := supportedSet[scope]; ok {
			return true
		}
	}
	return false
}

func effectiveDisplayRateForCategory(group *Group, cat ModelPricingDisplayCategoryConfig) float64 {
	if group == nil {
		return 0
	}
	if group.ImageRateIndependent {
		for _, scope := range cat.ModelScopes {
			if strings.Contains(strings.ToLower(scope), "image") {
				return group.ImageRateMultiplier
			}
		}
	}
	return group.RateMultiplier
}

func (s *ModelPricingDisplayService) pricingForDisplay(model string, resolved *ResolvedPricing) *ModelPricing {
	if resolved == nil {
		return nil
	}
	if resolved.Mode == BillingModeToken {
		return s.withFallbackDisplayFields(model, resolved.BasePricing)
	}
	if resolved.DefaultPerRequestPrice > 0 {
		return &ModelPricing{
			InputPricePerToken:  resolved.DefaultPerRequestPrice / 1_000_000,
			OutputPricePerToken: 0,
		}
	}
	return s.withFallbackDisplayFields(model, resolved.BasePricing)
}

func (s *ModelPricingDisplayService) withFallbackDisplayFields(model string, pricing *ModelPricing) *ModelPricing {
	if pricing == nil || s == nil || s.resolver == nil || s.resolver.billingService == nil {
		return pricing
	}
	fallback := s.resolver.billingService.getFallbackPricing(model)
	if fallback == nil {
		return pricing
	}
	out := *pricing
	if out.InputPricePerToken == 0 {
		out.InputPricePerToken = fallback.InputPricePerToken
	}
	if out.OutputPricePerToken == 0 {
		out.OutputPricePerToken = fallback.OutputPricePerToken
	}
	if out.CacheCreationPricePerToken == 0 {
		out.CacheCreationPricePerToken = fallback.CacheCreationPricePerToken
	}
	if out.CacheCreation5mPrice == 0 {
		out.CacheCreation5mPrice = fallback.CacheCreation5mPrice
	}
	if out.CacheCreation1hPrice == 0 {
		out.CacheCreation1hPrice = fallback.CacheCreation1hPrice
	}
	if out.CacheReadPricePerToken == 0 {
		out.CacheReadPricePerToken = fallback.CacheReadPricePerToken
	}
	return &out
}

func cacheWritePriceForDisplay(pricing *ModelPricing) float64 {
	if pricing == nil {
		return 0
	}
	if pricing.CacheCreationPricePerToken > 0 {
		return pricing.CacheCreationPricePerToken
	}
	if pricing.CacheCreation5mPrice > 0 {
		return pricing.CacheCreation5mPrice
	}
	if pricing.CacheCreation1hPrice > 0 {
		return pricing.CacheCreation1hPrice
	}
	return 0
}

func displayPairFromPerToken(officialPerToken, multiplier float64) ModelPricingPricePair {
	official := officialPerToken * 1_000_000
	return ModelPricingPricePair{
		Official: official,
		Gateway:  official * multiplier,
	}
}

func normalizeStringList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out
}

func defaultModelScopesForPlatform(platform string) []string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case PlatformAnthropic:
		return []string{"claude", "anthropic"}
	case PlatformOpenAI:
		return []string{"openai"}
	case PlatformGemini:
		return []string{"gemini", "gemini_text", "gemini_image"}
	case PlatformAntigravity:
		return []string{"claude", "anthropic", "gemini", "gemini_text", "gemini_image", "antigravity"}
	default:
		if normalized := strings.ToLower(strings.TrimSpace(platform)); normalized != "" {
			return []string{normalized}
		}
		return nil
	}
}

func formatDisplayMultiplier(rate float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.4f", rate), "0"), ".") + "x"
}

func errorsIsSettingNotFound(err error) bool {
	return err == ErrSettingNotFound
}
