package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/creemrefundevent"
	"github.com/Wei-Shaw/sub2api/ent/paymentorder"
	"github.com/Wei-Shaw/sub2api/internal/payment"
)

const (
	creemRefundStatusReceived   = "received"
	creemRefundStatusProcessing = "processing"
	creemRefundStatusApplied    = "applied"
	creemRefundStatusFailed     = "failed"
	creemRefundStatusIgnored    = "ignored"
)

func calculateCreemCumulativeRefundRatio(cumulative, gross int64, previous float64) (target, delta float64, err error) {
	if gross <= 0 || cumulative <= 0 {
		return 0, 0, fmt.Errorf("creem refund amount_paid and cumulative refunded amount must be positive")
	}
	target = math.Min(1, float64(cumulative)/float64(gross))
	previous = math.Max(0, math.Min(1, previous))
	delta = math.Max(0, target-previous)
	return target, delta, nil
}

// HandleCreemRefundCreated reconciles a refund that has already occurred in Creem.
// It deliberately does not inspect refund_enabled or allow_user_refund.
func (s *PaymentService) HandleCreemRefundCreated(ctx context.Context, n *payment.PaymentNotification) error {
	if n == nil || n.EventID == "" || n.RefundID == "" {
		return fmt.Errorf("invalid Creem refund notification")
	}
	instanceID, err := strconv.ParseInt(strings.TrimSpace(n.Metadata["provider_instance_id"]), 10, 64)
	if err != nil || instanceID <= 0 {
		return fmt.Errorf("creem refund missing verified provider instance")
	}
	order, orderErr := s.entClient.PaymentOrder.Query().Where(paymentorder.OutTradeNoEQ(n.OrderID)).Only(ctx)
	var orderID *int64
	if orderErr == nil {
		orderID = &order.ID
	}
	rawPayload := map[string]any{}
	_ = json.Unmarshal([]byte(n.RawData), &rawPayload)
	event, err := s.entClient.CreemRefundEvent.Create().
		SetEventID(n.EventID).SetProviderRefundID(n.RefundID).SetProviderInstanceID(instanceID).
		SetNillablePaymentOrderID(orderID).SetTransactionID(n.TradeNo).
		SetRefundAmountMinor(n.RefundAmountMinor).SetCumulativeRefundedMinor(n.CumulativeRefundedMinor).
		SetTransactionAmountPaidMinor(n.TransactionAmountPaidMinor).SetCurrency(strings.ToUpper(n.Metadata["currency"])).
		SetStatus(creemRefundStatusReceived).SetRawPayload(rawPayload).Save(ctx)
	if err != nil {
		event, err = s.entClient.CreemRefundEvent.Query().Where(creemrefundevent.EventIDEQ(n.EventID)).Only(ctx)
		if err != nil {
			event, err = s.entClient.CreemRefundEvent.Query().Where(creemrefundevent.ProviderRefundIDEQ(n.RefundID)).Only(ctx)
			if err != nil {
				return fmt.Errorf("persist Creem refund event: %w", err)
			}
		}
		if event.Status == creemRefundStatusApplied || event.Status == creemRefundStatusIgnored {
			return nil
		}
	}
	if orderErr != nil {
		_, _ = s.entClient.CreemRefundEvent.UpdateOneID(event.ID).SetStatus(creemRefundStatusIgnored).SetLastError("payment order not found").SetProcessedAt(time.Now()).Save(ctx)
		return fmt.Errorf("%w: out_trade_no=%s", ErrOrderNotFound, n.OrderID)
	}
	if err := validateProviderSnapshotMetadata(order, payment.TypeCreem, n.Metadata); err != nil {
		_, _ = s.entClient.CreemRefundEvent.UpdateOneID(event.ID).SetStatus(creemRefundStatusFailed).AddAttempts(1).SetLastError(err.Error()).Save(ctx)
		return err
	}
	if err := s.applyCreemRefund(ctx, event, order, instanceID); err != nil {
		_, _ = s.entClient.CreemRefundEvent.UpdateOneID(event.ID).SetStatus(creemRefundStatusFailed).AddAttempts(1).SetLastError(err.Error()).Save(ctx)
		return err
	}
	return nil
}

func (s *PaymentService) applyCreemRefund(ctx context.Context, event *dbent.CreemRefundEvent, order *dbent.PaymentOrder, instanceID int64) error {
	tx, err := s.entClient.Tx(ctx)
	if err != nil {
		return fmt.Errorf("begin creem refund transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	txCtx := dbent.NewTxContext(ctx, tx)
	txClient := tx.Client()
	order, err = lockCreemRefundOrder(txCtx, txClient, order.ID)
	if err != nil {
		return fmt.Errorf("lock creem refund order: %w", err)
	}
	event, err = txClient.CreemRefundEvent.Query().Where(creemrefundevent.IDEQ(event.ID)).Only(txCtx)
	if err != nil {
		return fmt.Errorf("lock creem refund event: %w", err)
	}
	if event.Status == creemRefundStatusApplied || event.Status == creemRefundStatusIgnored {
		return tx.Commit()
	}
	if order.ProviderKey == nil || *order.ProviderKey != payment.TypeCreem || order.ProviderInstanceID == nil || *order.ProviderInstanceID != strconv.FormatInt(instanceID, 10) {
		return fmt.Errorf("creem refund provider instance mismatch")
	}
	if order.PaymentTradeNo != event.TransactionID {
		return fmt.Errorf("creem refund transaction mismatch")
	}
	if !strings.EqualFold(PaymentOrderCurrency(order), event.Currency) {
		return fmt.Errorf("creem refund currency mismatch")
	}
	if order.Status != OrderStatusCompleted && order.Status != OrderStatusPartiallyRefunded && order.Status != OrderStatusRefunded {
		return fmt.Errorf("creem refund requires a completed order")
	}
	previousRatio := creemRefundSnapshotFloat(order.RefundSnapshot, "external_refund_ratio")
	targetRatio, deltaRatio, err := calculateCreemCumulativeRefundRatio(event.CumulativeRefundedMinor, event.TransactionAmountPaidMinor, previousRatio)
	if err != nil {
		return err
	}
	if deltaRatio == 0 {
		if _, err = txClient.CreemRefundEvent.UpdateOneID(event.ID).SetStatus(creemRefundStatusIgnored).SetRefundRatio(targetRatio).SetProcessedAt(time.Now()).Save(txCtx); err != nil {
			return err
		}
		return tx.Commit()
	}
	_, err = txClient.CreemRefundEvent.UpdateOneID(event.ID).SetStatus(creemRefundStatusProcessing).AddAttempts(1).Save(txCtx)
	if err != nil {
		return err
	}

	recoveredBalance := creemRefundSnapshotFloat(order.RefundSnapshot, "external_recovered_balance")
	recoveredDays := int(math.Round(creemRefundSnapshotFloat(order.RefundSnapshot, "external_recovered_days")))
	if order.OrderType == payment.OrderTypeBalance {
		targetRecovery := math.Round(order.Amount*targetRatio*100) / 100
		deltaRecovery := math.Max(0, targetRecovery-recoveredBalance)
		if deltaRecovery > 0 {
			if err := s.userRepo.DeductBalance(txCtx, order.UserID, deltaRecovery); err != nil {
				return fmt.Errorf("creem balance clawback: %w", err)
			}
			recoveredBalance = targetRecovery
		}
	} else {
		if order.SubscriptionDays == nil || *order.SubscriptionDays <= 0 {
			return fmt.Errorf("creem subscription refund missing contributed days")
		}
		targetDays := int(math.Ceil(float64(*order.SubscriptionDays) * targetRatio))
		deltaDays := targetDays - recoveredDays
		if deltaDays > 0 {
			plan := &RefundPlan{OrderID: order.ID, Order: order, SubDaysToDeduct: deltaDays, DeductBalance: true, DeductionType: payment.DeductionTypeSubscription}
			if early := s.prepDeduct(txCtx, order, plan, false); early != nil || plan.SubscriptionID <= 0 {
				return fmt.Errorf("creem subscription entitlement not found")
			}
			err := s.deductSubscriptionEntitlement(txCtx, plan, -deltaDays)
			if errors.Is(err, ErrAdjustWouldExpire) {
				err = s.revokeSubscriptionEntitlement(txCtx, plan)
			}
			if err != nil {
				return fmt.Errorf("creem subscription clawback: %w", err)
			}
			recoveredDays = targetDays
		}
	}

	snapshot := make(map[string]any, len(order.RefundSnapshot)+5)
	for key, value := range order.RefundSnapshot {
		snapshot[key] = value
	}
	snapshot["provider_amount_paid_minor"] = event.TransactionAmountPaidMinor
	snapshot["provider_cumulative_refunded_minor"] = event.CumulativeRefundedMinor
	snapshot["external_refund_ratio"] = targetRatio
	snapshot["external_recovered_balance"] = recoveredBalance
	snapshot["external_recovered_days"] = recoveredDays
	status := OrderStatusPartiallyRefunded
	if targetRatio >= 1 {
		status = OrderStatusRefunded
	}
	refundAmount := math.Round(order.Amount*targetRatio*100) / 100
	now := time.Now()
	if _, err := txClient.PaymentOrder.UpdateOneID(order.ID).SetStatus(status).SetRefundAmount(refundAmount).SetRefundReason("Creem Dashboard refund").SetRefundAt(now).SetRefundSnapshot(snapshot).Save(txCtx); err != nil {
		return err
	}
	recovery := map[string]any{"refund_ratio": targetRatio, "recovered_balance": recoveredBalance, "recovered_days": recoveredDays, "order_status": status}
	if _, err := txClient.CreemRefundEvent.UpdateOneID(event.ID).SetStatus(creemRefundStatusApplied).SetRefundRatio(targetRatio).SetRecoverySnapshot(recovery).SetLastError("").SetProcessedAt(now).Save(txCtx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit creem refund transaction: %w", err)
	}
	s.writeAuditLog(ctx, order.ID, fmt.Sprintf("CREEM_REFUND_CLAWBACK_%d", event.ID), payment.TypeCreem, recovery)
	return nil
}

func lockCreemRefundOrder(ctx context.Context, client *dbent.Client, orderID int64) (*dbent.PaymentOrder, error) {
	order, err := client.PaymentOrder.Query().Where(paymentorder.IDEQ(orderID)).ForUpdate().Only(ctx)
	if err != nil && strings.Contains(err.Error(), "FOR UPDATE/SHARE not supported in SQLite") {
		// SQLite serializes writes at the database level and is used only by unit tests.
		return client.PaymentOrder.Query().Where(paymentorder.IDEQ(orderID)).Only(ctx)
	}
	return order, err
}

func creemRefundSnapshotFloat(snapshot map[string]any, key string) float64 {
	if snapshot == nil {
		return 0
	}
	switch value := snapshot[key].(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case json.Number:
		result, _ := value.Float64()
		return result
	case string:
		result, _ := strconv.ParseFloat(value, 64)
		return result
	default:
		return 0
	}
}
