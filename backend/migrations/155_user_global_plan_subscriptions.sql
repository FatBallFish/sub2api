-- User-level global plan entitlements.
-- This table stores runtime quota windows separately from subscription_plans,
-- which remains a product/catalog table.

CREATE TABLE IF NOT EXISTS user_global_plan_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id BIGINT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    quota_period VARCHAR(20) NOT NULL DEFAULT 'week',
    quota_limit_usd DECIMAL(20,10) NOT NULL DEFAULT 0,
    quota_used_usd DECIMAL(20,10) NOT NULL DEFAULT 0,
    tier_rank INT NOT NULL DEFAULT 0,
    plan_name_snapshot VARCHAR(100) NOT NULL DEFAULT '',
    source_order_id BIGINT NULL REFERENCES payment_orders(id) ON DELETE SET NULL,
    assigned_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT NULL,
    last_reset_at TIMESTAMPTZ NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_global_plan_subscriptions_status_check'
          AND conrelid = 'user_global_plan_subscriptions'::regclass
    ) THEN
        ALTER TABLE user_global_plan_subscriptions
            ADD CONSTRAINT user_global_plan_subscriptions_status_check
            CHECK (status IN ('active', 'expired', 'cancelled'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_global_plan_subscriptions_period_check'
          AND conrelid = 'user_global_plan_subscriptions'::regclass
    ) THEN
        ALTER TABLE user_global_plan_subscriptions
            ADD CONSTRAINT user_global_plan_subscriptions_period_check
            CHECK (quota_period IN ('week', 'month'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uk_user_global_plan_subscriptions_active
    ON user_global_plan_subscriptions(user_id)
    WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_global_plan_subscriptions_user_status_expires
    ON user_global_plan_subscriptions(user_id, status, expires_at)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_global_plan_subscriptions_period_end
    ON user_global_plan_subscriptions(current_period_end)
    WHERE deleted_at IS NULL AND status = 'active';
