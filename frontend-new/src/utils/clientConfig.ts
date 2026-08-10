export type GroupPlatform = "anthropic" | "openai" | "gemini" | "antigravity" | string;
export type CcSwitchClientType = "claude" | "gemini";
export type InstallClientId = "codex" | "codex-ws" | "claude" | "gemini" | "opencode";
export type InstallShellId = "unix" | "cmd" | "powershell" | "windows";
export type ClientConfigHintId = "claudeSettings" | "codexAuth" | "openCodeMerge";
export type ClientConfigDisplayTargetId = "commandPrompt" | "powershell" | "terminal";

export const CLIENT_CONFIG_HINT_KEYS = {
  claudeSettings: "installGuide.hintClaudeSettings",
  codexAuth: "installGuide.hintCodexAuth",
  openCodeMerge: "installGuide.hintOpenCode",
} as const satisfies Record<ClientConfigHintId, string>;

export const CLIENT_CONFIG_DISPLAY_TARGET_KEYS = {
  commandPrompt: "installGuide.targets.commandPrompt",
  powershell: "installGuide.targets.powershell",
  terminal: "installGuide.targets.terminal",
} as const satisfies Record<ClientConfigDisplayTargetId, `installGuide.targets.${ClientConfigDisplayTargetId}`>;

export interface InstallClientOption {
  id: InstallClientId;
  label: string;
}

export interface InstallShellOption {
  id: InstallShellId;
  label: string;
}

interface ClientConfigFileBase {
  content: string;
  hintId?: ClientConfigHintId;
}

export type ClientConfigFile = ClientConfigFileBase & (
  | { path: string; displayTargetId?: never }
  | { path?: never; displayTargetId: ClientConfigDisplayTargetId }
);

export interface BuildClientConfigInput {
  platform?: GroupPlatform | null;
  clientId: InstallClientId;
  shellId: InstallShellId;
  baseUrl: string;
  apiKey: string;
}

export interface CcSwitchImportInput {
  baseUrl: string;
  platform?: GroupPlatform | null;
  clientType: CcSwitchClientType;
  providerName: string;
  apiKey: string;
}

export const OPENAI_CC_SWITCH_CODEX_MODEL = "gpt-5.4";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function gatewayBaseUrl(apiBaseUrl?: string) {
  const configured = (apiBaseUrl || "").trim();
  return trimTrailingSlash(configured || window.location.origin);
}

function ensureV1(value: string) {
  const trimmed = trimTrailingSlash(value);
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function ensureV1Beta(value: string) {
  const trimmed = trimTrailingSlash(value);
  return trimmed.endsWith("/v1beta") ? trimmed : `${trimmed}/v1beta`;
}

export function getInstallClientOptions(platform?: GroupPlatform | null, allowMessagesDispatch = false): InstallClientOption[] {
  switch (platform || "anthropic") {
    case "openai": {
      const options: InstallClientOption[] = [
        { id: "codex", label: "Codex CLI" },
        { id: "codex-ws", label: "Codex CLI (WebSocket)" },
      ];
      if (allowMessagesDispatch) options.push({ id: "claude", label: "Claude Code" });
      options.push({ id: "opencode", label: "OpenCode" });
      return options;
    }
    case "gemini":
      return [
        { id: "gemini", label: "Gemini CLI" },
        { id: "opencode", label: "OpenCode" },
      ];
    case "antigravity":
      return [
        { id: "claude", label: "Claude Code" },
        { id: "gemini", label: "Gemini CLI" },
        { id: "opencode", label: "OpenCode" },
      ];
    default:
      return [
        { id: "claude", label: "Claude Code" },
        { id: "opencode", label: "OpenCode" },
      ];
  }
}

export function getInstallShellOptions(clientId: InstallClientId): InstallShellOption[] {
  if (clientId === "opencode") return [];
  if (clientId === "codex" || clientId === "codex-ws") {
    return [
      { id: "unix", label: "macOS / Linux" },
      { id: "windows", label: "Windows" },
    ];
  }
  return [
    { id: "unix", label: "macOS / Linux" },
    { id: "cmd", label: "Windows CMD" },
    { id: "powershell", label: "PowerShell" },
  ];
}

export function normalizeClientForPlatform(
  platform: GroupPlatform | undefined | null,
  clientId: InstallClientId,
  allowMessagesDispatch = false,
) {
  const options = getInstallClientOptions(platform, allowMessagesDispatch);
  return options.some((option) => option.id === clientId) ? clientId : options[0]?.id ?? "claude";
}

export function normalizeShellForClient(clientId: InstallClientId, shellId: InstallShellId) {
  const options = getInstallShellOptions(clientId);
  if (options.length === 0) return "unix";
  return options.some((option) => option.id === shellId) ? shellId : options[0].id;
}

export function buildClientConfigFiles(input: BuildClientConfigInput): ClientConfigFile[] {
  const platform = input.platform || "anthropic";
  const baseRoot = gatewayBaseUrl(input.baseUrl);
  const apiBase = ensureV1(baseRoot);
  const apiKey = input.apiKey;
  const shellId = normalizeShellForClient(input.clientId, input.shellId);

  if (input.clientId === "opencode") {
    if (platform === "gemini") return [generateOpenCodeConfig("gemini", ensureV1Beta(baseRoot), apiKey)];
    if (platform === "openai") return [generateOpenCodeConfig("openai", apiBase, apiKey)];
    if (platform === "antigravity") {
      return [
        generateOpenCodeConfig("antigravity-claude", ensureV1(`${baseRoot}/antigravity`), apiKey, "opencode.json (Claude)"),
        generateOpenCodeConfig("antigravity-gemini", ensureV1Beta(`${baseRoot}/antigravity`), apiKey, "opencode.json (Gemini)"),
      ];
    }
    return [generateOpenCodeConfig("anthropic", apiBase, apiKey)];
  }

  if (input.clientId === "codex" || input.clientId === "codex-ws") {
    return generateCodexFiles(apiBase, apiKey, shellId, input.clientId === "codex-ws");
  }

  if (input.clientId === "gemini") {
    const geminiBase = platform === "antigravity" ? ensureV1Beta(`${baseRoot}/antigravity`) : ensureV1Beta(baseRoot);
    return [generateGeminiCliFile(geminiBase, apiKey, shellId)];
  }

  const claudeBase = platform === "antigravity" ? ensureV1(`${baseRoot}/antigravity`) : apiBase;
  return generateClaudeFiles(claudeBase, apiKey, shellId);
}

function generateClaudeFiles(baseUrl: string, apiKey: string, shellId: InstallShellId): ClientConfigFile[] {
  if (shellId === "cmd") {
    return [
      {
        displayTargetId: "commandPrompt",
        content: `set ANTHROPIC_BASE_URL=${baseUrl}
set ANTHROPIC_AUTH_TOKEN=${apiKey}
set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
      },
      {
        path: "%userprofile%\\.claude\\settings.json",
        content: claudeSettingsContent(baseUrl, apiKey),
        hintId: "claudeSettings",
      },
    ];
  }

  if (shellId === "powershell") {
    return [
      {
        displayTargetId: "powershell",
        content: `$env:ANTHROPIC_BASE_URL="${baseUrl}"
$env:ANTHROPIC_AUTH_TOKEN="${apiKey}"
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
      },
      {
        path: "%userprofile%\\.claude\\settings.json",
        content: claudeSettingsContent(baseUrl, apiKey),
        hintId: "claudeSettings",
      },
    ];
  }

  return [
    {
      displayTargetId: "terminal",
      content: `export ANTHROPIC_BASE_URL="${baseUrl}"
export ANTHROPIC_AUTH_TOKEN="${apiKey}"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
    },
    {
      path: "~/.claude/settings.json",
      content: claudeSettingsContent(baseUrl, apiKey),
      hintId: "claudeSettings",
    },
  ];
}

function claudeSettingsContent(baseUrl: string, apiKey: string) {
  return JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
      },
    },
    null,
    2,
  );
}

function generateGeminiCliFile(baseUrl: string, apiKey: string, shellId: InstallShellId): ClientConfigFile {
  const model = "gemini-2.0-flash";
  if (shellId === "cmd") {
    return {
      displayTargetId: "commandPrompt",
      content: `set GOOGLE_GEMINI_BASE_URL=${baseUrl}
set GEMINI_API_KEY=${apiKey}
set GEMINI_MODEL=${model}`,
    };
  }
  if (shellId === "powershell") {
    return {
      displayTargetId: "powershell",
      content: `$env:GOOGLE_GEMINI_BASE_URL="${baseUrl}"
$env:GEMINI_API_KEY="${apiKey}"
$env:GEMINI_MODEL="${model}"`,
    };
  }
  return {
    displayTargetId: "terminal",
    content: `export GOOGLE_GEMINI_BASE_URL="${baseUrl}"
export GEMINI_API_KEY="${apiKey}"
export GEMINI_MODEL="${model}"`,
  };
}

function generateCodexFiles(baseUrl: string, apiKey: string, shellId: InstallShellId, websockets: boolean): ClientConfigFile[] {
  const configDir = shellId === "windows" ? "%userprofile%\\.codex" : "~/.codex";
  return [
    {
      path: `${configDir}/config.toml`,
      content: `model_provider = "OpenAI"
model = "gpt-5.5"
review_model = "gpt-5.5"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true

[model_providers.OpenAI]
name = "OpenAI"
base_url = "${baseUrl}"
wire_api = "responses"${websockets ? "\nsupports_websockets = true" : ""}
requires_openai_auth = true

[features]${websockets ? "\nresponses_websockets_v2 = true" : ""}
goals = true`,
      hintId: "codexAuth",
    },
    {
      path: `${configDir}/auth.json`,
      content: JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2),
    },
  ];
}

function generateOpenCodeConfig(platform: string, baseUrl: string, apiKey: string, pathLabel = "opencode.json"): ClientConfigFile {
  const providerKey = platform;
  const provider: Record<string, unknown> = {
    [providerKey]: {
      ...(platform === "gemini" ? { npm: "@ai-sdk/google" } : {}),
      ...(platform === "anthropic" || platform === "antigravity-claude" ? { npm: "@ai-sdk/anthropic" } : {}),
      ...(platform === "antigravity-claude" ? { name: "Antigravity (Claude)" } : {}),
      ...(platform === "antigravity-gemini" ? { npm: "@ai-sdk/google", name: "Antigravity (Gemini)" } : {}),
      options: {
        baseURL: baseUrl,
        apiKey,
      },
    },
  };

  return {
    path: pathLabel,
    content: JSON.stringify(
      {
        provider,
        ...(platform === "openai"
          ? {
              agent: {
                build: { options: { store: false } },
                plan: { options: { store: false } },
              },
            }
          : {}),
        $schema: "https://opencode.ai/config.json",
      },
      null,
      2,
    ),
    hintId: "openCodeMerge",
  };
}

export function buildCcSwitchUsageScript() {
  return `({
  request: {
    url: "{{baseUrl}}/v1/usage",
    method: "GET",
    headers: { "Authorization": "Bearer {{apiKey}}" }
  },
  extractor: function(response) {
    const remaining = response?.remaining ?? response?.quota?.remaining ?? response?.balance;
    const unit = response?.unit ?? response?.quota?.unit ?? "USD";
    return {
      isValid: response?.is_active ?? response?.isValid ?? true,
      remaining,
      unit
    };
  }
})`;
}

export function buildCcSwitchImportDeeplink(input: CcSwitchImportInput) {
  const platform = input.platform || "anthropic";
  const baseUrl = gatewayBaseUrl(input.baseUrl);
  let app = "claude";
  let endpoint = baseUrl;
  let model: string | undefined;

  if (platform === "openai") {
    app = "codex";
    model = OPENAI_CC_SWITCH_CODEX_MODEL;
  } else if (platform === "gemini") {
    app = "gemini";
  } else if (platform === "antigravity") {
    app = input.clientType === "gemini" ? "gemini" : "claude";
    endpoint = `${baseUrl}/antigravity`;
  }

  const entries: [string, string][] = [
    ["resource", "provider"],
    ["app", app],
    ["name", input.providerName],
    ["homepage", baseUrl],
    ["endpoint", endpoint],
    ["apiKey", input.apiKey],
    ["configFormat", "json"],
    ["usageEnabled", "true"],
    ["usageScript", btoa(buildCcSwitchUsageScript())],
    ["usageAutoInterval", "30"],
  ];

  if (model) entries.splice(2, 0, ["model", model]);

  return `ccswitch://v1/import?${new URLSearchParams(entries).toString()}`;
}
