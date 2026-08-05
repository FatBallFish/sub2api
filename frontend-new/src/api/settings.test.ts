import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicSettings } from "./settings";

describe("public settings API", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes all public captcha provider settings", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          tencent_captcha_enabled: true,
          tencent_captcha_app_id: "tencent-app",
          aliyun_captcha_enabled: true,
          aliyun_captcha_scene_id: "aliyun-scene",
          aliyun_captcha_prefix: "aliyun-prefix",
          aliyun_captcha_region: "sgp",
        },
      }),
    });

    await expect(getPublicSettings()).resolves.toMatchObject({
      tencent_captcha_enabled: true,
      tencent_captcha_app_id: "tencent-app",
      aliyun_captcha_enabled: true,
      aliyun_captcha_scene_id: "aliyun-scene",
      aliyun_captcha_prefix: "aliyun-prefix",
      aliyun_captcha_region: "sgp",
    });
  });
});
