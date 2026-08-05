import { act, createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AliyunCaptchaWidget, { type AliyunCaptchaWidgetHandle } from "./AliyunCaptchaWidget";

interface CapturedOptions {
  SceneId: string;
  prefix: string;
  mode: string;
  button: string;
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
});
