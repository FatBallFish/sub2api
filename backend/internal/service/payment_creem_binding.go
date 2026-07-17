package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/creemproductbinding"
	"github.com/Wei-Shaw/sub2api/ent/paymentorder"
	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/Wei-Shaw/sub2api/internal/payment/provider"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

const (
	CreemBindingTargetBalance    = "balance"
	CreemBindingTargetGroupPlan  = "group_plan"
	CreemBindingTargetGlobalPlan = "global_plan"

	CreemBindingHealthHealthy = "healthy"
	CreemBindingHealthStale   = "stale"
	CreemBindingHealthInvalid = "invalid"
)

type creemProductClient interface {
	GetProduct(context.Context, string) (*provider.CreemProduct, error)
	MerchantIdentityMetadata() map[string]string
}

var createCreemProductClient = func(instanceID string, config map[string]string) (creemProductClient, error) {
	return provider.NewCreem(instanceID, config)
}

type CreateCreemBindingRequest struct {
	ProductID       string   `json:"product_id"`
	TargetType      string   `json:"target_type"`
	PlanID          *int64   `json:"plan_id"`
	CreditedBalance *float64 `json:"credited_balance"`
	Enabled         bool     `json:"enabled"`
	SortOrder       int      `json:"sort_order"`
}

type UpdateCreemBindingRequest struct {
	TargetType      *string  `json:"target_type"`
	PlanID          *int64   `json:"plan_id"`
	ClearPlanID     bool     `json:"clear_plan_id"`
	CreditedBalance *float64 `json:"credited_balance"`
	ClearBalance    bool     `json:"clear_credited_balance"`
	Enabled         *bool    `json:"enabled"`
	SortOrder       *int     `json:"sort_order"`
}

type CreemFixedOffer struct {
	OfferID         int64    `json:"offer_id"`
	PaymentType     string   `json:"payment_type"`
	TargetType      string   `json:"target_type"`
	PlanID          *int64   `json:"plan_id,omitempty"`
	Title           string   `json:"title"`
	PayAmount       float64  `json:"pay_amount"`
	PaymentCurrency string   `json:"payment_currency"`
	CreditedAmount  *float64 `json:"credited_amount,omitempty"`
	TaxMode         string   `json:"tax_mode"`
	SortOrder       int      `json:"sort_order"`
}

func validateCreemBindingTarget(target string, planID *int64, creditedBalance *float64) error {
	switch target {
	case CreemBindingTargetBalance:
		if planID != nil || creditedBalance == nil || *creditedBalance <= 0 {
			return infraerrors.BadRequest("CREEM_TARGET_INVALID", "balance target requires a positive credited_balance and no plan_id")
		}
	case CreemBindingTargetGroupPlan, CreemBindingTargetGlobalPlan:
		if planID == nil || *planID <= 0 || creditedBalance != nil {
			return infraerrors.BadRequest("CREEM_TARGET_INVALID", "plan target requires plan_id and no credited_balance")
		}
	default:
		return infraerrors.BadRequest("CREEM_TARGET_INVALID", "invalid Creem target_type")
	}
	return nil
}

func (s *PaymentConfigService) ListCreemBindings(ctx context.Context, instanceID int64) ([]*dbent.CreemProductBinding, error) {
	if _, _, err := s.loadCreemProvider(ctx, instanceID); err != nil {
		return nil, err
	}
	return s.entClient.CreemProductBinding.Query().
		Where(creemproductbinding.ProviderInstanceIDEQ(instanceID)).
		Order(dbent.Asc(creemproductbinding.FieldSortOrder), dbent.Asc(creemproductbinding.FieldID)).
		All(ctx)
}

func (s *PaymentConfigService) ListCreemFixedOffers(ctx context.Context) ([]CreemFixedOffer, error) {
	cfg, err := s.GetPaymentConfig(ctx)
	if err != nil {
		return nil, err
	}
	if !stringSliceContains(cfg.EnabledTypes, payment.TypeCreem) {
		return []CreemFixedOffer{}, nil
	}
	bindings, err := s.entClient.CreemProductBinding.Query().Where(
		creemproductbinding.EnabledEQ(true),
		creemproductbinding.HealthStatusEQ(CreemBindingHealthHealthy),
		creemproductbinding.BillingTypeEQ("onetime"),
		creemproductbinding.ProductStatusEQ("active"),
	).Order(dbent.Asc(creemproductbinding.FieldSortOrder), dbent.Asc(creemproductbinding.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	offers := make([]CreemFixedOffer, 0, len(bindings))
	for _, binding := range bindings {
		instance, err := s.entClient.PaymentProviderInstance.Get(ctx, binding.ProviderInstanceID)
		if err != nil || !instance.Enabled || instance.ProviderKey != payment.TypeCreem {
			continue
		}
		if binding.PlanID != nil {
			plan, err := s.GetPlan(ctx, *binding.PlanID)
			if err != nil || !plan.ForSale {
				continue
			}
			expectedMinor, err := s.expectedCreemPlanPriceMinor(ctx, plan.Price, binding.Currency)
			if err != nil || expectedMinor != binding.PriceMinor {
				continue
			}
		}
		offers = append(offers, CreemFixedOffer{
			OfferID: binding.ID, PaymentType: payment.TypeCreem, TargetType: binding.TargetType,
			PlanID: binding.PlanID, Title: binding.ProductName,
			PayAmount: payment.MinorUnitToAmount(binding.PriceMinor, binding.Currency), PaymentCurrency: binding.Currency,
			CreditedAmount: binding.CreditedBalance, TaxMode: binding.TaxMode, SortOrder: binding.SortOrder,
		})
	}
	return offers, nil
}

func (s *PaymentConfigService) ResolveCreemOffer(ctx context.Context, offerID int64) (*dbent.CreemProductBinding, *payment.InstanceSelection, error) {
	if offerID <= 0 {
		return nil, nil, infraerrors.BadRequest("CREEM_OFFER_REQUIRED", "Creem requires offer_id")
	}
	binding, err := s.entClient.CreemProductBinding.Query().Where(
		creemproductbinding.IDEQ(offerID), creemproductbinding.EnabledEQ(true),
		creemproductbinding.HealthStatusEQ(CreemBindingHealthHealthy),
		creemproductbinding.BillingTypeEQ("onetime"), creemproductbinding.ProductStatusEQ("active"),
	).Only(ctx)
	if err != nil {
		return nil, nil, infraerrors.NotFound("CREEM_OFFER_NOT_FOUND", "Creem offer not found")
	}
	instance, err := s.entClient.PaymentProviderInstance.Get(ctx, binding.ProviderInstanceID)
	if err != nil || !instance.Enabled || instance.ProviderKey != payment.TypeCreem {
		return nil, nil, infraerrors.NotFound("CREEM_OFFER_NOT_FOUND", "Creem offer is unavailable")
	}
	config, err := s.decryptConfig(instance.Config)
	if err != nil {
		return nil, nil, err
	}
	config["_creem_price_minor"] = fmt.Sprintf("%d", binding.PriceMinor)
	return binding, &payment.InstanceSelection{
		InstanceID: fmt.Sprintf("%d", instance.ID), ProviderKey: payment.TypeCreem, Config: config,
		SupportedTypes: payment.TypeCreem, PaymentMode: "redirect",
	}, nil
}

func (s *PaymentConfigService) CreateCreemBinding(ctx context.Context, instanceID int64, req CreateCreemBindingRequest) (*dbent.CreemProductBinding, error) {
	if err := validateCreemBindingTarget(req.TargetType, req.PlanID, req.CreditedBalance); err != nil {
		return nil, err
	}
	creemProvider, environment, err := s.loadCreemProvider(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	product, err := creemProvider.GetProduct(ctx, strings.TrimSpace(req.ProductID))
	if err != nil {
		return nil, err
	}
	if err := s.validateCreemProductBinding(ctx, req.TargetType, req.PlanID, product); err != nil {
		return nil, err
	}
	now := time.Now()
	return s.entClient.CreemProductBinding.Create().
		SetProviderInstanceID(instanceID).
		SetExternalProductID(product.ID).
		SetTargetType(req.TargetType).
		SetNillablePlanID(req.PlanID).
		SetNillableCreditedBalance(req.CreditedBalance).
		SetProductName(product.Name).
		SetPriceMinor(product.PriceMinor).
		SetCurrency(product.Currency).
		SetBillingType(product.BillingType).
		SetProductStatus(product.Status).
		SetTaxMode(normalizeCreemTaxMode(product.TaxMode)).
		SetEnvironment(environment).
		SetEnabled(req.Enabled).
		SetHealthStatus(CreemBindingHealthHealthy).
		SetSortOrder(req.SortOrder).
		SetLastSyncedAt(now).
		Save(ctx)
}

func (s *PaymentConfigService) UpdateCreemBinding(ctx context.Context, instanceID, bindingID int64, req UpdateCreemBindingRequest) (*dbent.CreemProductBinding, error) {
	binding, err := s.getCreemBinding(ctx, instanceID, bindingID)
	if err != nil {
		return nil, err
	}
	target := binding.TargetType
	if req.TargetType != nil {
		target = *req.TargetType
	}
	planID := binding.PlanID
	if req.ClearPlanID {
		planID = nil
	} else if req.PlanID != nil {
		planID = req.PlanID
	}
	balance := binding.CreditedBalance
	if req.ClearBalance {
		balance = nil
	} else if req.CreditedBalance != nil {
		balance = req.CreditedBalance
	}
	if err := validateCreemBindingTarget(target, planID, balance); err != nil {
		return nil, err
	}
	product := &provider.CreemProduct{ID: binding.ExternalProductID, Name: binding.ProductName, PriceMinor: binding.PriceMinor, Currency: binding.Currency, BillingType: binding.BillingType, Status: binding.ProductStatus, TaxMode: binding.TaxMode}
	if err := s.validateCreemProductBinding(ctx, target, planID, product); err != nil {
		return nil, err
	}
	u := s.entClient.CreemProductBinding.UpdateOneID(bindingID).SetTargetType(target)
	if planID == nil {
		u.ClearPlanID()
	} else {
		u.SetPlanID(*planID)
	}
	if balance == nil {
		u.ClearCreditedBalance()
	} else {
		u.SetCreditedBalance(*balance)
	}
	if req.Enabled != nil {
		u.SetEnabled(*req.Enabled)
	}
	if req.SortOrder != nil {
		u.SetSortOrder(*req.SortOrder)
	}
	return u.Save(ctx)
}

func (s *PaymentConfigService) SyncCreemBinding(ctx context.Context, instanceID, bindingID int64) (*dbent.CreemProductBinding, error) {
	binding, err := s.getCreemBinding(ctx, instanceID, bindingID)
	if err != nil {
		return nil, err
	}
	creemProvider, environment, err := s.loadCreemProvider(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	product, err := creemProvider.GetProduct(ctx, binding.ExternalProductID)
	if err != nil {
		_, _ = s.entClient.CreemProductBinding.UpdateOneID(bindingID).SetHealthStatus(CreemBindingHealthStale).SetHealthReason(err.Error()).Save(ctx)
		return nil, err
	}
	if err := s.validateCreemProductBinding(ctx, binding.TargetType, binding.PlanID, product); err != nil {
		_, _ = s.entClient.CreemProductBinding.UpdateOneID(bindingID).SetHealthStatus(CreemBindingHealthInvalid).SetHealthReason(err.Error()).SetProductStatus(product.Status).SetBillingType(product.BillingType).Save(ctx)
		return nil, err
	}
	return s.entClient.CreemProductBinding.UpdateOneID(bindingID).
		SetProductName(product.Name).SetPriceMinor(product.PriceMinor).SetCurrency(product.Currency).
		SetBillingType(product.BillingType).SetProductStatus(product.Status).SetTaxMode(normalizeCreemTaxMode(product.TaxMode)).
		SetEnvironment(environment).SetHealthStatus(CreemBindingHealthHealthy).SetHealthReason("").SetLastSyncedAt(time.Now()).Save(ctx)
}

func (s *PaymentConfigService) DeleteCreemBinding(ctx context.Context, instanceID, bindingID int64) error {
	if _, err := s.getCreemBinding(ctx, instanceID, bindingID); err != nil {
		return err
	}
	count, err := s.entClient.PaymentOrder.Query().Where(
		paymentorder.ProviderInstanceIDEQ(fmt.Sprintf("%d", instanceID)),
		paymentorder.StatusIn(pendingOrderStatuses...),
	).Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return infraerrors.Conflict("PENDING_ORDERS", "Creem instance has pending orders")
	}
	return s.entClient.CreemProductBinding.DeleteOneID(bindingID).Exec(ctx)
}

func (s *PaymentConfigService) getCreemBinding(ctx context.Context, instanceID, bindingID int64) (*dbent.CreemProductBinding, error) {
	binding, err := s.entClient.CreemProductBinding.Query().Where(
		creemproductbinding.IDEQ(bindingID), creemproductbinding.ProviderInstanceIDEQ(instanceID),
	).Only(ctx)
	if err != nil {
		return nil, infraerrors.NotFound("CREEM_OFFER_NOT_FOUND", "Creem Product binding not found")
	}
	return binding, nil
}

func (s *PaymentConfigService) loadCreemProvider(ctx context.Context, instanceID int64) (creemProductClient, string, error) {
	instance, err := s.entClient.PaymentProviderInstance.Get(ctx, instanceID)
	if err != nil || instance.ProviderKey != payment.TypeCreem {
		return nil, "", infraerrors.NotFound("CREEM_PROVIDER_NOT_FOUND", "Creem provider instance not found")
	}
	config, err := s.decryptConfig(instance.Config)
	if err != nil {
		return nil, "", err
	}
	creemProvider, err := createCreemProductClient(fmt.Sprintf("%d", instanceID), config)
	if err != nil {
		return nil, "", err
	}
	return creemProvider, creemProvider.MerchantIdentityMetadata()["environment"], nil
}

func (s *PaymentConfigService) validateCreemProductBinding(ctx context.Context, target string, planID *int64, product *provider.CreemProduct) error {
	if product == nil || strings.TrimSpace(product.ID) == "" || product.PriceMinor <= 0 {
		return infraerrors.BadRequest("CREEM_PRODUCT_INVALID", "Creem Product is invalid")
	}
	if product.BillingType != "onetime" {
		return infraerrors.BadRequest("CREEM_PRODUCT_NOT_ONETIME", "Creem Product must be onetime")
	}
	if product.Status != "active" {
		return infraerrors.Conflict("CREEM_PRODUCT_INACTIVE", "Creem Product is not active")
	}
	if _, err := payment.NormalizePaymentCurrency(product.Currency); err != nil {
		return infraerrors.BadRequest("CREEM_PRODUCT_INVALID", "Creem Product currency is invalid")
	}
	if target == CreemBindingTargetBalance {
		return nil
	}
	plan, err := s.GetPlan(ctx, *planID)
	if err != nil || !plan.ForSale {
		return infraerrors.NotFound("PLAN_NOT_AVAILABLE", "plan not found or not for sale")
	}
	wantScope := PlanScopeGroup
	if target == CreemBindingTargetGlobalPlan {
		wantScope = PlanScopeGlobal
	}
	if plan.PlanScope != wantScope {
		return infraerrors.BadRequest("CREEM_TARGET_MISMATCH", "plan scope does not match Creem target")
	}
	expectedMinor, err := s.expectedCreemPlanPriceMinor(ctx, plan.Price, product.Currency)
	if err != nil || expectedMinor != product.PriceMinor {
		return infraerrors.Conflict("CREEM_PRODUCT_STALE", "Creem Product price does not match plan price")
	}
	return nil
}

func (s *PaymentConfigService) expectedCreemPlanPriceMinor(ctx context.Context, planPrice float64, currency string) (int64, error) {
	cfg, err := s.GetPaymentConfig(ctx)
	if err != nil {
		return 0, err
	}
	converted, _, err := convertPaymentBillingAmount(
		planPrice,
		"USD",
		currency,
		parsePaymentCurrencyExchangeRatesWithLegacySubscriptionRate(cfg.CurrencyExchangeRates, cfg.SubscriptionUSDToCNYRate),
	)
	if err != nil {
		return 0, err
	}
	return payment.AmountToMinorUnit(payment.FormatAmountForCurrency(converted, currency), currency)
}

func stringSliceContains(values []string, expected string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), expected) {
			return true
		}
	}
	return false
}

func normalizeCreemTaxMode(value string) string {
	if strings.EqualFold(value, "inclusive") {
		return "inclusive"
	}
	return "exclusive"
}
