import { act, createRef } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TencentCaptchaWidget, { type TencentCaptchaWidgetHandle } from "./TencentCaptchaWidget";

const SCRIPT_ID = "tencent-captcha-script";

describe("TencentCaptchaWidget", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "TencentCaptcha");
    document.getElementById(SCRIPT_ID)?.remove();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "TencentCaptcha");
    document.getElementById(SCRIPT_ID)?.remove();
    vi.restoreAllMocks();
  });

  function installTencentCaptcha() {
    let callback: ((result: {
      ret: number;
      ticket?: string;
      randstr?: string;
      errorCode?: number;
    }) => void) | null = null;
    const show = vi.fn();
    const destroy = vi.fn();
    const Constructor = vi.fn(function (
      _appId: string,
      next: typeof callback,
    ) {
      callback = next;
      return { show, destroy };
    });
    Object.defineProperty(window, "TencentCaptcha", {
      configurable: true,
      value: Constructor,
    });
    return {
      Constructor,
      show,
      destroy,
      complete(result: Parameters<NonNullable<typeof callback>>[0]) {
        callback?.(result);
      },
    };
  }

  it("loads one SDK script for concurrent verification requests", async () => {
    const firstRef = createRef<TencentCaptchaWidgetHandle>();
    const secondRef = createRef<TencentCaptchaWidgetHandle>();
    render(<><TencentCaptchaWidget ref={firstRef} appId="app-1" /><TencentCaptchaWidget ref={secondRef} appId="app-2" /></>);

    let firstProof: Promise<unknown> | undefined;
    let secondProof: Promise<unknown> | undefined;
    act(() => {
      firstProof = firstRef.current?.verify();
      secondProof = secondRef.current?.verify();
    });
    expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);

    const sdk = installTencentCaptcha();
    document.getElementById(SCRIPT_ID)?.dispatchEvent(new Event("load"));
    await waitFor(() => expect(sdk.Constructor).toHaveBeenCalledTimes(2));

    act(() => sdk.complete({ ret: 2 }));
    await expect(secondProof).resolves.toBeNull();
    act(() => firstRef.current?.reset());
    await expect(firstProof).resolves.toBeNull();
  });

  it("rejects when the loaded SDK is unavailable", async () => {
    const ref = createRef<TencentCaptchaWidgetHandle>();
    render(<TencentCaptchaWidget ref={ref} appId="app-1" />);

    let proof: Promise<unknown> | undefined;
    act(() => {
      proof = ref.current?.verify();
    });
    document.getElementById(SCRIPT_ID)?.dispatchEvent(new Event("load"));

    await expect(proof).rejects.toThrow("Tencent Captcha SDK is unavailable");
  });

  it("treats cancellation as no proof and rejects invalid ticket results", async () => {
    const sdk = installTencentCaptcha();
    const ref = createRef<TencentCaptchaWidgetHandle>();
    render(<TencentCaptchaWidget ref={ref} appId="app-1" />);

    const cancelled = ref.current!.verify();
    await waitFor(() => expect(sdk.show).toHaveBeenCalledTimes(1));
    act(() => sdk.complete({ ret: 2 }));
    await expect(cancelled).resolves.toBeNull();

    const invalid = ref.current!.verify();
    await waitFor(() => expect(sdk.show).toHaveBeenCalledTimes(2));
    act(() => sdk.complete({ ret: 0, ticket: "trerror_1", randstr: "@rand" }));
    await expect(invalid).rejects.toThrow("Tencent Captcha verification failed");
  });

  it("returns a normalized proof and destroys the instance after completion", async () => {
    const sdk = installTencentCaptcha();
    const ref = createRef<TencentCaptchaWidgetHandle>();
    render(<TencentCaptchaWidget ref={ref} appId="app-1" />);

    const proof = ref.current!.verify();
    await waitFor(() => expect(sdk.show).toHaveBeenCalledTimes(1));
    act(() => sdk.complete({ ret: 0, ticket: " ticket ", randstr: " @rand " }));

    await expect(proof).resolves.toEqual({
      provider: "tencent",
      ticket: "ticket",
      randstr: "@rand",
    });
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });
});
