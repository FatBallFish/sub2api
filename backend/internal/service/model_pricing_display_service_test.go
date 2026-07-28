//go:build unit

package service

import (
	"context"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/stretchr/testify/require"
)

type modelPricingDisplaySettingRepoStub struct {
	values map[string]string
	set    map[string]string
}

func (r *modelPricingDisplaySettingRepoStub) Get(ctx context.Context, key string) (*Setting, error) {
	if v, ok := r.values[key]; ok {
		return &Setting{Key: key, Value: v}, nil
	}
	return nil, ErrSettingNotFound
}

func (r *modelPricingDisplaySettingRepoStub) GetValue(ctx context.Context, key string) (string, error) {
	if v, ok := r.values[key]; ok {
		return v, nil
	}
	return "", ErrSettingNotFound
}

func (r *modelPricingDisplaySettingRepoStub) Set(ctx context.Context, key, value string) error {
	if r.set == nil {
		r.set = map[string]string{}
	}
	r.set[key] = value
	return nil
}

func (r *modelPricingDisplaySettingRepoStub) GetMultiple(ctx context.Context, keys []string) (map[string]string, error) {
	out := map[string]string{}
	for _, key := range keys {
		if v, ok := r.values[key]; ok {
			out[key] = v
		}
	}
	return out, nil
}

func (r *modelPricingDisplaySettingRepoStub) SetMultiple(ctx context.Context, settings map[string]string) error {
	if r.set == nil {
		r.set = map[string]string{}
	}
	for k, v := range settings {
		r.set[k] = v
	}
	return nil
}

func (r *modelPricingDisplaySettingRepoStub) GetAll(ctx context.Context) (map[string]string, error) {
	out := map[string]string{}
	for k, v := range r.values {
		out[k] = v
	}
	return out, nil
}

func (r *modelPricingDisplaySettingRepoStub) Delete(ctx context.Context, key string) error {
	delete(r.values, key)
	return nil
}

type modelPricingDisplayGroupRepoStub struct {
	groups []Group
}

func (r *modelPricingDisplayGroupRepoStub) Create(ctx context.Context, group *Group) error {
	if group.ID == 0 {
		group.ID = int64(len(r.groups) + 1)
	}
	r.groups = append(r.groups, *group)
	return nil
}

func (r *modelPricingDisplayGroupRepoStub) GetByID(ctx context.Context, id int64) (*Group, error) {
	for i := range r.groups {
		if r.groups[i].ID == id {
			return &r.groups[i], nil
		}
	}
	return nil, ErrGroupNotFound
}

func (r *modelPricingDisplayGroupRepoStub) GetByIDLite(ctx context.Context, id int64) (*Group, error) {
	return r.GetByID(ctx, id)
}

func (r *modelPricingDisplayGroupRepoStub) Update(ctx context.Context, group *Group) error {
	for i := range r.groups {
		if r.groups[i].ID == group.ID {
			r.groups[i] = *group
			return nil
		}
	}
	return ErrGroupNotFound
}

func (r *modelPricingDisplayGroupRepoStub) Delete(ctx context.Context, id int64) error { return nil }

func (r *modelPricingDisplayGroupRepoStub) DeleteCascade(ctx context.Context, id int64) ([]int64, error) {
	return nil, nil
}

func (r *modelPricingDisplayGroupRepoStub) List(ctx context.Context, params pagination.PaginationParams) ([]Group, *pagination.PaginationResult, error) {
	return r.groups, nil, nil
}

func (r *modelPricingDisplayGroupRepoStub) ListWithFilters(ctx context.Context, params pagination.PaginationParams, platform, status, search string, isExclusive *bool) ([]Group, *pagination.PaginationResult, error) {
	return r.groups, nil, nil
}

func (r *modelPricingDisplayGroupRepoStub) ListActive(ctx context.Context) ([]Group, error) {
	return r.groups, nil
}

func (r *modelPricingDisplayGroupRepoStub) ListActiveByPlatform(ctx context.Context, platform string) ([]Group, error) {
	var out []Group
	for _, group := range r.groups {
		if group.Platform == platform {
			out = append(out, group)
		}
	}
	return out, nil
}

func (r *modelPricingDisplayGroupRepoStub) ExistsByName(ctx context.Context, name string) (bool, error) {
	for _, group := range r.groups {
		if group.Name == name {
			return true, nil
		}
	}
	return false, nil
}

func (r *modelPricingDisplayGroupRepoStub) GetAccountCount(ctx context.Context, groupID int64) (int64, int64, error) {
	return 0, 0, nil
}

func (r *modelPricingDisplayGroupRepoStub) DeleteAccountGroupsByGroupID(ctx context.Context, groupID int64) (int64, error) {
	return 0, nil
}

func (r *modelPricingDisplayGroupRepoStub) GetAccountIDsByGroupIDs(ctx context.Context, groupIDs []int64) ([]int64, error) {
	return nil, nil
}

func (r *modelPricingDisplayGroupRepoStub) BindAccountsToGroup(ctx context.Context, groupID int64, accountIDs []int64) error {
	return nil
}

func (r *modelPricingDisplayGroupRepoStub) UpdateSortOrders(ctx context.Context, updates []GroupSortOrderUpdate) error {
	return nil
}

func newModelPricingDisplayServiceForTest(t *testing.T, configJSON string, groups []Group, channelPricing []ChannelModelPricing) *ModelPricingDisplayService {
	t.Helper()
	settingRepo := &modelPricingDisplaySettingRepoStub{values: map[string]string{
		SettingKeyModelPricingDisplayConfig: configJSON,
	}}
	groupRepo := &modelPricingDisplayGroupRepoStub{groups: groups}
	channelRepo := &mockChannelRepository{
		listAllFn: func(_ context.Context) ([]Channel, error) {
			return []Channel{{
				ID:           1,
				Name:         "primary",
				Status:       StatusActive,
				GroupIDs:     []int64{1, 2, 3},
				ModelPricing: channelPricing,
			}}, nil
		},
		getGroupPlatformsFn: func(_ context.Context, _ []int64) (map[int64]string, error) {
			return map[int64]string{1: "anthropic", 2: "anthropic", 3: "openai"}, nil
		},
	}
	channelService := NewChannelService(channelRepo, groupRepo, nil, nil)
	billingService := &BillingService{fallbackPrices: map[string]*ModelPricing{
		"claude-sonnet-4": {
			InputPricePerToken:         3e-6,
			OutputPricePerToken:        15e-6,
			CacheCreationPricePerToken: 3.75e-6,
			CacheReadPricePerToken:     0.3e-6,
		},
		"gpt-5.4": {
			InputPricePerToken:     2.5e-6,
			OutputPricePerToken:    15e-6,
			CacheReadPricePerToken: 0.25e-6,
		},
	}}
	resolver := NewModelPricingResolver(channelService, billingService)
	return NewModelPricingDisplayService(settingRepo, groupRepo, channelService, resolver)
}

func TestModelPricingDisplayPublicUsesConfiguredModelsAndLowestPublicGroupMultiplier(t *testing.T) {
	configJSON := `{"categories":[{"id":"claude","label":"Claude","description":"Claude family","model_scopes":["claude"],"models":[{"model":"claude-sonnet-4","label":"Claude Sonnet 4"}]}]}`
	groups := []Group{
		{ID: 1, Name: "Public Standard", Platform: "anthropic", RateMultiplier: 0.9, IsExclusive: false, Status: StatusActive, SupportedModelScopes: []string{"claude"}},
		{ID: 2, Name: "Public Discount", Platform: "anthropic", RateMultiplier: 0.7, IsExclusive: false, Status: StatusActive, SupportedModelScopes: []string{"claude"}},
		{ID: 3, Name: "Private Cheaper", Platform: "anthropic", RateMultiplier: 0.2, IsExclusive: true, Status: StatusActive, SupportedModelScopes: []string{"claude"}},
	}
	channelInput := 4e-6
	svc := newModelPricingDisplayServiceForTest(t, configJSON, groups, []ChannelModelPricing{{
		Platform:   "anthropic",
		Models:     []string{"claude-sonnet-4"},
		InputPrice: &channelInput,
	}})

	got, err := svc.BuildPublicPricing(context.Background())
	require.NoError(t, err)
	require.Len(t, got.Products, 1)
	require.Len(t, got.Products[0].Rows, 1)
	require.Equal(t, "Claude Sonnet 4", got.Products[0].Rows[0].Label)
	require.Equal(t, int64(2), *got.Products[0].Rows[0].MultiplierGroupID)
	require.Equal(t, "Public Discount", got.Products[0].Rows[0].MultiplierGroupName)
	require.InDelta(t, 0.7, got.Products[0].Rows[0].Multiplier, 1e-12)
	require.InDelta(t, 4.0, got.Products[0].Rows[0].Input.Official, 1e-12)
	require.InDelta(t, 2.8, got.Products[0].Rows[0].Input.Gateway, 1e-12)
}

func TestModelPricingDisplayPublicFallsBackToGroupPlatformWhenScopesAreEmpty(t *testing.T) {
	configJSON := `{"categories":[{"id":"openai","label":"OpenAI","description":"OpenAI family","model_scopes":["openai"],"models":[{"model":"gpt-5.4","label":"GPT 5.4"}]}]}`
	groups := []Group{
		{ID: 3, Name: "OpenAI Public", Platform: "openai", RateMultiplier: 0.6, IsExclusive: false, Status: StatusActive},
	}
	svc := newModelPricingDisplayServiceForTest(t, configJSON, groups, nil)

	got, err := svc.BuildPublicPricing(context.Background())
	require.NoError(t, err)
	require.Len(t, got.Products, 1)
	require.Len(t, got.Products[0].Rows, 1)
	require.NotNil(t, got.Products[0].Rows[0].MultiplierGroupID)
	require.Equal(t, int64(3), *got.Products[0].Rows[0].MultiplierGroupID)
	require.InDelta(t, 0.6, got.Products[0].Rows[0].Multiplier, 1e-12)
	require.InDelta(t, 2.5, got.Products[0].Rows[0].Input.Official, 1e-12)
	require.InDelta(t, 1.5, got.Products[0].Rows[0].Input.Gateway, 1e-12)
}

func TestModelPricingDisplayConsoleFallsBackToGroupPlatformWhenScopesAreEmpty(t *testing.T) {
	configJSON := `{"categories":[{"id":"openai","label":"OpenAI","model_scopes":["openai"],"models":[{"model":"gpt-5.4"}]}]}`
	groups := []Group{
		{ID: 3, Name: "OpenAI Group", Platform: "openai", RateMultiplier: 0.75, IsExclusive: false, Status: StatusActive},
	}
	svc := newModelPricingDisplayServiceForTest(t, configJSON, groups, nil)

	got, err := svc.BuildConsolePricing(context.Background(), groups, 3)
	require.NoError(t, err)
	require.True(t, got.Products[0].Supported)
	require.Len(t, got.Products[0].Rows, 1)
	require.InDelta(t, 1.875, got.Products[0].Rows[0].Input.Gateway, 1e-12)
}

func TestModelPricingDisplayShowsCacheWriteFromCacheBreakdownPrices(t *testing.T) {
	configJSON := `{"categories":[{"id":"openai","label":"OpenAI","model_scopes":["openai"],"models":[{"model":"gpt-5.4"}]}]}`
	groups := []Group{
		{ID: 3, Name: "OpenAI Public", Platform: "openai", RateMultiplier: 0.5, IsExclusive: false, Status: StatusActive},
	}
	svc := newModelPricingDisplayServiceForTest(t, configJSON, groups, nil)
	svc.resolver.billingService.fallbackPrices["gpt-5.4"] = &ModelPricing{
		InputPricePerToken:     1e-6,
		OutputPricePerToken:    2e-6,
		CacheCreation5mPrice:   3e-6,
		CacheCreation1hPrice:   4e-6,
		CacheReadPricePerToken: 0.2e-6,
		SupportsCacheBreakdown: true,
	}

	got, err := svc.BuildPublicPricing(context.Background())
	require.NoError(t, err)
	require.Len(t, got.Products[0].Rows, 1)
	require.NotNil(t, got.Products[0].Rows[0].CacheWrite)
	require.InDelta(t, 3.0, got.Products[0].Rows[0].CacheWrite.Official, 1e-12)
	require.InDelta(t, 1.5, got.Products[0].Rows[0].CacheWrite.Gateway, 1e-12)
	require.NotNil(t, got.Products[0].Rows[0].CacheRead)
	require.InDelta(t, 0.2, got.Products[0].Rows[0].CacheRead.Official, 1e-12)
	require.InDelta(t, 0.1, got.Products[0].Rows[0].CacheRead.Gateway, 1e-12)
}

func TestModelPricingDisplayFillsMissingDynamicPriceFieldsFromFallbackForDisplay(t *testing.T) {
	configJSON := `{"categories":[{"id":"openai","label":"OpenAI","model_scopes":["openai"],"models":[{"model":"gpt-5.4"}]}]}`
	groups := []Group{
		{ID: 3, Name: "OpenAI Public", Platform: "openai", RateMultiplier: 0.5, IsExclusive: false, Status: StatusActive},
	}
	svc := newModelPricingDisplayServiceForTest(t, configJSON, groups, nil)
	svc.resolver.billingService.pricingService = newStubPricingServiceFromMap(map[string]*LiteLLMModelPricing{
		"gpt-5.4": {
			InputCostPerToken:       2.5e-6,
			OutputCostPerToken:      15e-6,
			CacheReadInputTokenCost: 0.25e-6,
			LiteLLMProvider:         "openai",
		},
	})
	svc.resolver.billingService.fallbackPrices["gpt-5.4"] = &ModelPricing{
		InputPricePerToken:         2.5e-6,
		OutputPricePerToken:        15e-6,
		CacheCreationPricePerToken: 2.5e-6,
		CacheReadPricePerToken:     0.25e-6,
	}

	got, err := svc.BuildPublicPricing(context.Background())
	require.NoError(t, err)
	require.Len(t, got.Products[0].Rows, 1)
	require.NotNil(t, got.Products[0].Rows[0].CacheWrite)
	require.InDelta(t, 2.5, got.Products[0].Rows[0].CacheWrite.Official, 1e-12)
	require.InDelta(t, 1.25, got.Products[0].Rows[0].CacheWrite.Gateway, 1e-12)
	require.NotNil(t, got.Products[0].Rows[0].CacheRead)
	require.InDelta(t, 0.25, got.Products[0].Rows[0].CacheRead.Official, 1e-12)
	require.InDelta(t, 0.125, got.Products[0].Rows[0].CacheRead.Gateway, 1e-12)
}

func TestModelPricingDisplayConsoleUsesSelectedGroupAndMarksUnsupportedCategories(t *testing.T) {
	configJSON := `{"categories":[{"id":"claude","label":"Claude","model_scopes":["claude"],"models":[{"model":"claude-sonnet-4"}]},{"id":"openai","label":"OpenAI","model_scopes":["openai"],"models":[{"model":"gpt-5.4"}]}]}`
	groups := []Group{
		{ID: 1, Name: "Claude Group", Platform: "anthropic", RateMultiplier: 0.8, IsExclusive: false, Status: StatusActive, SupportedModelScopes: []string{"claude"}},
	}
	svc := newModelPricingDisplayServiceForTest(t, configJSON, groups, nil)

	got, err := svc.BuildConsolePricing(context.Background(), groups, 1)
	require.NoError(t, err)
	require.Equal(t, int64(1), got.SelectedGroupID)
	require.Len(t, got.Groups, 1)
	require.Len(t, got.Products, 2)
	require.True(t, got.Products[0].Supported)
	require.Len(t, got.Products[0].Rows, 1)
	require.InDelta(t, 0.8, got.Products[0].Rows[0].Multiplier, 1e-12)
	require.InDelta(t, 2.4, got.Products[0].Rows[0].Input.Gateway, 1e-12)
	require.False(t, got.Products[1].Supported)
	require.Equal(t, "This group does not support this model category.", got.Products[1].UnsupportedReason)
	require.Empty(t, got.Products[1].Rows)
}
