//go:build unit

package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/Wei-Shaw/sub2api/internal/payment/provider"
	"github.com/stretchr/testify/require"
)

type txAwareCreemRefundUserRepo struct{ *paymentOrderUserRepoStub }

func (r *txAwareCreemRefundUserRepo) DeductBalance(ctx context.Context, userID int64, amount float64) error {
	tx := dbent.TxFromContext(ctx)
	if tx == nil {
		return errors.New("creem refund balance deduction must run in a transaction")
	}
	_, err := tx.Client().User.UpdateOneID(userID).AddBalance(-amount).Save(ctx)
	return err
}

type creemProductClientStub struct{ product *provider.CreemProduct }

func (s creemProductClientStub) GetProduct(context.Context, string) (*provider.CreemProduct, error) {
	return s.product, nil
}
func (s creemProductClientStub) MerchantIdentityMetadata() map[string]string {
	return map[string]string{"environment": "test"}
}

func TestValidateCreemBindingTarget(t *testing.T) {
	balance := 25.0
	planID := int64(8)
	require.NoError(t, validateCreemBindingTarget(CreemBindingTargetBalance, nil, &balance))
	require.Error(t, validateCreemBindingTarget(CreemBindingTargetBalance, &planID, &balance))
	require.NoError(t, validateCreemBindingTarget(CreemBindingTargetGroupPlan, &planID, nil))
	require.NoError(t, validateCreemBindingTarget(CreemBindingTargetGlobalPlan, &planID, nil))
	require.Error(t, validateCreemBindingTarget(CreemBindingTargetGroupPlan, nil, nil))
	require.Error(t, validateCreemBindingTarget("recurring", &planID, nil))
}

func TestCreateCreemBindingEnforcesOneTimeActiveProduct(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)
	svc := NewPaymentConfigService(client, &paymentConfigSettingRepoStub{values: map[string]string{SettingEnabledPaymentTypes: payment.TypeCreem}}, nil)
	instance := client.PaymentProviderInstance.Create().SetProviderKey(payment.TypeCreem).SetName("Creem").SetConfig(`{"apiKey":"key","webhookSecret":"secret","environment":"test"}`).SetSupportedTypes(payment.TypeCreem).SetEnabled(true).SaveX(ctx)
	balance := 25.0
	originalFactory := createCreemProductClient
	t.Cleanup(func() { createCreemProductClient = originalFactory })

	product := &provider.CreemProduct{ID: "prod_1", Name: "Credits", PriceMinor: 2000, Currency: "USD", BillingType: "recurring", Status: "active"}
	createCreemProductClient = func(string, map[string]string) (creemProductClient, error) {
		return creemProductClientStub{product}, nil
	}
	_, err := svc.CreateCreemBinding(ctx, instance.ID, CreateCreemBindingRequest{ProductID: product.ID, TargetType: CreemBindingTargetBalance, CreditedBalance: &balance, Enabled: true})
	require.ErrorContains(t, err, "onetime")

	product.BillingType = "onetime"
	product.Status = "archived"
	_, err = svc.CreateCreemBinding(ctx, instance.ID, CreateCreemBindingRequest{ProductID: product.ID, TargetType: CreemBindingTargetBalance, CreditedBalance: &balance, Enabled: true})
	require.ErrorContains(t, err, "not active")

	product.Status = "active"
	binding, err := svc.CreateCreemBinding(ctx, instance.ID, CreateCreemBindingRequest{ProductID: product.ID, TargetType: CreemBindingTargetBalance, CreditedBalance: &balance, Enabled: true})
	require.NoError(t, err)
	require.Equal(t, "onetime", binding.BillingType)
	require.Equal(t, int64(2000), binding.PriceMinor)
}

func TestListCreemFixedOffersRequiresGlobalEnablement(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)
	repo := &paymentConfigSettingRepoStub{values: map[string]string{SettingEnabledPaymentTypes: "stripe"}}
	svc := NewPaymentConfigService(client, repo, nil)
	instance := client.PaymentProviderInstance.Create().SetProviderKey(payment.TypeCreem).SetName("Creem").SetConfig(`{"apiKey":"key","webhookSecret":"secret","environment":"test"}`).SetSupportedTypes(payment.TypeCreem).SetEnabled(true).SaveX(ctx)
	balance := 25.0
	client.CreemProductBinding.Create().SetProviderInstanceID(instance.ID).SetExternalProductID("prod_offer").SetTargetType(CreemBindingTargetBalance).SetCreditedBalance(balance).SetProductName("Starter").SetPriceMinor(2000).SetCurrency("USD").SetBillingType("onetime").SetProductStatus("active").SetTaxMode("exclusive").SetEnvironment("test").SetEnabled(true).SetHealthStatus(CreemBindingHealthHealthy).SaveX(ctx)

	offers, err := svc.ListCreemFixedOffers(ctx)
	require.NoError(t, err)
	require.Empty(t, offers)

	repo.values[SettingEnabledPaymentTypes] = payment.TypeCreem
	offers, err = svc.ListCreemFixedOffers(ctx)
	require.NoError(t, err)
	require.Len(t, offers, 1)
	require.Equal(t, balance, *offers[0].CreditedAmount)
}

func TestApplyCreemOfferToOrderRequestRejectsTampering(t *testing.T) {
	balance := 25.0
	binding := &dbent.CreemProductBinding{ID: 7, TargetType: CreemBindingTargetBalance, CreditedBalance: &balance, ExternalProductID: "prod_7", Currency: "USD"}
	req := CreateOrderRequest{Amount: 30, PaymentType: payment.TypeCreem, OrderType: payment.OrderTypeBalance, OfferID: 7}
	require.ErrorContains(t, applyCreemOfferToOrderRequest(&req, binding), "fixed offer amount")

	req.Amount = 25
	require.NoError(t, applyCreemOfferToOrderRequest(&req, binding))
	require.Equal(t, "prod_7", req.CreemProductID)

	planID := int64(9)
	planBinding := &dbent.CreemProductBinding{ID: 8, TargetType: CreemBindingTargetGlobalPlan, PlanID: &planID, ExternalProductID: "prod_8", Currency: "USD"}
	req = CreateOrderRequest{PaymentType: payment.TypeCreem, OrderType: payment.OrderTypeGlobalPlanUpgrade, PlanID: planID, OfferID: 8}
	require.ErrorContains(t, applyCreemOfferToOrderRequest(&req, planBinding), "does not support global plan upgrades")
}

func TestCalculateCreemCumulativeRefundRatio(t *testing.T) {
	target, delta, err := calculateCreemCumulativeRefundRatio(1210, 2420, 0)
	require.NoError(t, err)
	require.InDelta(t, 0.5, target, 0.0000001)
	require.InDelta(t, 0.5, delta, 0.0000001)

	_, delta, err = calculateCreemCumulativeRefundRatio(1210, 2420, 0.75)
	require.NoError(t, err)
	require.Zero(t, delta)

	target, delta, err = calculateCreemCumulativeRefundRatio(3000, 2420, 0.5)
	require.NoError(t, err)
	require.Equal(t, 1.0, target)
	require.Equal(t, 0.5, delta)
}

func TestValidateCreemProviderSnapshotMetadata(t *testing.T) {
	order := &dbent.PaymentOrder{ProviderSnapshot: map[string]any{
		"schema_version": 3, "provider_key": payment.TypeCreem, "provider_instance_id": "9",
		"creem_product_id": "prod_123", "currency": "USD",
	}}
	valid := map[string]string{"provider_instance_id": "9", "product_id": "prod_123", "currency": "USD"}
	require.NoError(t, validateProviderSnapshotMetadata(order, payment.TypeCreem, valid))

	wrongProduct := map[string]string{"provider_instance_id": "9", "product_id": "prod_other", "currency": "USD"}
	require.ErrorContains(t, validateProviderSnapshotMetadata(order, payment.TypeCreem, wrongProduct), "product mismatch")
}

func TestHandleCreemRefundCreatedClawsBackBalanceIdempotently(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)
	user := client.User.Create().SetEmail("creem-refund@example.com").SetPasswordHash("hash").SetUsername("creem-refund").SetBalance(10).SaveX(ctx)
	instance := client.PaymentProviderInstance.Create().SetProviderKey(payment.TypeCreem).SetName("Creem").SetConfig(`{"apiKey":"key","webhookSecret":"secret","environment":"test"}`).SetSupportedTypes(payment.TypeCreem).SetEnabled(true).SetRefundEnabled(false).SetAllowUserRefund(false).SaveX(ctx)
	instanceID := fmt.Sprintf("%d", instance.ID)
	providerKey := payment.TypeCreem
	order := client.PaymentOrder.Create().SetUserID(user.ID).SetUserEmail(user.Email).SetUserName(user.Username).
		SetAmount(100).SetPayAmount(20).SetFeeRate(0).SetRechargeCode("CREEM-REFUND").SetOutTradeNo("sub2_creem_refund").
		SetPaymentType(payment.TypeCreem).SetPaymentTradeNo("tran_123").SetOrderType(payment.OrderTypeBalance).SetStatus(OrderStatusCompleted).
		SetProviderInstanceID(instanceID).SetProviderKey(providerKey).SetProviderSnapshot(map[string]any{"schema_version": 3, "provider_instance_id": instanceID, "provider_key": payment.TypeCreem, "currency": "USD", "creem_product_id": "prod_123"}).
		SetExpiresAt(time.Now().Add(time.Hour)).SetPaidAt(time.Now()).SetCompletedAt(time.Now()).SetClientIP("127.0.0.1").SetSrcHost("api.example.com").SaveX(ctx)
	repo := &paymentOrderUserRepoStub{user: &User{ID: user.ID, Balance: 10}}
	svc := &PaymentService{entClient: client, userRepo: repo}

	notification := func(eventID, refundID string, cumulative int64) *payment.PaymentNotification {
		return &payment.PaymentNotification{Type: payment.NotificationTypeRefund, EventID: eventID, RefundID: refundID, OrderID: order.OutTradeNo, TradeNo: "tran_123", Status: payment.NotificationStatusSuccess, RefundAmountMinor: 1000, CumulativeRefundedMinor: cumulative, TransactionAmountPaidMinor: 2000, RawData: `{}`, Metadata: map[string]string{"provider_instance_id": instanceID, "product_id": "prod_123", "currency": "USD"}}
	}
	require.NoError(t, svc.HandleCreemRefundCreated(ctx, notification("evt_1", "ref_1", 1000)))
	require.Equal(t, 50.0, repo.deducted)
	require.Equal(t, OrderStatusPartiallyRefunded, client.PaymentOrder.GetX(ctx, order.ID).Status)

	require.NoError(t, svc.HandleCreemRefundCreated(ctx, notification("evt_1", "ref_1", 1000)))
	require.Equal(t, 50.0, repo.deducted)

	require.NoError(t, svc.HandleCreemRefundCreated(ctx, notification("evt_2", "ref_2", 2000)))
	require.Equal(t, 100.0, repo.deducted)
	stored := client.PaymentOrder.GetX(ctx, order.ID)
	require.Equal(t, OrderStatusRefunded, stored.Status)
	require.Equal(t, 100.0, stored.RefundAmount)
}

func TestHandleCreemRefundCreatedRollsBackEntitlementWhenOrderUpdateFails(t *testing.T) {
	ctx := context.Background()
	client := newPaymentConfigServiceTestClient(t)
	user := client.User.Create().SetEmail("creem-refund-rollback@example.com").SetPasswordHash("hash").SetUsername("creem-refund-rollback").SetBalance(100).SaveX(ctx)
	instance := client.PaymentProviderInstance.Create().SetProviderKey(payment.TypeCreem).SetName("Creem").SetConfig(`{"apiKey":"key","webhookSecret":"secret","environment":"test"}`).SetSupportedTypes(payment.TypeCreem).SetEnabled(true).SaveX(ctx)
	instanceID := fmt.Sprintf("%d", instance.ID)
	providerKey := payment.TypeCreem
	order := client.PaymentOrder.Create().SetUserID(user.ID).SetUserEmail(user.Email).SetUserName(user.Username).
		SetAmount(100).SetPayAmount(20).SetFeeRate(0).SetRechargeCode("CREEM-ROLLBACK").SetOutTradeNo("sub2_creem_rollback").
		SetPaymentType(payment.TypeCreem).SetPaymentTradeNo("tran_rollback").SetOrderType(payment.OrderTypeBalance).SetStatus(OrderStatusCompleted).
		SetProviderInstanceID(instanceID).SetProviderKey(providerKey).SetProviderSnapshot(map[string]any{"schema_version": 3, "provider_instance_id": instanceID, "provider_key": payment.TypeCreem, "currency": "USD", "creem_product_id": "prod_rollback"}).
		SetExpiresAt(time.Now().Add(time.Hour)).SetPaidAt(time.Now()).SetCompletedAt(time.Now()).SetClientIP("127.0.0.1").SetSrcHost("api.example.com").SaveX(ctx)

	client.Use(func(next dbent.Mutator) dbent.Mutator {
		return dbent.MutateFunc(func(ctx context.Context, mutation dbent.Mutation) (dbent.Value, error) {
			if orderMutation, ok := mutation.(*dbent.PaymentOrderMutation); ok {
				if status, exists := orderMutation.Status(); exists && status == OrderStatusPartiallyRefunded {
					return nil, errors.New("forced order update failure")
				}
			}
			return next.Mutate(ctx, mutation)
		})
	})
	repo := &txAwareCreemRefundUserRepo{paymentOrderUserRepoStub: &paymentOrderUserRepoStub{user: &User{ID: user.ID, Balance: 100}}}
	svc := &PaymentService{entClient: client, userRepo: repo}
	notification := &payment.PaymentNotification{
		Type: payment.NotificationTypeRefund, EventID: "evt_rollback", RefundID: "ref_rollback", OrderID: order.OutTradeNo,
		TradeNo: "tran_rollback", Status: payment.NotificationStatusSuccess, RefundAmountMinor: 1000,
		CumulativeRefundedMinor: 1000, TransactionAmountPaidMinor: 2000, RawData: `{}`,
		Metadata: map[string]string{"provider_instance_id": instanceID, "product_id": "prod_rollback", "currency": "USD"},
	}

	err := svc.HandleCreemRefundCreated(ctx, notification)
	require.ErrorContains(t, err, "forced order update failure")
	require.Equal(t, 100.0, client.User.GetX(ctx, user.ID).Balance)
	require.Equal(t, OrderStatusCompleted, client.PaymentOrder.GetX(ctx, order.ID).Status)
}
