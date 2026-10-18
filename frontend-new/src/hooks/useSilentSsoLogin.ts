import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { startOAuth } from "../api/auth";
import { getPublicSettings, type PublicSettings } from "../api/settings";
import { resolveCaptchaProvider } from "../components/auth/captcha";
import { isAuthenticated } from "../utils/authStorage";
import { agreementDocuments, agreementRevision, hasAcceptedAgreement } from "../utils/loginAgreement";
import { readSilentSsoRequest, stripSilentSsoParam } from "../utils/silentSso";

export type SilentSsoStatus =
  | "no-param"
  /** 入口带 sso=silent，正在判定是否发起静默登录。 */
  | "pending"
  /** 已发起 prompt=none 静默授权（整页跳转中）。 */
  | "started"
  /** 判定不发起（已登录 / 前置条件不满足 / 判定失败），页面照常渲染。 */
  | "skipped";

interface SilentSsoOptions {
  /** 静默登录成功后的落点（与正常 OIDC 登录的 redirect 一致）。 */
  successRedirect: string;
  /**
   * 页面自身已加载的 public settings（如登录页）；未加载时传 undefined，
   * hook 会按需拉取一次。判定永远基于最新加载的一份 settings。
   */
  settings?: PublicSettings | null;
}

// 静默登录不能绕过用户同意与交互式验证码：行为验证码（腾讯/阿里）需要弹窗
// 交互，登录协议需要显式勾选，二者任一存在都退回正常登录流程。
function silentSsoEligible(settings: PublicSettings | null): boolean {
  if (settings?.oidc_console_oauth_enabled !== true) return false;
  try {
    const provider = resolveCaptchaProvider(settings);
    if (provider?.provider === "tencent" || provider?.provider === "aliyun") return false;
  } catch {
    return false;
  }
  const documents = agreementDocuments(settings);
  if (settings.login_agreement_enabled === true && documents.length > 0) {
    if (!hasAcceptedAgreement(agreementRevision(settings, documents))) return false;
  }
  return true;
}

/**
 * 门户免登入口：URL 带 `?sso=silent` 时尝试一次静默 OIDC 登录。
 * - 先把 sso 参数从地址栏摘除（刷新/后退不重复触发）
 * - 已登录 → 直接进入 successRedirect
 * - 未登录且前置条件满足 → 整页发起 console OIDC `prompt=none` 授权；
 *   IdP 有 realm 会话则无感完成，失败则由回调页按 fallback 静默回入口页
 * - 前置条件不满足 → 什么都不发生，用户走正常登录流程
 */
export function useSilentSsoLogin({ successRedirect, settings }: SilentSsoOptions): SilentSsoStatus {
  const location = useLocation();
  const navigate = useNavigate();

  // 首帧快照（useState 初始化器只执行一次）：参数摘除后 location 变化不影响检测。
  const [entry] = useState(() => {
    const strippedSearch = stripSilentSsoParam(location.search);
    return {
      search: location.search,
      fallback: `${location.pathname}${strippedSearch}` || "/",
    };
  });
  const detected = readSilentSsoRequest(entry.search);

  const [phase, setPhase] = useState<SilentSsoStatus>(detected ? "pending" : "no-param");
  const settledRef = useRef(false);

  useEffect(() => {
    if (!detected) return;
    // 摘除 sso 参数，保留其余查询参数；search 取首帧快照，重复执行幂等。
    navigate(
      { pathname: location.pathname, search: stripSilentSsoParam(entry.search) },
      { replace: true },
    );
  }, [detected, entry.search, location.pathname, navigate]);

  useEffect(() => {
    if (!detected || settledRef.current) return;

    // 已登录：直接进目标页。组件即将跳转离开，无需再迁移 phase。
    if (isAuthenticated()) {
      settledRef.current = true;
      navigate(successRedirect, { replace: true });
      return;
    }

    let active = true;
    const resolveSettings = settings ?? getPublicSettings();
    void Promise.resolve(resolveSettings)
      .then((resolved) => {
        if (!active || settledRef.current) return;
        settledRef.current = true;
        if (!silentSsoEligible(resolved)) {
          setPhase("skipped");
          return;
        }
        setPhase("started");
        startOAuth("oidc-console", successRedirect, undefined, undefined, {
          prompt: "none",
          fallback: entry.fallback,
        });
      })
      .catch(() => {
        if (!active || settledRef.current) return;
        settledRef.current = true;
        setPhase("skipped");
      });
    return () => {
      active = false;
    };
  }, [detected, entry.fallback, navigate, settings, successRedirect]);

  return phase;
}
