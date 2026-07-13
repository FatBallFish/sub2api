//go:build unit

package service

import (
	"context"
	"strconv"
	"testing"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/stretchr/testify/require"
)

func TestBuildPaymentOrderProviderSnapshot_ExcludesSensitiveConfig(t *testing.T) {
	t.Parallel()

	sel := &payment.InstanceSelection{
		InstanceID:     "12",
		ProviderKey:    payment.TypeWxpay,
		SupportedTypes: "wxpay,wxpay_direct",
		PaymentMode:    "popup",
		Config: map[string]string{
			"privateKey": "secret",
			"apiV3Key":   "secret-v3",
			"appId":      "wx-app-id",
		},
	}

	snapshot := buildPaymentOrderProviderSnapshot(sel, CreateOrderRequest{})
	require.Equal(t, map[string]any{
		"schema_version":       2,
		"provider_instance_id": "12",
		"provider_key":         payment.TypeWxpay,
		"payment_mode":         "popup",
		"merchant_app_id":      "wx-app-id",
		"currency":             "CNY",
	}, snapshot)
	require.NotContains(t, snapshot, "config")
	require.NotContains(t, snapshot, "privateKey")
	require.NotContains(t, snapshot, "apiV3Key")
	require.NotContains(t, snapshot, "supported_types")
	require.NotContains(t, snapshot, "instance_name")
	require.NotContains(t, snapshot, "merchant_id")
}

func TestCreateOrderInTx_WritesProviderSnapshot(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)

	user, err := client.User.Create().
		SetEmail("snapshot@example.com").
		SetPasswordHash("hash").
		SetUsername("snapshot-user").
		Save(ctx)
	require.NoError(t, err)

	instance, err := client.PaymentProviderInstance.Create().
		SetProviderKey(payment.TypeAlipay).
		SetName("Primary Alipay").
		SetConfig(`{"secretKey":"do-not-copy"}`).
		SetSupportedTypes("alipay,alipay_direct").
		SetPaymentMode("redirect").
		SetEnabled(true).
		Save(ctx)
	require.NoError(t, err)

	svc := &PaymentService{entClient: client}
	order, err := svc.createOrderInTx(
		ctx,
		CreateOrderRequest{
			UserID:      user.ID,
			PaymentType: payment.TypeAlipay,
			OrderType:   payment.OrderTypeBalance,
			ClientIP:    "127.0.0.1",
			SrcHost:     "app.example.com",
		},
		&User{
			ID:       user.ID,
			Email:    user.Email,
			Username: user.Username,
		},
		nil,
		&PaymentConfig{
			MaxPendingOrders: 3,
			OrderTimeoutMin:  30,
		},
		88,
		88,
		0,
		88,
		&payment.InstanceSelection{
			InstanceID:     strconv.FormatInt(instance.ID, 10),
			ProviderKey:    payment.TypeAlipay,
			SupportedTypes: "alipay,alipay_direct",
			PaymentMode:    "redirect",
			Config: map[string]string{
				"secretKey": "do-not-copy",
			},
		},
	)
	require.NoError(t, err)
	require.Equal(t, strconv.FormatInt(instance.ID, 10), valueOrEmpty(order.ProviderInstanceID))
	require.Equal(t, payment.TypeAlipay, valueOrEmpty(order.ProviderKey))
	require.Equal(t, float64(2), order.ProviderSnapshot["schema_version"])
	require.Equal(t, strconv.FormatInt(instance.ID, 10), order.ProviderSnapshot["provider_instance_id"])
	require.Equal(t, payment.TypeAlipay, order.ProviderSnapshot["provider_key"])
	require.Equal(t, "redirect", order.ProviderSnapshot["payment_mode"])
	require.NotContains(t, order.ProviderSnapshot, "config")
	require.NotContains(t, order.ProviderSnapshot, "secretKey")
	require.NotContains(t, order.ProviderSnapshot, "supported_types")
	require.NotContains(t, order.ProviderSnapshot, "instance_name")
}

func TestCreateOrderInTx_WritesGlobalPlanSnapshot(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)

	user, err := client.User.Create().
		SetEmail("global-plan-order@example.com").
		SetPasswordHash("hash").
		SetUsername("global-plan-order-user").
		Save(ctx)
	require.NoError(t, err)

	plan, err := client.SubscriptionPlan.Create().
		SetPlanScope(PlanScopeGlobal).
		SetTierRank(20).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(60).
		SetMonthlyMaxUsd(240).
		SetSpeedTier("priority").
		SetSupportTier("priority").
		SetPublicBadge("Best value").
		SetName("Pro").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("day").
		SetFeatures("High-speed routing\nPriority support").
		Save(ctx)
	require.NoError(t, err)

	svc := &PaymentService{entClient: client}
	order, err := svc.createOrderInTx(
		ctx,
		CreateOrderRequest{
			UserID:      user.ID,
			PaymentType: payment.TypeStripe,
			OrderType:   payment.OrderTypeGlobalPlan,
			ClientIP:    "127.0.0.1",
			SrcHost:     "app.example.com",
		},
		&User{
			ID:       user.ID,
			Email:    user.Email,
			Username: user.Username,
		},
		plan,
		&PaymentConfig{
			MaxPendingOrders: 3,
			OrderTimeoutMin:  30,
		},
		49,
		49,
		0,
		49,
		nil,
	)
	require.NoError(t, err)
	require.Equal(t, payment.OrderTypeGlobalPlan, order.OrderType)
	require.Equal(t, PlanScopeGlobal, valueOrEmpty(order.PlanScope))
	require.Equal(t, plan.ID, *order.PlanID)
	require.Nil(t, order.SubscriptionGroupID)
	require.Equal(t, float64(1), order.PlanSnapshot["schema_version"])
	require.Equal(t, float64(plan.ID), order.PlanSnapshot["plan_id"])
	require.Equal(t, PlanScopeGlobal, order.PlanSnapshot["plan_scope"])
	require.Equal(t, "Pro", order.PlanSnapshot["name"])
	require.Equal(t, float64(49), order.PlanSnapshot["price"])
	require.Equal(t, float64(20), order.PlanSnapshot["tier_rank"])
	require.Equal(t, "week", order.PlanSnapshot["quota_period"])
	require.Equal(t, float64(60), order.PlanSnapshot["quota_per_period_usd"])
	require.Equal(t, float64(240), order.PlanSnapshot["monthly_max_usd"])
	require.Equal(t, "Best value", order.PlanSnapshot["public_badge"])
}

func TestCreateOrderInTx_WritesGlobalPlanUpgradeProration(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	user, err := client.User.Create().
		SetEmail("global-plan-upgrade-order@example.com").
		SetPasswordHash("hash").
		SetUsername("global-plan-upgrade-order-user").
		Save(ctx)
	require.NoError(t, err)

	currentPlan, err := client.SubscriptionPlan.Create().
		SetPlanScope(PlanScopeGlobal).
		SetTierRank(10).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(30).
		SetMonthlyMaxUsd(120).
		SetName("Starter").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("day").
		Save(ctx)
	require.NoError(t, err)
	targetPlan, err := client.SubscriptionPlan.Create().
		SetPlanScope(PlanScopeGlobal).
		SetTierRank(20).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(80).
		SetMonthlyMaxUsd(320).
		SetName("Pro").
		SetPrice(99).
		SetValidityDays(30).
		SetValidityUnit("day").
		Save(ctx)
	require.NoError(t, err)
	sub, err := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(currentPlan.ID).
		SetStatus(GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -10)).
		SetExpiresAt(now.AddDate(0, 0, 20)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -3)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 4)).
		SetQuotaPeriod("week").
		SetQuotaLimitUsd(30).
		SetQuotaUsedUsd(7).
		SetTierRank(10).
		SetPlanNameSnapshot("Starter").
		Save(ctx)
	require.NoError(t, err)
	quote, err := NewGlobalPlanService(client).CalculateUpgradeQuote(ctx, user.ID, targetPlan.ID, now)
	require.NoError(t, err)

	svc := &PaymentService{entClient: client}
	order, err := svc.createOrderInTx(
		ctx,
		CreateOrderRequest{
			UserID:       user.ID,
			PaymentType:  payment.TypeStripe,
			OrderType:    payment.OrderTypeGlobalPlanUpgrade,
			ClientIP:     "127.0.0.1",
			SrcHost:      "app.example.com",
			UpgradeQuote: &quote,
		},
		&User{
			ID:       user.ID,
			Email:    user.Email,
			Username: user.Username,
		},
		targetPlan,
		&PaymentConfig{
			MaxPendingOrders: 3,
			OrderTimeoutMin:  30,
		},
		quote.UpgradePrice,
		quote.UpgradePrice,
		0,
		quote.UpgradePrice,
		nil,
	)
	require.NoError(t, err)
	require.Equal(t, payment.OrderTypeGlobalPlanUpgrade, order.OrderType)
	require.Equal(t, quote.UpgradePrice, order.Amount)
	require.Equal(t, quote.UpgradePrice, order.PayAmount)
	require.Equal(t, targetPlan.ID, *order.PlanID)
	require.Equal(t, sub.ID, *order.UpgradeFromSubscriptionID)
	require.Equal(t, float64(sub.ID), order.UpgradeProration["current_subscription_id"])
	require.Equal(t, float64(currentPlan.ID), order.UpgradeProration["from_plan_id"])
	require.Equal(t, float64(targetPlan.ID), order.UpgradeProration["to_plan_id"])
	require.Equal(t, float64(quote.RemainingSeconds), order.UpgradeProration["remaining_seconds"])
	require.Equal(t, float64(quote.CycleSeconds), order.UpgradeProration["cycle_seconds"])
	require.Equal(t, quote.UpgradePrice, order.UpgradeProration["upgrade_price"])
}

func TestCreateOrder_GlobalPlanUpgradeUsesProratedQuoteAmount(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)
	now := time.Now().UTC()

	user, err := client.User.Create().
		SetEmail("global-plan-upgrade-create@example.com").
		SetPasswordHash("hash").
		SetUsername("global-plan-upgrade-create-user").
		SetStatus("active").
		Save(ctx)
	require.NoError(t, err)
	currentPlan, err := client.SubscriptionPlan.Create().
		SetPlanScope(PlanScopeGlobal).
		SetTierRank(10).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(30).
		SetMonthlyMaxUsd(120).
		SetName("Starter").
		SetPrice(49).
		SetValidityDays(30).
		SetValidityUnit("day").
		SetForSale(true).
		Save(ctx)
	require.NoError(t, err)
	targetPlan, err := client.SubscriptionPlan.Create().
		SetPlanScope(PlanScopeGlobal).
		SetTierRank(20).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(80).
		SetMonthlyMaxUsd(320).
		SetName("Pro").
		SetPrice(99).
		SetValidityDays(30).
		SetValidityUnit("day").
		SetForSale(true).
		Save(ctx)
	require.NoError(t, err)
	sub, err := client.UserGlobalPlanSubscription.Create().
		SetUserID(user.ID).
		SetPlanID(currentPlan.ID).
		SetStatus(GlobalPlanStatusActive).
		SetStartsAt(now.AddDate(0, 0, -10)).
		SetExpiresAt(now.AddDate(0, 0, 20)).
		SetCurrentPeriodStart(now.AddDate(0, 0, -3)).
		SetCurrentPeriodEnd(now.AddDate(0, 0, 4)).
		SetQuotaPeriod("week").
		SetQuotaLimitUsd(30).
		SetQuotaUsedUsd(7).
		SetTierRank(10).
		SetPlanNameSnapshot("Starter").
		Save(ctx)
	require.NoError(t, err)
	_, err = client.PaymentProviderInstance.Create().
		SetProviderKey(payment.TypeEasyPay).
		SetName("EasyPay Popup").
		SetConfig(`{"pid":"1000","pkey":"secret","apiBase":"https://pay.example.com","notifyUrl":"https://api.example.com/notify","returnUrl":"https://app.example.com/return"}`).
		SetSupportedTypes("alipay").
		SetPaymentMode("popup").
		SetEnabled(true).
		Save(ctx)
	require.NoError(t, err)

	configRepo := &paymentConfigSettingRepoStub{values: map[string]string{
		SettingPaymentEnabled:      "true",
		SettingEnabledPaymentTypes: payment.TypeAlipay,
		SettingMaxPendingOrders:    "3",
	}}
	configService := &PaymentConfigService{entClient: client, settingRepo: configRepo}
	loadBalancer := payment.NewDefaultLoadBalancer(client, nil)
	svc := NewPaymentService(
		client,
		payment.NewRegistry(),
		loadBalancer,
		nil,
		nil,
		configService,
		&paymentOrderUserRepoStub{user: &User{ID: user.ID, Email: user.Email, Username: user.Username, Status: "active"}},
		nil,
		nil,
	)
	svc.SetGlobalPlanService(NewGlobalPlanService(client))

	resp, err := svc.CreateOrder(ctx, CreateOrderRequest{
		UserID:        user.ID,
		PaymentType:   payment.TypeAlipay,
		OrderType:     payment.OrderTypeGlobalPlanUpgrade,
		PlanID:        targetPlan.ID,
		ClientIP:      "127.0.0.1",
		SrcHost:       "app.example.com",
		ReturnURL:     "https://app.example.com/payment/result",
		PaymentSource: "hosted_redirect",
	})
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.InDelta(t, 33.33, resp.Amount, 0.02)
	require.Contains(t, resp.PayURL, "https://pay.example.com/submit.php")

	order, err := client.PaymentOrder.Query().Only(ctx)
	require.NoError(t, err)
	require.Equal(t, payment.OrderTypeGlobalPlanUpgrade, order.OrderType)
	require.InDelta(t, 33.33, order.Amount, 0.02)
	require.InDelta(t, 33.33, order.PayAmount, 0.02)
	require.Equal(t, targetPlan.ID, *order.PlanID)
	require.Equal(t, sub.ID, *order.UpgradeFromSubscriptionID)
	require.Equal(t, float64(sub.ID), order.UpgradeProration["current_subscription_id"])
	require.Equal(t, float64(currentPlan.ID), order.UpgradeProration["from_plan_id"])
	require.Equal(t, float64(targetPlan.ID), order.UpgradeProration["to_plan_id"])
}

func TestCreateOrder_WithExplicitUSDAmountCurrencyConvertsProviderPayAmount(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)

	user, err := client.User.Create().
		SetEmail("usd-topup@example.com").
		SetPasswordHash("hash").
		SetUsername("usd-topup-user").
		SetStatus("active").
		Save(ctx)
	require.NoError(t, err)
	_, err = client.PaymentProviderInstance.Create().
		SetProviderKey(payment.TypeEasyPay).
		SetName("EasyPay Popup CNY").
		SetConfig(`{"pid":"1000","pkey":"secret","apiBase":"https://pay.example.com","notifyUrl":"https://api.example.com/notify","returnUrl":"https://app.example.com/return"}`).
		SetSupportedTypes("alipay").
		SetPaymentMode("popup").
		SetEnabled(true).
		Save(ctx)
	require.NoError(t, err)

	configRepo := &paymentConfigSettingRepoStub{values: map[string]string{
		SettingPaymentEnabled:      "true",
		SettingEnabledPaymentTypes: payment.TypeAlipay,
		SettingMaxPendingOrders:    "3",
		SettingBalanceRechargeMult: "1.05",
		SettingCurrencyExchange:    "USD:CNY=7.20,CNY:USD=0.13888889",
	}}
	configService := &PaymentConfigService{entClient: client, settingRepo: configRepo}
	loadBalancer := payment.NewDefaultLoadBalancer(client, nil)
	svc := NewPaymentService(
		client,
		payment.NewRegistry(),
		loadBalancer,
		nil,
		nil,
		configService,
		&paymentOrderUserRepoStub{user: &User{ID: user.ID, Email: user.Email, Username: user.Username, Status: "active"}},
		nil,
		nil,
	)

	resp, err := svc.CreateOrder(ctx, CreateOrderRequest{
		UserID:         user.ID,
		Amount:         10,
		AmountCurrency: "USD",
		PaymentType:    payment.TypeAlipay,
		OrderType:      payment.OrderTypeBalance,
		ClientIP:       "127.0.0.1",
		SrcHost:        "app.example.com",
		ReturnURL:      "https://app.example.com/payment/result",
		PaymentSource:  "hosted_redirect",
	})
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.InDelta(t, 10.5, resp.Amount, 0.001)
	require.InDelta(t, 72, resp.PayAmount, 0.001)
	require.Equal(t, "CNY", resp.Currency)

	order, err := client.PaymentOrder.Query().Only(ctx)
	require.NoError(t, err)
	require.InDelta(t, 10.5, order.Amount, 0.001)
	require.InDelta(t, 72, order.PayAmount, 0.001)
	require.Equal(t, "USD", order.RefundSnapshot["amount_currency"])
	require.Equal(t, "CNY", order.RefundSnapshot["payment_currency"])
	require.InDelta(t, 7.2, order.RefundSnapshot["currency_exchange_rate"], 0.001)
	require.Contains(t, resp.PayURL, "money=72.00")
}

func TestCreateOrder_GlobalPlanUsesLegacySubscriptionUSDToCNYRate(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)

	user, err := client.User.Create().
		SetEmail("legacy-subscription-rate@example.com").
		SetPasswordHash("hash").
		SetUsername("legacy-subscription-rate-user").
		SetStatus("active").
		Save(ctx)
	require.NoError(t, err)
	plan, err := client.SubscriptionPlan.Create().
		SetPlanScope(PlanScopeGlobal).
		SetTierRank(10).
		SetQuotaPeriod("week").
		SetQuotaPerPeriodUsd(30).
		SetMonthlyMaxUsd(120).
		SetName("Legacy USD Plan").
		SetPrice(9.99).
		SetValidityDays(30).
		SetValidityUnit("day").
		SetForSale(true).
		Save(ctx)
	require.NoError(t, err)
	_, err = client.PaymentProviderInstance.Create().
		SetProviderKey(payment.TypeEasyPay).
		SetName("EasyPay Popup CNY").
		SetConfig(`{"pid":"1000","pkey":"secret","apiBase":"https://pay.example.com","notifyUrl":"https://api.example.com/notify","returnUrl":"https://app.example.com/return"}`).
		SetSupportedTypes("alipay").
		SetPaymentMode("popup").
		SetEnabled(true).
		Save(ctx)
	require.NoError(t, err)

	configRepo := &paymentConfigSettingRepoStub{values: map[string]string{
		SettingPaymentEnabled:                   "true",
		SettingEnabledPaymentTypes:              payment.TypeAlipay,
		SettingMaxPendingOrders:                 "3",
		SettingSubscriptionUSDToCNYRate:         "7.15",
		SettingCurrencyExchange:                 "",
		SettingBalanceRechargeMult:              "1",
		SettingPaymentVisibleMethodAlipaySource: VisibleMethodSourceOfficialAlipay,
	}}
	configService := &PaymentConfigService{entClient: client, settingRepo: configRepo}
	loadBalancer := payment.NewDefaultLoadBalancer(client, nil)
	svc := NewPaymentService(
		client,
		payment.NewRegistry(),
		loadBalancer,
		nil,
		nil,
		configService,
		&paymentOrderUserRepoStub{user: &User{ID: user.ID, Email: user.Email, Username: user.Username, Status: "active"}},
		nil,
		nil,
	)
	svc.SetGlobalPlanService(NewGlobalPlanService(client))

	resp, err := svc.CreateOrder(ctx, CreateOrderRequest{
		UserID:        user.ID,
		PaymentType:   payment.TypeAlipay,
		OrderType:     payment.OrderTypeGlobalPlan,
		PlanID:        plan.ID,
		ClientIP:      "127.0.0.1",
		SrcHost:       "app.example.com",
		ReturnURL:     "https://app.example.com/payment/result",
		PaymentSource: "hosted_redirect",
	})
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.InDelta(t, 9.99, resp.Amount, 0.001)
	require.InDelta(t, 71.43, resp.PayAmount, 0.001)
	require.Equal(t, "CNY", resp.Currency)

	order, err := client.PaymentOrder.Query().Only(ctx)
	require.NoError(t, err)
	require.InDelta(t, 9.99, order.Amount, 0.001)
	require.InDelta(t, 71.43, order.PayAmount, 0.001)
	require.Equal(t, "USD", order.RefundSnapshot["amount_currency"])
	require.Equal(t, "CNY", order.RefundSnapshot["payment_currency"])
	require.InDelta(t, 7.15, order.RefundSnapshot["currency_exchange_rate"], 0.001)
	require.Contains(t, resp.PayURL, "money=71.43")
}

func TestEnsureGlobalPlanVisibleAllowsBlacklistWhenUserHasOtherEligibleGroup(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)

	blockedGroup, err := client.Group.Create().
		SetName("OpenAI - Test").
		SetPlatform(PlatformOpenAI).
		SetIsExclusive(false).
		SetStatus("active").
		Save(ctx)
	require.NoError(t, err)
	eligibleGroup, err := client.Group.Create().
		SetName("OpenAI - Prod").
		SetPlatform(PlatformOpenAI).
		SetIsExclusive(false).
		SetStatus("active").
		Save(ctx)
	require.NoError(t, err)
	plan := &dbent.SubscriptionPlan{
		PlanScope:           PlanScopeGlobal,
		ApplicableGroupMode: PlanApplicableGroupModeBlacklist,
		ApplicableGroupIds:  []int64{blockedGroup.ID},
	}
	svc := &PaymentService{
		configService: &PaymentConfigService{entClient: client},
	}

	err = svc.ensureGlobalPlanVisibleToUser(ctx, plan, &User{
		ID:            1,
		AllowedGroups: []int64{blockedGroup.ID, eligibleGroup.ID},
	})
	require.NoError(t, err)
}

func TestEnsureGlobalPlanVisibleRejectsBlacklistWhenAllUserGroupsAreBlacklisted(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)

	blockedGroup, err := client.Group.Create().
		SetName("OpenAI - Test").
		SetPlatform(PlatformOpenAI).
		SetIsExclusive(false).
		SetStatus("active").
		Save(ctx)
	require.NoError(t, err)
	plan := &dbent.SubscriptionPlan{
		PlanScope:           PlanScopeGlobal,
		ApplicableGroupMode: PlanApplicableGroupModeBlacklist,
		ApplicableGroupIds:  []int64{blockedGroup.ID},
	}
	svc := &PaymentService{
		configService: &PaymentConfigService{entClient: client},
	}

	err = svc.ensureGlobalPlanVisibleToUser(ctx, plan, &User{
		ID:            1,
		AllowedGroups: []int64{blockedGroup.ID},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "PLAN_NOT_AVAILABLE_FOR_GROUPS")
}

type paymentOrderUserRepoStub struct {
	user *User
}

func (s *paymentOrderUserRepoStub) Create(context.Context, *User) error           { return nil }
func (s *paymentOrderUserRepoStub) GetByID(context.Context, int64) (*User, error) { return s.user, nil }
func (s *paymentOrderUserRepoStub) GetByIDIncludeDeleted(context.Context, int64) (*User, error) {
	return s.user, nil
}
func (s *paymentOrderUserRepoStub) GetByEmail(context.Context, string) (*User, error) {
	return s.user, nil
}
func (s *paymentOrderUserRepoStub) GetFirstAdmin(context.Context) (*User, error) { return s.user, nil }
func (s *paymentOrderUserRepoStub) Update(context.Context, *User) error          { return nil }
func (s *paymentOrderUserRepoStub) Delete(context.Context, int64) error          { return nil }
func (s *paymentOrderUserRepoStub) GetUserAvatar(context.Context, int64) (*UserAvatar, error) {
	return nil, nil
}
func (s *paymentOrderUserRepoStub) UpsertUserAvatar(context.Context, int64, UpsertUserAvatarInput) (*UserAvatar, error) {
	return nil, nil
}
func (s *paymentOrderUserRepoStub) DeleteUserAvatar(context.Context, int64) error { return nil }
func (s *paymentOrderUserRepoStub) List(context.Context, pagination.PaginationParams) ([]User, *pagination.PaginationResult, error) {
	return nil, nil, nil
}
func (s *paymentOrderUserRepoStub) ListWithFilters(context.Context, pagination.PaginationParams, UserListFilters) ([]User, *pagination.PaginationResult, error) {
	return nil, nil, nil
}
func (s *paymentOrderUserRepoStub) GetLatestUsedAtByUserIDs(context.Context, []int64) (map[int64]*time.Time, error) {
	return nil, nil
}
func (s *paymentOrderUserRepoStub) GetLatestUsedAtByUserID(context.Context, int64) (*time.Time, error) {
	return nil, nil
}
func (s *paymentOrderUserRepoStub) UpdateUserLastActiveAt(context.Context, int64, time.Time) error {
	return nil
}
func (s *paymentOrderUserRepoStub) UpdateBalance(context.Context, int64, float64) error { return nil }
func (s *paymentOrderUserRepoStub) DeductBalance(context.Context, int64, float64) error { return nil }
func (s *paymentOrderUserRepoStub) UpdateConcurrency(context.Context, int64, int) error { return nil }
func (s *paymentOrderUserRepoStub) BatchSetConcurrency(context.Context, []int64, int) (int, error) {
	return 0, nil
}
func (s *paymentOrderUserRepoStub) BatchAddConcurrency(context.Context, []int64, int) (int, error) {
	return 0, nil
}
func (s *paymentOrderUserRepoStub) ExistsByEmail(context.Context, string) (bool, error) {
	return false, nil
}
func (s *paymentOrderUserRepoStub) RemoveGroupFromAllowedGroups(context.Context, int64) (int64, error) {
	return 0, nil
}
func (s *paymentOrderUserRepoStub) AddGroupToAllowedGroups(context.Context, int64, int64) error {
	return nil
}
func (s *paymentOrderUserRepoStub) RemoveGroupFromUserAllowedGroups(context.Context, int64, int64) error {
	return nil
}
func (s *paymentOrderUserRepoStub) ListUserAuthIdentities(context.Context, int64) ([]UserAuthIdentityRecord, error) {
	return nil, nil
}
func (s *paymentOrderUserRepoStub) UnbindUserAuthProvider(context.Context, int64, string) error {
	return nil
}
func (s *paymentOrderUserRepoStub) UpdateTotpSecret(context.Context, int64, *string) error {
	return nil
}
func (s *paymentOrderUserRepoStub) EnableTotp(context.Context, int64) error  { return nil }
func (s *paymentOrderUserRepoStub) DisableTotp(context.Context, int64) error { return nil }

func TestNormalizePlanOrderType_GlobalPlanCompatibility(t *testing.T) {
	require.Equal(t, payment.OrderTypeGlobalPlan, normalizePlanOrderType(payment.OrderTypeSubscription, PlanScopeGlobal))
	require.Equal(t, payment.OrderTypeGlobalPlan, normalizePlanOrderType(payment.OrderTypeGlobalPlan, PlanScopeGlobal))
	require.Equal(t, payment.OrderTypeGlobalPlanUpgrade, normalizePlanOrderType(payment.OrderTypeGlobalPlanUpgrade, PlanScopeGlobal))
	require.Equal(t, payment.OrderTypeSubscription, normalizePlanOrderType(payment.OrderTypeSubscription, PlanScopeGroup))
}

func TestBuildPaymentOrderProviderSnapshot_UsesWxpayJSAPIAppIDForOpenIDOrders(t *testing.T) {
	t.Parallel()

	snapshot := buildPaymentOrderProviderSnapshot(&payment.InstanceSelection{
		InstanceID:  "88",
		ProviderKey: payment.TypeWxpay,
		Config: map[string]string{
			"appId":   "wx-open-app",
			"mpAppId": "wx-mp-app",
			"mchId":   "mch-88",
		},
		PaymentMode: "jsapi",
	}, CreateOrderRequest{OpenID: "openid-123"})

	require.Equal(t, "wx-mp-app", snapshot["merchant_app_id"])
	require.Equal(t, "mch-88", snapshot["merchant_id"])
	require.Equal(t, "CNY", snapshot["currency"])
}

func TestBuildPaymentOrderProviderSnapshot_IncludesAlipayMerchantIdentity(t *testing.T) {
	t.Parallel()

	snapshot := buildPaymentOrderProviderSnapshot(&payment.InstanceSelection{
		InstanceID:  "21",
		ProviderKey: payment.TypeAlipay,
		Config: map[string]string{
			"appId":      "alipay-app-21",
			"privateKey": "secret",
		},
		PaymentMode: "redirect",
	}, CreateOrderRequest{})

	require.Equal(t, "alipay-app-21", snapshot["merchant_app_id"])
	require.NotContains(t, snapshot, "privateKey")
}

func TestBuildPaymentOrderProviderSnapshot_IncludesEasyPayMerchantIdentity(t *testing.T) {
	t.Parallel()

	snapshot := buildPaymentOrderProviderSnapshot(&payment.InstanceSelection{
		InstanceID:  "66",
		ProviderKey: payment.TypeEasyPay,
		Config: map[string]string{
			"pid":  "easypay-merchant-66",
			"pkey": "secret",
		},
		PaymentMode: "popup",
	}, CreateOrderRequest{PaymentType: payment.TypeAlipay})

	require.Equal(t, "easypay-merchant-66", snapshot["merchant_id"])
	require.NotContains(t, snapshot, "pkey")
}

func TestBuildPaymentOrderProviderSnapshot_IncludesProviderCurrency(t *testing.T) {
	t.Parallel()

	stripeSnapshot := buildPaymentOrderProviderSnapshot(&payment.InstanceSelection{
		InstanceID:  "77",
		ProviderKey: payment.TypeStripe,
		Config: map[string]string{
			"currency": "hkd",
		},
	}, CreateOrderRequest{})
	require.Equal(t, "HKD", stripeSnapshot["currency"])

	airwallexSnapshot := buildPaymentOrderProviderSnapshot(&payment.InstanceSelection{
		InstanceID:  "78",
		ProviderKey: payment.TypeAirwallex,
		Config: map[string]string{
			"currency":  "usd",
			"accountId": "acct-78",
		},
	}, CreateOrderRequest{})
	require.Equal(t, "USD", airwallexSnapshot["currency"])
	require.Equal(t, "acct-78", airwallexSnapshot["merchant_id"])

	jeepaySnapshot := buildPaymentOrderProviderSnapshot(&payment.InstanceSelection{
		InstanceID:  "79",
		ProviderKey: payment.TypeJeepay,
		Config: map[string]string{
			"currency": "usd",
			"mchNo":    "mch-79",
			"appId":    "app-79",
		},
	}, CreateOrderRequest{})
	require.Equal(t, "USD", jeepaySnapshot["currency"])
	require.Equal(t, "mch-79", jeepaySnapshot["merchant_id"])
	require.Equal(t, "app-79", jeepaySnapshot["merchant_app_id"])
}

func valueOrEmpty(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
