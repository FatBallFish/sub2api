-- Track how each usage log was funded after Global Plan quota allocation.

ALTER TABLE usage_logs
    ADD COLUMN IF NOT EXISTS funding_source VARCHAR(30) NOT NULL DEFAULT 'balance',
    ADD COLUMN IF NOT EXISTS global_plan_subscription_id BIGINT NULL REFERENCES user_global_plan_subscriptions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS global_plan_cost DECIMAL(20,10) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS balance_cost DECIMAL(20,10) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS group_subscription_cost DECIMAL(20,10) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'usage_logs_funding_source_check'
          AND conrelid = 'usage_logs'::regclass
    ) THEN
        ALTER TABLE usage_logs
            ADD CONSTRAINT usage_logs_funding_source_check
            CHECK (funding_source IN ('balance', 'subscription', 'global_plan', 'mixed', 'free'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usage_logs_funding_source_created_at
    ON usage_logs (funding_source, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_logs_global_plan_subscription_id
    ON usage_logs (global_plan_subscription_id)
    WHERE global_plan_subscription_id IS NOT NULL;
