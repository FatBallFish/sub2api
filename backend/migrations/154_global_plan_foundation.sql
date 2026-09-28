-- Foundation fields for global user-level plans.
-- This migration keeps existing group subscription plans compatible by
-- defaulting all historical rows to plan_scope='group'.

ALTER TABLE subscription_plans
    ALTER COLUMN group_id DROP NOT NULL;

ALTER TABLE subscription_plans
    ADD COLUMN IF NOT EXISTS plan_scope VARCHAR(20) NOT NULL DEFAULT 'group',
    ADD COLUMN IF NOT EXISTS tier_rank INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quota_period VARCHAR(20) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS quota_per_period_usd DECIMAL(20,10) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_max_usd DECIMAL(20,10) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS speed_tier VARCHAR(30) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS support_tier VARCHAR(30) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS public_badge VARCHAR(50) NOT NULL DEFAULT '';

UPDATE subscription_plans
SET plan_scope = 'group'
WHERE plan_scope IS NULL OR plan_scope = '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'subscription_plans_plan_scope_check'
          AND conrelid = 'subscription_plans'::regclass
    ) THEN
        ALTER TABLE subscription_plans
            ADD CONSTRAINT subscription_plans_plan_scope_check
            CHECK (plan_scope IN ('group', 'global'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'subscription_plans_scope_group_check'
          AND conrelid = 'subscription_plans'::regclass
    ) THEN
        ALTER TABLE subscription_plans
            ADD CONSTRAINT subscription_plans_scope_group_check
            CHECK (
                (plan_scope = 'group' AND group_id IS NOT NULL)
                OR (plan_scope = 'global')
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscription_plans_scope_sale_sort
    ON subscription_plans(plan_scope, for_sale, sort_order);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_scope_tier
    ON subscription_plans(plan_scope, tier_rank);
