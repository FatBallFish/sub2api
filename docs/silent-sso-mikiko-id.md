# 门户免登（sso=silent 静默 OIDC 登录）

mikiko.ai 门户的「获取 API Key / 打开控制台」按钮会以 `?sso=silent` 打开本站（未登录时先在门户完成
Mikiko ID 登录，再自动跳转过来）。本站据此做一次**静默 OIDC 登录**：成功则无感进入控制台，失败则当作
无事发生，用户走正常登录流程。

## 参数约定

| 项 | 值 |
| --- | --- |
| 触发参数 | 查询参数 `sso=silent`（仅认该取值，其余忽略） |
| 检测入口 | 新前端主页 `/` 与登录页 `/login`（`/register` 共用登录页组件，同样生效） |
| 参数处理 | 检测后立即从地址栏摘除（`history.replace`），刷新/后退不会重复触发 |
| 登录提供方 | 管理后台的 console OIDC（`oidc_console_oauth_*` 设置，`/api/v1/auth/oauth/oidc-console/*`） |

## 流程

```
浏览器                     新前端                        后端                        Keycloak
  │ /?sso=silent            │                            │                            │
  │────────────────────────▶│ 摘除参数；未登录且可静默      │                            │
  │                         │ (console OIDC 开启、无行为   │                            │
  │                         │  验证码、无待同意登录协议)    │                            │
  │◀─ 整页跳转 ─────────────│                            │                            │
  │ /api/v1/auth/oauth/oidc-console/start?redirect=/console&prompt=none&fallback=/    │
  │──────────────────────────────────────────────────────▶ 种 state/PKCE/silent cookie│
  │◀────────────────────────── 302 authorize_url (prompt=none) ───────────────────────│
  │──────────────────────────── 授权请求 ────────────────────────────────────────────▶│
  │                                                   有 realm SSO 会话？              │
  │◀── 302 code（静默）───────────────────────────────────────────── 是 ──────────────│
  │── 302 error=login_required ───────────────────────────────────── 否 ─────────────▶│
  │                         │                            │                            │
  │ 成功：回调换 token → 前端 /auth/callback → 落 redirect（/console）；                │
  │      新用户走既有 choice/补全注册 UI                                                │
  │ 失败：后端发现 silent cookie → /auth/callback#error=...&silent=1&fallback=<入口页>  │
  │      → 前端不展示任何错误，直接 navigate(fallback)                                 │
```

## Keycloak 侧要求

console OIDC 指向的客户端（realm `mikiko` 下，如 `mikiko-cc`）：

- Standard flow：ON（授权码 + PKCE，后端 `oidc-console/start` 自动携带 code_challenge）
- Client authentication：ON（后端机密客户端换 token）
- Valid redirect URIs：填后端回调 `{API_BASE_URL}/api/v1/auth/oauth/oidc-console/callback`
- **Consent required：OFF**（默认即关。若开启且用户未同意，`prompt=none` 会返回
  `consent_required`——不会卡死，但免登会静默失败回退）

## 跨 client / 跨 realm 行为

- **同 realm 不同 client：可以静默登录。** Keycloak 的 SSO 会话 Cookie
  （`KEYCLOAK_IDENTITY`/`KEYCLOAK_SESSION`）作用域为 `/realms/<realm>/`，按 realm 而非 client
  隔离。门户用 `mikiko-portal` 登录后，本站 console client 的 `prompt=none` 授权请求命中同一
  realm 会话，Keycloak 不弹 UI 直接签发 code。
- **不同 realm：无法静默登录（预期）。** Cookie 按 realm 路径隔离，无共享会话，`prompt=none`
  返回 `login_required`，前端静默回退入口页。身份域隔离本就不应静默打通。

## 安全说明

- `prompt` 仅接受字面值 `none`，其余取值被后端忽略，防任意参数注入授权 URL。
- `fallback` 由后端 `sanitizeFrontendRedirectPath` 消毒（仅同源相对路径，外站回退 `/login`），
  前端 `sanitizeSilentSsoFallback` 二次校验（fragment 双层编码先解码再校验）。
- state/PKCE/nonce 校验与正常 OIDC 登录完全一致，静默不降低任何安全边界。
- silent cookie（`oidc_oauth_console_silent`）HttpOnly、Path 限定 `/api/v1/auth/oauth/oidc-console`，
  回调结束即清。
- 需要用户交互的场景不会静默绕过：登录协议未同意、腾讯/阿里行为验证码开启时直接跳过静默尝试。

## 本地联调

1. 门户 `.env.development` 配 `VITE_PRODUCT_CC_URL=http://127.0.0.1:<新前端端口>`。
2. 本地 Keycloak 在 realm `mikiko` 下为本站建 console client（回调指向本地后端
   `/api/v1/auth/oauth/oidc-console/callback`），并在管理后台「系统设置 → OIDC」配置 console 段。
3. 门户登录后点「获取 API Key」→ 新标签打开 `http://127.0.0.1:<port>/?sso=silent` → 无感进入
   `/console`；退出 Mikiko ID 会话后再试 → 静默回退，主页/登录页正常渲染。
