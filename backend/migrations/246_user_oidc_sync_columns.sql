-- OIDC 账号同步（Keycloak）：触发式同步与密码漂移检测所需列
ALTER TABLE "users" ADD COLUMN "oidc_synced_at" timestamptz NULL;
ALTER TABLE "users" ADD COLUMN "oidc_password_cred_at" bigint NULL;
ALTER TABLE "users" ADD COLUMN "oidc_password_drift" boolean NOT NULL DEFAULT false;
