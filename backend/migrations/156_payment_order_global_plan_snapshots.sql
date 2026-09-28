-- Snapshot fields for global plan orders and upgrade orders.
-- Snapshots protect historical orders from later plan catalog edits.

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS plan_scope VARCHAR(20) NULL,
    ADD COLUMN IF NOT EXISTS plan_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS global_plan_subscription_id BIGINT NULL REFERENCES user_global_plan_subscriptions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS upgrade_from_subscription_id BIGINT NULL REFERENCES user_global_plan_subscriptions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS upgrade_proration JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_payment_orders_plan_scope
    ON payment_orders(plan_scope);

CREATE INDEX IF NOT EXISTS idx_payment_orders_global_plan_subscription_id
    ON payment_orders(global_plan_subscription_id)
    WHERE global_plan_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_upgrade_from_subscription_id
    ON payment_orders(upgrade_from_subscription_id)
    WHERE upgrade_from_subscription_id IS NOT NULL;
