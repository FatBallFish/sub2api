import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import CaptchaChallenge, { type CaptchaChallengeHandle } from "./CaptchaChallenge";
import { resolveCaptchaProvider } from "./captcha";

const turnstileHarness = vi.hoisted(() => ({
  props: null as { onError?: (error?: string | Error) => void } | null,
}));

vi.mock("./TurnstileWidget", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockTurnstileWidget(
      props: { onError?: (error?: string | Error) => void },
      ref: React.ForwardedRef<unknown>,
    ) {
      void ref;
      turnstileHarness.props = props;
      return <div data-testid="turnstile-widget" />;
    }),
  };
});
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

  it("localizes a frontend-owned configuration error", async () => {
    await i18n.changeLanguage("zh-CN");
    render(<CaptchaChallenge
      settings={{
        turnstile_enabled: true,
        turnstile_site_key: "site",
        tencent_captcha_enabled: true,
        tencent_captcha_app_id: "app",
      }}
      onVerify={vi.fn()}
    />);

    expect(screen.getByRole("alert")).toHaveTextContent("安全验证配置有误");
  });

  it("reports localized generic configuration and verification failures", async () => {
    await i18n.changeLanguage("ja");
    const configurationError = vi.fn();
    const invalid = render(<CaptchaChallenge
      settings={{
        turnstile_enabled: true,
        turnstile_site_key: "site",
        tencent_captcha_enabled: true,
        tencent_captcha_app_id: "app",
      }}
      onError={configurationError}
      onVerify={vi.fn()}
    />);

    expect(configurationError).toHaveBeenCalledWith(
      new Error("セキュリティ検証の設定に問題があります。"),
    );
    invalid.unmount();

    const verificationError = vi.fn();
    render(<CaptchaChallenge
      settings={{ turnstile_enabled: true, turnstile_site_key: "site" }}
      onError={verificationError}
      onVerify={vi.fn()}
    />);
    act(() => turnstileHarness.props?.onError?.());

    expect(verificationError).toHaveBeenCalledWith(
      new Error("セキュリティ検証に失敗しました。もう一度お試しください。"),
    );
  });

  it("preserves a raw provider verification detail", () => {
    const onError = vi.fn();
    render(<CaptchaChallenge
      settings={{ turnstile_enabled: true, turnstile_site_key: "site" }}
      onError={onError}
      onVerify={vi.fn()}
    />);
    act(() => turnstileHarness.props?.onError?.("110200"));

    expect(onError).toHaveBeenCalledWith(new Error("110200"));
  });
});
