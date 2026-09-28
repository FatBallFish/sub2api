import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "./bootstrap";

describe("bootstrap", () => {
  it("activates the English fallback and renders after i18n initialization rejects", async () => {
    const sequence: string[] = [];

    await expect(bootstrap({
      initialize: async () => {
        sequence.push("initialize");
        throw new Error("initialization failed");
      },
      activateEnglishFallback: async () => {
        sequence.push("fallback");
      },
      render: () => {
        sequence.push("render");
      },
    })).resolves.toBeUndefined();

    expect(sequence).toEqual(["initialize", "fallback", "render"]);
  });

  it("still renders when both normal and fallback initialization reject", async () => {
    const render = vi.fn();

    await expect(bootstrap({
      initialize: async () => Promise.reject(new Error("initialization failed")),
      activateEnglishFallback: async () => Promise.reject(new Error("fallback failed")),
      render,
    })).resolves.toBeUndefined();

    expect(render).toHaveBeenCalledOnce();
  });
});
