-- 密码归属标记：区分「用户/管理员主动设置的密码」与 OAuth 建号、drift 作废写入的随机占位哈希。
-- 为 true 时邮箱+密码是用户已知的独立登录方式，可据此放行解绑最后一个三方登录身份。
ALTER TABLE "users" ADD COLUMN "password_user_set" boolean NOT NULL DEFAULT false;

-- 存量回填：密码曾双写回 Keycloak 且未 drift 的账号（cred_at 有快照 = 密码经 sub2api 侧
-- 用户流程设置并与 Keycloak 一致），其本地密码均为用户已知；邮箱注册账号注册时自设密码，
-- 一并回填保持口径统一。处于 drift 的账号不回填（开启作废开关时本地密码已被随机哈希覆盖）。
UPDATE "users" SET "password_user_set" = true
WHERE "oidc_password_drift" = false
  AND ("oidc_password_cred_at" IS NOT NULL OR "signup_source" IN ('', 'email'));
