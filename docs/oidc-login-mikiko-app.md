# Mikiko APP 对接平台 OIDC 登录（临时方案文档）

> 状态：临时方案（待评审 / 实施中会更新） · 2026-10-19
> 适用：Mikiko APP（原生客户端）从账密登录 API 切换/并行到平台 OIDC 授权登录。
> 关联文档：`docs/silent-sso-mikiko-id.md`（Web 侧门户免登，同源 Cookie 前提相同）。

## 1. 背景与目标

Mikiko APP 目前通过平台账密接口对接登录体系：

- `POST /api/v1/auth/login`（账密 + 可选验证码，返回 `{access_token, refresh_token, expires_in, user}`）
- `POST /api/v1/auth/refresh`（刷新 token pair）
- 后续请求带 `Authorization: Bearer <access_token>`

平台引入 Keycloak（Mikiko ID）OIDC 登录后，APP 需要：**用 OIDC 完成授权，最终仍拿到平台自身的 token pair**，从而复用现有全部业务 API，无需改造。

既定接入思路（本文围绕它展开）：

1. APP 在 **同一 Keycloak realm** 下使用 **独立的 Client**（与 Web 控制台用的 client 不同）；
2. 利用 **同域 Cookie**（realm SSO 会话）让 APP 免密复用用户在其他 Client（门户/控制台）已建立的登录会话；
3. 通过平台的 **token 信任转移接口**，把 OIDC 身份换取为平台自身的 access/refresh token。

## 2. 总体流程

```
Mikiko APP              系统浏览器(ASWebAuthenticationSession / Custom Tabs)      Keycloak                    sub2api 后端
  │                                        │                                     │                             │
  │ 1. 生成 state + PKCE(verifier/challenge) + nonce                             │                             │
  │ 2. 打开 authorize?client_id=<app-client>&prompt=none&scope=openid email profile  │                           │
  │───────────────────────────────────────▶│─────────────────────────────────────▶│                             │
  │                                        │        有 realm SSO Cookie？（同域）   │                             │
  │◀─ 302 code（静默，用户无感）────────────│◀──────────────── 是 ─────────────────│                             │
  │◀─ error=login_required ────────────────│◀──────────────── 否 ─────────────────│                             │
  │     → 回退交互式登录（用户在浏览器内完成 Mikiko ID 登录）                          │                             │
  │ 3. 本地用 code + verifier 调 Keycloak token 端点（PKCE 交换）                     │                             │
  │◀─── id_token + access_token ───────────│─────────────────────────────────────▶│                             │
  │ 4. POST /api/v1/auth/oauth/oidc/token-exchange { id_token }                    │                             │
  │───────────────────────────────────────────────────────────────────────────────▶│ 校验签名/issuer/aud → 签发    │
  │◀─── { access_token, refresh_token, expires_in, token_type } ───────────────────│────────── 平台 token pair ───│
  │ 5. 之后所有业务 API 带 Bearer access_token，与账密登录完全一致                       │                             │
```

要点：

- **realm SSO Cookie 与 Client 无关**。它在 Keycloak 域上（`KEYCLOAK_IDENTITY` 等），同 realm、同 host 下任意 Client 发起的授权都能复用——这就是「用其他 Client 的 Session」在协议层的落点（`prompt=none` 静默授权）。
- **「同源」的前提是同一个 Keycloak host**：门户、控制台、APP 的授权请求必须解析到同一个 Keycloak 域名，否则 Cookie 不生效（与 Web 侧 silent SSO 的要求一致）。
- APP 最终持有的是 **sub2api 平台签发的 JWT**，与 Keycloak 会话相互独立（见 §8）。

## 3. 关键前提与约束

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Realm | 与平台同 realm | 平台身份按 `issuer + sub` 建立绑定 |
| Keycloak host | 三端（门户/控制台/APP 授权页）同一 host | realm SSO Cookie 不跨 host/域名 |
| APP Client 类型 | Public + PKCE（S256） | 原生 app 无法安全保存 client_secret |
| scope | `openid email profile` | `email_verified=true` 是自动建号/绑定的硬前提 |
| 浏览器上下文 | iOS 用 `ASWebAuthenticationSession`；Android 用 Custom Tabs | 两者共享系统浏览器 Cookie；**内嵌 WebView 不共享**，静默登录会失效 |
| 回调 | 深链 / Universal Links，精确匹配注册在 Keycloak | 不得用通配 |

## 4. 平台现有接口（APP 直接可用）

### 4.1 信任转移：`POST /api/v1/auth/oauth/oidc/token-exchange`

专为 Mikiko APP 这类原生客户端设计：APP 本地完成 PKCE 授权码交换后，只把 `id_token` 交给平台做信任转移。

- 限流：20 次/分钟/IP（fail-close）
- 请求：`{"id_token": "<Keycloak 签发的 id_token>"}`
- 响应（**裸 JSON，无 `{success,data}` 包装**，APP 解析时注意）：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

平台侧校验与行为：

1. **强制验签**：即使后台未开启 `validate_id_token`，此接口也会拉 JWKS 验证签名（`validate_id_token` 未配置 jwks 时自动走 discovery `{issuer}/.well-known/openid-configuration` 补齐 jwks_uri）；
2. **受众校验**：id_token 的 `azp`（缺省取 `aud[0]`）必须等于平台管理后台 **主 OIDC Provider 配置**（`GetOIDCConnectOAuthConfig`，注意不是 console 那份配置）里的 `client_id` —— 这是当前对「独立 Client」方案的最大限制，见 §6；
3. 按 `(provider=oidc, issuer, sub)` 查身份绑定：命中且用户激活 → 直接签发平台 token pair；
4. 未命中：要求 id_token 携带**已验证邮箱**（`email_verified=true`），按邮箱自动**注册新账号或绑定到已有同邮箱账号**（无 Web 端的 choice 确认 UI，信任假设：realm 内邮箱由 Mikiko ID 统一管理且已验证）；
5. 同一身份的邮箱与已绑定账号不一致 → `AUTH_IDENTITY_EMAIL_MISMATCH` 冲突；
6. 用户被禁用 → `USER_NOT_ACTIVE`；后端运行模式不允许该用户 → 对应 `login_blocked` 类错误；
7. 登录成功后会异步触发 OIDC drift 检测（Keycloak 侧改密会使平台本地密码失效，属预期行为）。

主要错误码：

| 错误码 | 场景 | APP 处理 |
| --- | --- | --- |
| `OAUTH_ID_TOKEN_INVALID` | 验签失败 / **audience mismatch（独立 Client 未获平台允许）** | 检查 client 配置；见 §6 |
| `OAUTH_EMAIL_NOT_VERIFIED` | 新身份且邮箱未验证 | 引导先在 Web/浏览器完成首次登录 |
| `USER_NOT_ACTIVE` | 账号被禁用 | 提示联系客服 |

### 4.2 刷新：`POST /api/v1/auth/refresh`

- 限流 30 次/分钟；请求 `{"refresh_token": "..."}`；响应同样是裸 JSON token pair（旧 refresh token 轮换，注意覆盖存储）。
- 与账密登录的会话完全同构，APP 现有刷新逻辑可直接复用。

### 4.3 登出：`POST /api/v1/auth/logout`

撤销平台 refresh token。是否同时登出 Keycloak realm 会话见 §8。

## 5. 阶段一：复用平台已配置的 Client（今天即可跑通）

平台 token-exchange 的受众校验指向平台已配置的那个 Client。因此最快路径是：**APP 直接使用该 Client 发起 OIDC**，id_token 天然通过校验，平台零改动。

Keycloak 侧调整：

1. 给该 Client 的 Redirect URI 增加 APP 回调（Universal Links / App Link + 自定义 scheme 二选一，推荐前者）；
2. 将 Client 设为 **Public + Standard Flow + PKCE Required(S256)**；若该 Client 当前是 Confidential（后端持有 secret 做 Web 回调交换），**不建议**为 APP 降低其安全属性——直接走 §6 阶段二。

适合作为过渡验证；正式形态建议进入阶段二。

## 6. 阶段二（目标形态）：APP 独立 Client + 平台 allowlist 扩展

### 6.1 平台需要的改动（✅ 已实现，见 `oidc_connect_token_exchange_allowed_clients`）

现状（实现前）：token-exchange 硬校验 `azp/aud == 平台主 OIDC Provider 的 client_id`，APP 独立 Client 的 id_token 会被拒（`OAUTH_ID_TOKEN_INVALID: id_token audience mismatch`）。

已落地的扩展：

- 设置键 `oidc_connect_token_exchange_allowed_clients`（逗号分隔 client_id 列表，仅管理员可改；
  管理后台「OIDC 设置」新增输入框，亦支持 config.yaml `oidc.token_exchange_allowed_clients` 兜底）；
- token-exchange 受众校验放宽为：`azp/aud ∈ {主 client_id} ∪ allowed_clients`
  （实现在 `oidcParseAndValidateIDTokenWithAudiences` + `oidcTokenExchangeClientAllowed`，
  JWT 解析层的库级 aud 校验同样按集合放行）；
- **不变的部分**：issuer 一致性、JWKS 强制验签、sub/email 校验逻辑全部保持；
  allowlist 为空（默认）时行为与历史版本完全一致。

安全边界说明（为什么是 allowlist 而不是「同 realm 即信任」）：id_token 是自包含断言，同 realm 下任何 Client 都能拿到用户 id_token；若无条件信任，任一恶意/被攻陷的 Client 都能替用户换取平台会话。allowlist 把信任收敛到管理员显式登记的 Client。

### 6.2 APP Client 在 Keycloak 的推荐配置

| 配置 | 值 |
| --- | --- |
| Client Type | OpenID Connect / Public（无 secret） |
| Authentication Flow | 仅 Standard Flow；关闭 Implicit |
| PKCE | 强制 S256（Keycloak: Advanced → Proof Key for Code Exchange） |
| Valid Redirect URIs | 精确深链，如 `https://app.mikiko.ai/oidc/callback`（禁通配） |
| Scope | 默认 scope 含 `openid email profile`；`email` claim 必须带 `email_verified` |

## 7. APP 端授权流程细节

1. **会话与加密材料**：每次授权生成 `state`（防 CSRF，回调必须精确匹配）+ PKCE `code_verifier/challenge(S256)` + `nonce`（传入 authorize，自校验）。
2. **打开系统浏览器**：iOS `ASWebAuthenticationSession`（prefersEphemeralWebSession **不要**开，否则拿不到 realm Cookie）；Android `Custom Tabs`（默认浏览器上下文）。**不要用内嵌 WebView**——Cookie 独立，静默必然失效，还会诱导用户在不可信环境输密码。
3. **先静默后交互**：第一次带 `prompt=none`；收到 `error=login_required`（或 `interaction_required`/`consent_required`）时，去掉 prompt 重新发起交互式授权。
4. **本地交换**：拿 `code` 调 discovery 里的 token 端点（`grant_type=authorization_code` + `code_verifier`）得 `id_token`。
5. **信任转移**：`POST /api/v1/auth/oauth/oidc/token-exchange`；成功后按 §4.1 存储 token pair（iOS Keychain / Android Keystore 加密存储），进入与账密登录一致的业务态。
6. **取消处理**：用户关闭浏览器会话（ASWeb 异步取消 / Custom Tabs 返回键）按「未登录」静默处理，可保留账密入口。

## 8. Token 生命周期与两个会话的关系

```
Keycloak realm 会话（Cookie）            平台会话（access/refresh token）
  ├─ 决定 prompt=none 能否静默             ├─ 与 realm 会话无运行时耦合
  ├─ 登出 realm → 不影响已签发平台 token     ├─ access 过期 → /auth/refresh
  │   （直至平台 token 自然过期）            ├─ /auth/logout → 撤销 refresh token
  └─ 三端共享（同 host）                    └─ drift 检测可在 Keycloak 改密后作废平台本地密码
```

- **APP 登出**：必须调 `/auth/logout` 作废平台 refresh token；是否顺带跳 Keycloak `end_session_endpoint` 登出 realm，需要产品决策——那会把门户/控制台的登录态一起杀掉。
- **账号切换**：APP 内切换账号只需重新走一次 §7 流程；由于 realm Cookie 仍在，第二次大概率静默完成（注意此时静默拿到的是上一个 realm 用户——如需强制选择账号，交互式授权加 `prompt=login`）。

## 9. 安全清单

- [ ] PKCE(S256) 强制、state/nonce 校验、redirect URI 精确匹配
- [ ] 仅系统浏览器上下文（ASWebAuthenticationSession / Custom Tabs），禁内嵌 WebView
- [ ] id_token 只经 HTTPS 提交给平台 token-exchange，不落盘、不打日志
- [ ] 平台 token 存 Keychain / Keystore，不进 UserDefaults/SharedPreferences 明文
- [ ] allowlist（阶段二）仅管理员可改；issuer/签名校验不可绕过
- [ ] 信任假设明确化：token-exchange 对「已验证邮箱匹配」直接自动绑定，无 Web 端 choice 确认——该模型仅在 realm 邮箱统一可信（Mikiko ID 托管）时安全

## 10. 测试要点

1. 冷启 + 无 realm 会话：`prompt=none` 返回 `login_required` → 交互登录 → token-exchange 成功；
2. 已在门户/控制台登录（**同 host**）：`prompt=none` 静默拿码 → 全程无感；
3. 跨 host 反例：Cookie 不生效，验证回退路径；
4. 新 Keycloak 用户（已验证邮箱）→ 自动注册；邮箱与既有账号一致 → 自动绑定；
5. 未验证邮箱 → `OAUTH_EMAIL_NOT_VERIFIED`；
6. 刷新/登出链路；refresh token 轮换后旧值失效；
7. `USER_NOT_ACTIVE`、`AUTH_IDENTITY_EMAIL_MISMATCH`；
8. （阶段二）allowlist 外的 Client → `OAUTH_ID_TOKEN_INVALID`，allowlist 内 → 通过；
9. 开启邀请码注册的平台配置下，token-exchange 自动注册行为需实测确认（Web 侧 fast path 会因邀请码跳过，此接口无该检查）。

## 11. 待决策点

1. allowlist 配置项命名与归属（主 OIDC Provider 设置内新增字段）；
2. APP 登出是否联动 Keycloak realm 登出（影响三端会话）；
3. 阶段一是否落地过（复用平台 Client 需将其改 Public，涉及 Web 端安全属性评估，倾向直接做阶段二）；
4. 邀请码开启时 APP 端注册策略（阻止 / 引导 Web 完成首次登录）。
