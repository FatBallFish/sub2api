/**
 * 门户（mikiko.ai）免登跳转约定：入口 URL 携带 `?sso=silent` 时，尝试一次
 * 静默 OIDC 登录（console_oidc，prompt=none）。失败则当作无事发生，用户
 * 走正常登录流程。
 */

export const SILENT_SSO_PARAM = "sso";
export const SILENT_SSO_VALUE = "silent";
export const SILENT_SSO_FALLBACK_DEFAULT = "/login";

/** 仅当 `sso === "silent"` 时视为静默登录请求（其余取值一律忽略）。 */
export function readSilentSsoRequest(search: string): boolean {
  try {
    return new URLSearchParams(search).get(SILENT_SSO_PARAM) === SILENT_SSO_VALUE;
  } catch {
    return false;
  }
}

/** 摘除 sso 参数并保留其余查询参数；返回新的 search 字符串（可能为空串）。 */
export function stripSilentSsoParam(search: string): string {
  try {
    const params = new URLSearchParams(search);
    params.delete(SILENT_SSO_PARAM);
    const stripped = params.toString();
    return stripped ? `?${stripped}` : "";
  } catch {
    return search ? "?" : "";
  }
}

/**
 * 消毒静默登录失败后的回退路径：仅允许同源相对路径（/ 开头、非 //、无协议），
 * 允许 /login（与 OAuthCallback 的 sanitizeRedirectPath 不同——那里会把
 * /login 改写成 /console，只适用于登录成功后的跳转）。非法值回退 /login。
 *
 * 后端 fragment 由 url.Values.Encode() + URL.Fragment 双层编码（"/login" →
 * "%252Flogin"），与 OAuthCallback 的 decodeRedirect 一致先解两层再校验。
 */
export function sanitizeSilentSsoFallback(value: string | null | undefined): string {
  let decoded = (value || "").trim();
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return SILENT_SSO_FALLBACK_DEFAULT;
  if (decoded.includes("://") || decoded.includes("\\")) return SILENT_SSO_FALLBACK_DEFAULT;
  const hasUnsafeCharacter = Array.from(decoded).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (hasUnsafeCharacter) return SILENT_SSO_FALLBACK_DEFAULT;
  return decoded;
}
