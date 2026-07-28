-- Add global plan category and group applicability scope.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS plan_category VARCHAR(64) NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS applicable_group_mode VARCHAR(20) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS applicable_group_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE user_global_plan_subscriptions
  ADD COLUMN IF NOT EXISTS plan_category VARCHAR(64) NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS applicable_group_mode VARCHAR(20) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS applicable_group_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE subscription_plans
SET plan_category = 'default'
WHERE plan_category IS NULL OR btrim(plan_category) = '';

UPDATE subscription_plans
SET applicable_group_mode = 'all'
WHERE applicable_group_mode IS NULL OR applicable_group_mode NOT IN ('all', 'whitelist', 'blacklist');

UPDATE subscription_plans
SET applicable_group_ids = '[]'::jsonb
WHERE applicable_group_ids IS NULL OR jsonb_typeof(applicable_group_ids) <> 'array';

UPDATE user_global_plan_subscriptions
SET plan_category = 'default'
WHERE plan_category IS NULL OR btrim(plan_category) = '';

UPDATE user_global_plan_subscriptions s
SET
  plan_category = COALESCE(NULLIF(btrim(p.plan_category), ''), 'default'),
  applicable_group_mode = COALESCE(NULLIF(p.applicable_group_mode, ''), 'all'),
  applicable_group_ids = COALESCE(p.applicable_group_ids, '[]'::jsonb)
FROM subscription_plans p
WHERE s.plan_id = p.id
  AND s.deleted_at IS NULL
  AND (
    s.plan_category = 'default'
    OR s.applicable_group_mode = 'all'
    OR s.applicable_group_ids = '[]'::jsonb
  );

UPDATE user_global_plan_subscriptions
SET applicable_group_mode = 'all'
WHERE applicable_group_mode IS NULL OR applicable_group_mode NOT IN ('all', 'whitelist', 'blacklist');

UPDATE user_global_plan_subscriptions
SET applicable_group_ids = '[]'::jsonb
WHERE applicable_group_ids IS NULL OR jsonb_typeof(applicable_group_ids) <> 'array';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_global_plan_subscriptions_period_check'
      AND conrelid = 'user_global_plan_subscriptions'::regclass
  ) THEN
    ALTER TABLE user_global_plan_subscriptions
      DROP CONSTRAINT user_global_plan_subscriptions_period_check;
  END IF;

  ALTER TABLE user_global_plan_subscriptions
    ADD CONSTRAINT user_global_plan_subscriptions_period_check
    CHECK (quota_period IN ('day', 'week', 'month'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_applicable_group_mode_check'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_applicable_group_mode_check
      CHECK (applicable_group_mode IN ('all', 'whitelist', 'blacklist'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_global_plan_subscriptions_applicable_group_mode_check'
  ) THEN
    ALTER TABLE user_global_plan_subscriptions
      ADD CONSTRAINT user_global_plan_subscriptions_applicable_group_mode_check
      CHECK (applicable_group_mode IN ('all', 'whitelist', 'blacklist'));
  END IF;
END $$;

DROP INDEX IF EXISTS uk_user_global_plan_subscriptions_active;

CREATE UNIQUE INDEX IF NOT EXISTS uk_user_global_plan_subscriptions_active_category
  ON user_global_plan_subscriptions(user_id, plan_category)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_subscription_plans_scope_category_tier
  ON subscription_plans(plan_scope, plan_category, tier_rank);

CREATE INDEX IF NOT EXISTS idx_user_global_plan_user_category_status
  ON user_global_plan_subscriptions(user_id, plan_category, status)
  WHERE deleted_at IS NULL;
