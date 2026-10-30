-- 邀请绑定历史表：user_affiliates.inviter_id 仍表示“当前生效绑定”（现有记账/查询零改动），
-- 本表记录每一次绑定/变更/解除，保证解除或强制变更后历史邀请记录依旧可查。
CREATE TABLE IF NOT EXISTS user_affiliate_bindings (
    id BIGSERIAL PRIMARY KEY,
    invitee_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    inviter_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unbound_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_affiliate_bindings_invitee
    ON user_affiliate_bindings(invitee_user_id, unbound_at);
CREATE INDEX IF NOT EXISTS idx_user_affiliate_bindings_inviter
    ON user_affiliate_bindings(inviter_user_id, unbound_at);

-- 回填：现有生效绑定生成历史行。invited_at 取 profile 创建时间（≈注册时间），
-- 与原返利窗口（注册时间 + 返利天数）完全一致，存量行为不变。
INSERT INTO user_affiliate_bindings (invitee_user_id, inviter_user_id, invited_at, created_at)
SELECT ua.user_id, ua.inviter_id, ua.created_at, ua.created_at
FROM user_affiliates ua
WHERE ua.inviter_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_affiliate_bindings b WHERE b.invitee_user_id = ua.user_id
  );

COMMENT ON TABLE user_affiliate_bindings IS '邀请绑定历史：每行一段邀请关系（生效中 unbound_at IS NULL，已解除则记录解除时间）';
COMMENT ON COLUMN user_affiliate_bindings.invited_at IS '邀请时间（返利有效期按此 + 返利天数推算）';
