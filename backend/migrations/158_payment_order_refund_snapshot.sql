-- Store immutable refund calculation facts captured at order creation.
-- This keeps balance recharge refund conversion stable even if recharge
-- multipliers or fee rules change later.

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS refund_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
