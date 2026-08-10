import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { createI18nInstance } from "../i18n";
import { localizedErrorMessage } from "./localizedError";

describe("localizedErrorMessage", () => {
  let t: Awaited<ReturnType<typeof createI18nInstance>>["t"];

  beforeAll(async () => {
    ({ t } = await createI18nInstance({ initialLocale: "zh-CN", storage: null, documentElement: null }));
  });

  it("translates a known stable ApiError code in the active locale", () => {
    const error = new ApiError("invalid email or password", 401, {}, "INVALID_CREDENTIALS");

    expect(localizedErrorMessage(error, "errors.unknown", t)).toBe("邮箱或密码错误。");
  });

  it("preserves the useful backend message for an unknown ApiError code", () => {
    const error = new ApiError("A custom backend explanation", 409, {}, "CUSTOM_DYNAMIC_ERROR");

    expect(localizedErrorMessage(error, "errors.unknown", t)).toBe("A custom backend explanation");
  });

  it("does not translate an ApiError from HTTP status alone", () => {
    const error = new ApiError("Payment provider maintenance", 503, {});

    expect(localizedErrorMessage(error, "errors.unknown", t)).toBe("Payment provider maintenance");
  });

  it("preserves messages from ordinary errors", () => {
    expect(localizedErrorMessage(new Error("Network disconnected"), "errors.unknown", t)).toBe("Network disconnected");
  });

  it.each([null, undefined, 503, {}, new Error("")])(
    "uses the localized caller fallback for missing message %#",
    (error) => {
      expect(localizedErrorMessage(error, "errors.unknown", t)).toBe("出现错误，请稍后重试。");
    },
  );
});
