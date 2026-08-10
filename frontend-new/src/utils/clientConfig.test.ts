import { describe, expect, it } from "vitest";
import {
  OPENAI_CC_SWITCH_CODEX_MODEL,
  buildCcSwitchImportDeeplink,
  buildClientConfigFiles,
  getInstallClientOptions,
} from "./clientConfig";

function paramsFromDeeplink(deeplink: string) {
  return new URLSearchParams(deeplink.split("?")[1] || "");
}

describe("clientConfig", () => {
  it("keeps Codex config.toml and auth.json as separate files", () => {
    const files = buildClientConfigFiles({
      platform: "openai",
      clientId: "codex",
      shellId: "unix",
      baseUrl: "https://api.example.com",
      apiKey: "sk-live",
    });

    expect(files.map((file) => file.path)).toEqual(["~/.codex/config.toml", "~/.codex/auth.json"]);
    expect(files[0].content).toContain('base_url = "https://api.example.com/v1"');
    expect(files[0].content).not.toContain("OPENAI_API_KEY");
    expect(files[0].hintId).toBe("codexAuth");
    expect(files[0]).not.toHaveProperty("hint");
    expect(files[1].content).toContain('"OPENAI_API_KEY": "sk-live"');
  });

  it("builds Claude Code environment and settings files for Anthropic groups", () => {
    const files = buildClientConfigFiles({
      platform: "anthropic",
      clientId: "claude",
      shellId: "unix",
      baseUrl: "https://api.example.com",
      apiKey: "sk-claude",
    });

    expect(files[0]).toMatchObject({ displayTargetId: "terminal" });
    expect(files[0]).not.toHaveProperty("path");
    expect(files[1].path).toBe("~/.claude/settings.json");
    expect(files[0].content).toContain('export ANTHROPIC_BASE_URL="https://api.example.com/v1"');
    expect(files[0].content).toContain('export ANTHROPIC_AUTH_TOKEN="sk-claude"');
    expect(files[1].content).toContain('"CLAUDE_CODE_ATTRIBUTION_HEADER": "0"');
    expect(files[1].hintId).toBe("claudeSettings");
    expect(files[1]).not.toHaveProperty("hint");
  });

  it("separates command prompt display targets from technical config paths", () => {
    const files = buildClientConfigFiles({
      platform: "anthropic",
      clientId: "claude",
      shellId: "cmd",
      baseUrl: "https://api.example.com",
      apiKey: "sk-claude",
    });

    expect(files[0]).toMatchObject({ displayTargetId: "commandPrompt" });
    expect(files[0]).not.toHaveProperty("path");
    expect(files[1].path).toBe("%userprofile%\\.claude\\settings.json");
  });

  it("builds Gemini CLI config against v1beta", () => {
    const files = buildClientConfigFiles({
      platform: "gemini",
      clientId: "gemini",
      shellId: "powershell",
      baseUrl: "https://api.example.com",
      apiKey: "sk-gemini",
    });

    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('$env:GOOGLE_GEMINI_BASE_URL="https://api.example.com/v1beta"');
    expect(files[0].content).toContain('$env:GEMINI_API_KEY="sk-gemini"');
  });

  it("uses a stable hint ID for OpenCode merge guidance", () => {
    const files = buildClientConfigFiles({
      platform: "openai",
      clientId: "opencode",
      shellId: "unix",
      baseUrl: "https://api.example.com",
      apiKey: "sk-opencode",
    });

    expect(files[0].path).toBe("opencode.json");
    expect(files[0].hintId).toBe("openCodeMerge");
    expect(files[0]).not.toHaveProperty("hint");
  });

  it("limits OpenAI install clients to Codex unless messages dispatch is enabled", () => {
    expect(getInstallClientOptions("openai").map((option) => option.id)).toEqual(["codex", "codex-ws", "opencode"]);
    expect(getInstallClientOptions("openai", true).map((option) => option.id)).toEqual([
      "codex",
      "codex-ws",
      "claude",
      "opencode",
    ]);
  });

  it("builds CCSwitch OpenAI imports with Codex app and model", () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        baseUrl: "https://api.example.com",
        platform: "openai",
        clientType: "claude",
        providerName: "Mikiko",
        apiKey: "sk-openai",
      }),
    );

    expect(params.get("app")).toBe("codex");
    expect(params.get("model")).toBe(OPENAI_CC_SWITCH_CODEX_MODEL);
    expect(params.get("endpoint")).toBe("https://api.example.com");
    expect(params.get("apiKey")).toBe("sk-openai");
  });

  it("builds CCSwitch Antigravity imports for the selected client", () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        baseUrl: "https://api.example.com",
        platform: "antigravity",
        clientType: "gemini",
        providerName: "Mikiko",
        apiKey: "sk-ag",
      }),
    );

    expect(params.get("app")).toBe("gemini");
    expect(params.get("endpoint")).toBe("https://api.example.com/antigravity");
    expect(params.has("model")).toBe(false);
  });
});
