import { act, createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import AliyunCaptchaWidget, { type AliyunCaptchaWidgetHandle } from "./AliyunCaptchaWidget";

interface CapturedOptions {
  SceneId: string;
  prefix: string;
  mode: string;
  button: string;
  language: "cn" | "en";
  captchaVerifyCallback: (param: string) => { captchaResult: boolean };
}

describe("AliyunCaptchaWidget", () => {
  let options: CapturedOptions | null;

  beforeEach(() => {
    options = null;
    Object.defineProperty(window, "initAliyunCaptcha", {
      configurable: true,
      value: vi.fn((next: CapturedOptions) => {
        options = next;
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "initAliyunCaptcha");
    Reflect.deleteProperty(window, "AliyunCaptchaConfig");
    document.getElementById("aliyunCaptcha-window-popup")?.remove();
    document.getElementById("aliyunCaptcha-mask")?.remove();
    document.getElementById("aliyun-captcha-script")?.remove();
    vi.restoreAllMocks();
  });

  it("initializes popup mode and resolves a completed verification", async () => {
    const ref = createRef<AliyunCaptchaWidgetHandle>();
    render(<AliyunCaptchaWidget ref={ref} sceneId="scene-1" prefix="prefix-1" region="sgp" />);
    await waitFor(() => expect(window.initAliyunCaptcha).toHaveBeenCalledTimes(1));

    expect(window.AliyunCaptchaConfig).toEqual({ region: "sgp", prefix: "prefix-1" });
    expect(options).toMatchObject({ SceneId: "scene-1", prefix: "prefix-1", mode: "popup" });

    const pending = ref.current!.verify();
    act(() => options!.captchaVerifyCallback(" captcha-param "));
    await expect(pending).resolves.toEqual({ provider: "aliyun", token: "captcha-param" });
    expect(screen.getByRole("button", { name: "Security verification completed" })).toBeDisabled();
  });

  it("resets a cached proof and returns the control to idle", async () => {
    const ref = createRef<AliyunCaptchaWidgetHandle>();
    render(<AliyunCaptchaWidget ref={ref} sceneId="scene-1" prefix="prefix-1" />);
    await waitFor(() => expect(options).not.toBeNull());

    const pending = ref.current!.verify();
    act(() => options!.captchaVerifyCallback("captcha-param"));
    await pending;
    act(() => ref.current?.reset());

    expect(screen.getByRole("button", { name: "Start security verification" })).toBeEnabled();
  });

  it("settles a pending verification and removes SDK popup DOM on unmount", async () => {
    const ref = createRef<AliyunCaptchaWidgetHandle>();
    const view = render(<AliyunCaptchaWidget ref={ref} sceneId="scene-1" prefix="prefix-1" />);
    await waitFor(() => expect(options).not.toBeNull());
    const popup = document.createElement("div");
    popup.id = "aliyunCaptcha-window-popup";
    document.body.appendChild(popup);
    const mask = document.createElement("div");
    mask.id = "aliyunCaptcha-mask";
    document.body.appendChild(mask);

    const pending = ref.current!.verify();
    view.unmount();

    await expect(pending).resolves.toBeNull();
    expect(document.getElementById("aliyunCaptcha-window-popup")).toBeNull();
    expect(document.getElementById("aliyunCaptcha-mask")).toBeNull();
  });

  it("enters verification state when the visible control is clicked", async () => {
    render(<AliyunCaptchaWidget sceneId="scene-1" prefix="prefix-1" />);
    await waitFor(() => expect(options).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Start security verification" }));

    expect(screen.getByRole("button", { name: "Security verification in progress" })).toBeEnabled();
  });

  it("localizes the visible verification states", async () => {
    await i18n.changeLanguage("ja");
    render(<AliyunCaptchaWidget sceneId="scene-1" prefix="prefix-1" />);
    await waitFor(() => expect(options).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "セキュリティ検証を開始" }));

    expect(screen.getByRole("button", { name: "セキュリティ検証中" })).toBeEnabled();
  });

  it("recreates the SDK with a mapped language and clears an old proof", async () => {
    await i18n.changeLanguage("zh-CN");
    const captured: CapturedOptions[] = [];
    vi.mocked(window.initAliyunCaptcha!).mockImplementation((next) => {
      captured.push(next as CapturedOptions);
      options = next as CapturedOptions;
    });
    const ref = createRef<AliyunCaptchaWidgetHandle>();
    render(<AliyunCaptchaWidget ref={ref} sceneId="scene-1" prefix="prefix-1" />);
    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0].language).toBe("cn");

    const pending = ref.current!.verify();
    act(() => captured[0].captchaVerifyCallback("old-proof"));
    await pending;
    expect(screen.getByRole("button", { name: "安全验证已完成" })).toBeDisabled();

    const popup = document.createElement("div");
    popup.id = "aliyunCaptcha-window-popup";
    document.body.appendChild(popup);
    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    await waitFor(() => expect(captured).toHaveLength(2));
    expect(captured[1].language).toBe("en");
    expect(document.getElementById("aliyunCaptcha-window-popup")).toBeNull();
    expect(screen.getByRole("button", { name: "セキュリティ検証を開始" })).toBeEnabled();
  });
});
