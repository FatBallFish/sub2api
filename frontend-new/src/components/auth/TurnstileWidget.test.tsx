import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TurnstileWidget, { type TurnstileWidgetHandle } from "./TurnstileWidget";

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface MockRenderOptions {
  sitekey: string;
  theme: "light" | "dark" | "auto";
  size: "normal" | "compact" | "flexible";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": (errorCode?: string) => void;
}

function installTurnstile(widgetIds: string[] = ["widget-1"]) {
  let nextWidget = 0;
  const turnstile = {
    render: vi.fn((_container: HTMLElement, _options: MockRenderOptions) => {
      void _container;
      void _options;
      const widgetId = widgetIds[nextWidget] ?? `widget-${nextWidget + 1}`;
      nextWidget += 1;
      return widgetId;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };

  Object.defineProperty(window, "turnstile", {
    configurable: true,
    writable: true,
    value: turnstile,
  });

  return turnstile;
}

function removeTurnstile() {
  Reflect.deleteProperty(window, "turnstile");
}

function renderOptions(turnstile: ReturnType<typeof installTurnstile>, call = 0) {
  return turnstile.render.mock.calls[call][1];
}

describe("TurnstileWidget", () => {
  afterEach(async () => {
    cleanup();
    removeTurnstile();
    const script = document.getElementById(SCRIPT_ID);
    if (script instanceof HTMLScriptElement) {
      fireEvent.error(script);
      script.remove();
    }
    await Promise.resolve();
    await Promise.resolve();
    vi.restoreAllMocks();
  });

  it("renders explicitly with stable defaults and returns a verified token", async () => {
    const turnstile = installTurnstile();
    const onVerify = vi.fn();

    render(<TurnstileWidget siteKey="site-key" onVerify={onVerify} />);

    const container = screen.getByRole("group", { name: "Security verification" });
    expect(container).toHaveStyle({ width: "100%", minHeight: "65px" });
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    expect(turnstile.render).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        sitekey: "site-key",
        theme: "auto",
        size: "flexible",
      }),
    );

    act(() => renderOptions(turnstile).callback("verified-token"));

    expect(onVerify).toHaveBeenCalledWith("verified-token");
  });

  it("forwards expiration and challenge errors to the parent", async () => {
    const turnstile = installTurnstile();
    const onExpire = vi.fn();
    const onError = vi.fn();

    render(
      <TurnstileWidget
        siteKey="site-key"
        onVerify={vi.fn()}
        onExpire={onExpire}
        onError={onError}
      />,
    );

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    act(() => {
      renderOptions(turnstile)["expired-callback"]();
      renderOptions(turnstile)["error-callback"]("110200");
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("110200");
  });

  it("uses the latest parent callbacks without recreating the Cloudflare widget", async () => {
    const turnstile = installTurnstile();
    const firstOnVerify = vi.fn();
    const latestOnVerify = vi.fn();
    const { rerender } = render(
      <TurnstileWidget siteKey="site-key" onVerify={firstOnVerify} />,
    );

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    rerender(<TurnstileWidget siteKey="site-key" onVerify={latestOnVerify} />);
    act(() => renderOptions(turnstile).callback("fresh-token"));

    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(firstOnVerify).not.toHaveBeenCalled();
    expect(latestOnVerify).toHaveBeenCalledWith("fresh-token");
  });

  it("resets its rendered widget through the imperative handle", async () => {
    const turnstile = installTurnstile(["widget-reset"]);
    const ref = createRef<TurnstileWidgetHandle>();
    render(<TurnstileWidget ref={ref} siteKey="site-key" onVerify={vi.fn()} />);

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    act(() => ref.current?.reset());

    expect(turnstile.reset).toHaveBeenCalledWith("widget-reset");
  });

  it("removes the rendered widget when unmounted", async () => {
    const turnstile = installTurnstile(["widget-unmount"]);
    const { unmount } = render(
      <TurnstileWidget siteKey="site-key" onVerify={vi.fn()} />,
    );

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    unmount();

    expect(turnstile.remove).toHaveBeenCalledWith("widget-unmount");
  });

  it("removes the old widget and renders a new one when the site key changes", async () => {
    const turnstile = installTurnstile(["widget-old", "widget-new"]);
    const { rerender } = render(
      <TurnstileWidget siteKey="old-site-key" onVerify={vi.fn()} />,
    );
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));

    rerender(<TurnstileWidget siteKey="new-site-key" onVerify={vi.fn()} />);

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
    expect(turnstile.remove).toHaveBeenCalledWith("widget-old");
    expect(renderOptions(turnstile, 1).sitekey).toBe("new-site-key");
  });

  it("reports a script load failure to the parent", async () => {
    const onError = vi.fn();
    render(
      <TurnstileWidget siteKey="site-key" onVerify={vi.fn()} onError={onError} />,
    );

    const script = await waitFor(() => {
      const element = document.getElementById(SCRIPT_ID);
      expect(element).toBeInstanceOf(HTMLScriptElement);
      return element as HTMLScriptElement;
    });
    fireEvent.error(script);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
  });

  it("does not remove a failing script that it did not create", async () => {
    const externalScript = document.createElement("script");
    externalScript.id = SCRIPT_ID;
    document.head.appendChild(externalScript);
    const onError = vi.fn();
    render(
      <TurnstileWidget siteKey="site-key" onVerify={vi.fn()} onError={onError} />,
    );

    fireEvent.error(externalScript);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(externalScript).toBeInTheDocument();
  });

  it("loads a fresh script after an owned script fails", async () => {
    const firstOnError = vi.fn();
    const firstMount = render(
      <TurnstileWidget siteKey="site-key" onVerify={vi.fn()} onError={firstOnError} />,
    );
    const firstScript = await waitFor(() => {
      const element = document.getElementById(SCRIPT_ID);
      expect(element).toBeInstanceOf(HTMLScriptElement);
      return element as HTMLScriptElement;
    });

    fireEvent.error(firstScript);
    await waitFor(() => expect(firstOnError).toHaveBeenCalledWith(expect.any(Error)));
    firstMount.unmount();

    const secondMount = render(
      <TurnstileWidget siteKey="site-key" onVerify={vi.fn()} />,
    );
    const secondScript = await waitFor(() => {
      const element = document.getElementById(SCRIPT_ID);
      expect(element).toBeInstanceOf(HTMLScriptElement);
      expect(element).not.toBe(firstScript);
      return element as HTMLScriptElement;
    });
    const turnstile = installTurnstile(["widget-retry"]);
    fireEvent.load(secondScript);

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    secondMount.unmount();
  });

  it("loads a fresh script when a loaded owned script does not expose the API", async () => {
    const firstOnError = vi.fn();
    const firstMount = render(
      <TurnstileWidget siteKey="site-key" onVerify={vi.fn()} onError={firstOnError} />,
    );
    const firstScript = await waitFor(() => {
      const element = document.getElementById(SCRIPT_ID);
      expect(element).toBeInstanceOf(HTMLScriptElement);
      return element as HTMLScriptElement;
    });

    fireEvent.load(firstScript);
    await waitFor(() => expect(firstOnError).toHaveBeenCalledWith(expect.any(Error)));
    firstMount.unmount();

    const secondMount = render(
      <TurnstileWidget siteKey="site-key" onVerify={vi.fn()} />,
    );
    const secondScript = await waitFor(() => {
      const element = document.getElementById(SCRIPT_ID);
      expect(element).toBeInstanceOf(HTMLScriptElement);
      expect(element).not.toBe(firstScript);
      return element as HTMLScriptElement;
    });
    const turnstile = installTurnstile(["widget-retry"]);
    fireEvent.load(secondScript);

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    secondMount.unmount();
  });

  it("shares one lazy-loaded Cloudflare script between mounted widgets", async () => {
    render(
      <>
        <TurnstileWidget siteKey="site-key-1" onVerify={vi.fn()} />
        <TurnstileWidget siteKey="site-key-2" onVerify={vi.fn()} />
      </>,
    );

    const script = await waitFor(() => {
      const element = document.getElementById(SCRIPT_ID);
      expect(element).toBeInstanceOf(HTMLScriptElement);
      return element as HTMLScriptElement;
    });
    expect(script.src).toBe(SCRIPT_URL);
    expect(document.querySelectorAll(`script#${SCRIPT_ID}`)).toHaveLength(1);

    const turnstile = installTurnstile(["widget-1", "widget-2"]);
    fireEvent.load(script);

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
  });
});
