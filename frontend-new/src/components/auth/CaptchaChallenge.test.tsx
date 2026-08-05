import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaptchaChallenge, { type CaptchaChallengeHandle } from "./CaptchaChallenge";
import { resolveCaptchaProvider } from "./captcha";

vi.mock("./TurnstileWidget", () => ({
  default: () => <div data-testid="turnstile-widget" />,
}));
vi.mock("./TencentCaptchaWidget", () => ({
  default: () => <div data-testid="tencent-widget" />,
}));
vi.mock("./AliyunCaptchaWidget", () => ({
  default: () => <div data-testid="aliyun-widget" />,
}));

describe("CaptchaChallenge", () => {
  afterEach(cleanup);

  it("selects each configured provider", () => {
    expect(resolveCaptchaProvider({ turnstile_enabled: true, turnstile_site_key: "site" })).toMatchObject({ provider: "turnstile" });
    expect(resolveCaptchaProvider({ tencent_captcha_enabled: true, tencent_captcha_app_id: "app" })).toMatchObject({ provider: "tencent" });
    expect(resolveCaptchaProvider({
      aliyun_captcha_enabled: true,
      aliyun_captcha_scene_id: "scene",
      aliyun_captcha_prefix: "prefix",
    })).toMatchObject({ provider: "aliyun" });
  });

  it("rejects multiple enabled captcha providers", async () => {
    const onError = vi.fn();
    const ref = createRef<CaptchaChallengeHandle>();
    render(<CaptchaChallenge
      ref={ref}
      settings={{
        turnstile_enabled: true,
        turnstile_site_key: "site",
        tencent_captcha_enabled: true,
        tencent_captcha_app_id: "app",
      }}
      onError={onError}
      onVerify={vi.fn()}
    />);

    expect(screen.getByRole("alert")).toHaveTextContent("Security verification is misconfigured");
    expect(onError).toHaveBeenCalledTimes(1);
    await expect(ref.current?.verify()).resolves.toBeNull();
  });

  it("fails closed when an enabled provider is missing public configuration", () => {
    expect(() => resolveCaptchaProvider({
      aliyun_captcha_enabled: true,
      aliyun_captcha_scene_id: "scene",
      aliyun_captcha_prefix: "",
    })).toThrow("Aliyun captcha configuration is incomplete");
  });
});
