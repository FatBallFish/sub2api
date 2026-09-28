CREATE TABLE IF NOT EXISTS creem_product_bindings (
    id BIGSERIAL PRIMARY KEY,
    provider_instance_id BIGINT NOT NULL REFERENCES payment_provider_instances(id) ON DELETE CASCADE,
    external_product_id VARCHAR(128) NOT NULL,
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('balance', 'group_plan', 'global_plan')),
    plan_id BIGINT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
    credited_balance DECIMAL(20,2) NULL,
    product_name VARCHAR(255) NOT NULL DEFAULT '',
    price_minor BIGINT NOT NULL CHECK (price_minor > 0),
    currency VARCHAR(3) NOT NULL,
    billing_type VARCHAR(20) NOT NULL DEFAULT 'onetime' CHECK (billing_type = 'onetime'),
    product_status VARCHAR(20) NOT NULL DEFAULT 'active',
    tax_mode VARCHAR(20) NOT NULL DEFAULT 'exclusive',
    environment VARCHAR(10) NOT NULL CHECK (environment IN ('test', 'prod')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    health_status VARCHAR(20) NOT NULL DEFAULT 'healthy',
    health_reason TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT creem_binding_target_values CHECK (
        (target_type = 'balance' AND plan_id IS NULL AND credited_balance IS NOT NULL AND credited_balance > 0)
        OR (target_type IN ('group_plan', 'global_plan') AND plan_id IS NOT NULL AND credited_balance IS NULL)
    ),
    CONSTRAINT creem_binding_instance_product_unique UNIQUE (provider_instance_id, external_product_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS creem_binding_instance_plan_unique
    ON creem_product_bindings(provider_instance_id, target_type, plan_id)
    WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS creem_binding_target_idx
    ON creem_product_bindings(target_type, plan_id, enabled);
CREATE INDEX IF NOT EXISTS creem_binding_instance_idx
    ON creem_product_bindings(provider_instance_id, enabled);

CREATE TABLE IF NOT EXISTS creem_refund_events (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(128) NOT NULL UNIQUE,
    provider_refund_id VARCHAR(128) NOT NULL UNIQUE,
    provider_instance_id BIGINT NOT NULL REFERENCES payment_provider_instances(id) ON DELETE RESTRICT,
    payment_order_id BIGINT NULL REFERENCES payment_orders(id) ON DELETE SET NULL,
    transaction_id VARCHAR(128) NOT NULL,
    refund_amount_minor BIGINT NOT NULL CHECK (refund_amount_minor > 0),
    cumulative_refunded_minor BIGINT NOT NULL CHECK (cumulative_refunded_minor > 0),
    transaction_amount_paid_minor BIGINT NOT NULL CHECK (transaction_amount_paid_minor > 0),
    currency VARCHAR(3) NOT NULL,
    refund_ratio DECIMAL(12,10) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'received',
    recovery_snapshot JSONB NULL,
    raw_payload JSONB NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS creem_refund_order_idx ON creem_refund_events(payment_order_id);
CREATE INDEX IF NOT EXISTS creem_refund_instance_status_idx ON creem_refund_events(provider_instance_id, status);
CREATE INDEX IF NOT EXISTS creem_refund_transaction_idx ON creem_refund_events(transaction_id);
CREATE INDEX IF NOT EXISTS creem_refund_status_created_idx ON creem_refund_events(status, created_at);
