import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "../api/client";
import { createI18nInstance, type SupportedLocale } from "../i18n";
import en from "../i18n/resources/en";
import ja from "../i18n/resources/ja";
import zhCN from "../i18n/resources/zh-CN";
import zhTW from "../i18n/resources/zh-TW";
import { localizedErrorMessage } from "./localizedError";

const originalFetch = globalThis.fetch;

describe("localizedErrorMessage", () => {
  let t: Awaited<ReturnType<typeof createI18nInstance>>["t"];

  beforeAll(async () => {
    ({ t } = await createI18nInstance({ initialLocale: "zh-CN", storage: null, documentElement: null }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("translates a known stable ApiError code in the active locale", () => {
    const error = new ApiError("invalid email or password", 401, {}, "INVALID_CREDENTIALS");

    expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("邮箱或密码错误。");
  });

  it("preserves the useful backend message for an unknown ApiError code", () => {
    const error = new ApiError("A custom backend explanation", 409, {}, "CUSTOM_DYNAMIC_ERROR");

    expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("A custom backend explanation");
  });

  it("preserves an unknown backend message when a scope is provided", () => {
    const error = new ApiError("Scoped backend explanation", 409, {}, "CUSTOM_DYNAMIC_ERROR");

    expect(localizedErrorMessage(error, "consoleLoadFailed", { t, scope: "auth" })).toBe("Scoped backend explanation");
  });

  it("does not translate an ApiError from HTTP status alone", () => {
    const error = new ApiError("Payment provider maintenance", 503, {});

    expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("Payment provider maintenance");
  });

  it.each([
    new Error("Network disconnected"),
    new TypeError("Cannot read properties of undefined"),
  ])("uses the localized caller fallback for ordinary errors", (error) => {
    expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("无法加载控制台。");
  });

  it("preserves a useful response-backed ApiError message", () => {
    const error = new ApiError("Provider response detail", 502, {}, undefined, "response");

    expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("Provider response detail");
  });

  it.each([null, undefined, 503, {}, new Error("")])(
    "uses the localized caller fallback for missing message %#",
    (error) => {
      expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("无法加载控制台。");
    },
  );

  it("uses the localized caller fallback when apiRequest had no backend message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: 503 }),
    });
    const error = await apiRequest("/unavailable").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("无法加载控制台。");
  });

  it("uses the localized caller fallback for a whitespace-only backend message", async () => {
    const payload = { code: 503, message: "   \t  " };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => payload,
    });
    const error = await apiRequest("/unavailable").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).payload).toBe(payload);
    expect(localizedErrorMessage(error, "consoleLoadFailed", t)).toBe("无法加载控制台。");
  });

  it.each([
    ["en", [
      "Too many requests. Please slow down and try again later.",
      "The user account was not found.",
      "Sign in is required for this action.",
      "The current password is incorrect.",
      "You do not have sufficient permission for this action.",
      "The API key is invalid.",
      "Too many invalid authentication attempts. Try again later.",
    ]],
    ["zh-CN", [
      "请求过于频繁，请稍后重试。",
      "未找到该用户账号。",
      "此操作需要先登录。",
      "当前密码错误。",
      "你没有足够的权限执行此操作。",
      "API 密钥无效。",
      "无效认证尝试次数过多，请稍后重试。",
    ]],
    ["zh-TW", [
      "請求過於頻繁，請稍後再試。",
      "找不到此使用者帳號。",
      "此操作需要先登入。",
      "目前密碼錯誤。",
      "你沒有足夠的權限執行此操作。",
      "API 金鑰無效。",
      "無效驗證嘗試次數過多，請稍後再試。",
    ]],
    ["ja", [
      "リクエストが多すぎます。しばらくしてからお試しください。",
      "ユーザーアカウントが見つかりません。",
      "この操作にはログインが必要です。",
      "現在のパスワードが正しくありません。",
      "この操作を実行するための権限がありません。",
      "API キーが無効です。",
      "無効な認証試行が多すぎます。しばらくしてからお試しください。",
    ]],
  ] as [SupportedLocale, string[]][])("localizes common stable errors in %s", async (locale, expected) => {
    const instance = await createI18nInstance({ initialLocale: locale, storage: null, documentElement: null });
    const codes = [
      "RATE_LIMITED",
      "USER_NOT_FOUND",
      "AUTH_REQUIRED",
      "PASSWORD_INCORRECT",
      "INSUFFICIENT_PERMISSIONS",
      "INVALID_API_KEY",
      "INVALID_AUTH_RATE_LIMITED",
    ];

    expect(codes.map((code) => localizedErrorMessage(
      new ApiError("backend message", 400, {}, code),
      "consoleLoadFailed",
      instance.t,
    ))).toEqual(expected);
  });

  it("keeps all locale error resource keys aligned", () => {
    const expectedKeys = Object.keys(en.errors).sort();

    expect(Object.keys(zhCN.errors).sort()).toEqual(expectedKeys);
    expect(Object.keys(zhTW.errors).sort()).toEqual(expectedKeys);
    expect(Object.keys(ja.errors).sort()).toEqual(expectedKeys);
  });

  it("distinguishes INVALID_USER between auth and affiliate scopes", () => {
    const error = new ApiError("invalid user", 400, {}, "INVALID_USER");

    expect(localizedErrorMessage(error, "consoleLoadFailed", { t, scope: "auth" })).toBe("无法使用该账号登录。");
    expect(localizedErrorMessage(error, "consoleLoadFailed", { t, scope: "affiliate" })).toBe("请选择有效的返利用户。");
  });

  it("distinguishes DAILY_LIMIT_EXCEEDED between payment and subscription scopes", () => {
    const error = new ApiError("daily limit exceeded", 429, {}, "DAILY_LIMIT_EXCEEDED");

    expect(localizedErrorMessage(error, "consoleLoadFailed", { t, scope: "payment" })).toBe("已达到每日支付限额。");
    expect(localizedErrorMessage(error, "consoleLoadFailed", { t, scope: "subscription" })).toBe("已达到订阅的每日用量限额。");
  });
});
