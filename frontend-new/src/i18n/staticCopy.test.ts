import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import { PLAYGROUND_ROLE_LABEL_KEYS } from "../api/playground";
import { ANNOUNCEMENT_CATEGORIES } from "../types/announcements";
import { CLIENT_CONFIG_HINT_KEYS } from "../utils/clientConfig";
import { BUILT_IN_AGREEMENT_TITLE_KEYS } from "../utils/loginAgreement";
import { GLOBAL_ERROR_CODES, SCOPED_ERROR_KEYS } from "../utils/localizedError";
import { BILLING_STATUS_LABEL_KEYS } from "../utils/paymentStatus";
import en from "./resources/en";
import {
  auditTranslationUsage,
  scanHardcodedCopy,
  type Finding,
  type FindingCategory,
  type SourceDocument,
} from "./staticAnalysis";

type ResourceTree = { readonly [key: string]: string | ResourceTree };

interface AllowlistEntry {
  category?: FindingCategory;
  file?: string;
  value: string;
  reason: string;
}

const RAW_SOURCE_MODULES = import.meta.glob("../**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

// Each exception must be an exact value, optionally scoped to one file/category. Keep
// these categories narrow so adding unrelated English or CJK UI copy still fails.
const HARDCODED_COPY_ALLOWLIST: readonly AllowlistEntry[] = [
  // Brand names are proper nouns and intentionally do not change between locales.
  { value: "Mikiko CC", reason: "Product brand name." },
  // Provider/client/protocol/model identifiers belong here only when the exact spelling is part of their contract.
  { value: "Claude Code", reason: "Official client name." },
  { value: "Gemini CLI", reason: "Official client name." },
  { value: "Google", reason: "OAuth provider name." },
  { value: "GitHub", reason: "OAuth provider name." },
  { value: "OAuth", reason: "Protocol name." },
  // URLs/input examples and code/config snippets are copied verbatim by users and must not be translated.
  { category: "jsx-attribute", value: "https://example.com/input.png", reason: "Image URL input example." },
  { category: "jsx-attribute", value: "name@company.com", reason: "Email input example." },
  { category: "jsx-text", value: "config.toml", reason: "Configuration filename." },
  {
    file: "src/pages/public/Home.tsx",
    category: "jsx-expression",
    value: "[model_providers.mikiko] name = \"Mikiko CC\" base_url = \"${...}\" api_key = \"sk-....9p3m\" [routing] model = \"claude-3-5-sonnet\" priority = 1 fallback = \"codex-turbo\"",
    reason: "Copyable TOML configuration example; identifiers and interpolated endpoint must remain verbatim.",
  },
  // CSS/routes/API field/status constants are implementation data, not rendered prose.
  { file: "src/pages/console/UsageHistory.tsx", category: "jsx-text", value: "&rarr;", reason: "Encoded arrow glyph, not copy." },
  // Truly non-UI technical exceptions require a precise file/value/category entry and an explanation.
  { file: "src/pages/console/InstallGuide.tsx", category: "ui-state", value: "selected API key is required", reason: "Internal rejected Promise detail; the UI renders its localized fallback key." },
  { file: "src/components/auth/AliyunCaptchaWidget.tsx", category: "ui-state", value: "Aliyun Captcha script ID is already used by another element.", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/AliyunCaptchaWidget.tsx", category: "ui-state", value: "Aliyun Captcha SDK is unavailable", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/AliyunCaptchaWidget.tsx", category: "ui-state", value: "Failed to load Aliyun Captcha SDK", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/AliyunCaptchaWidget.tsx", category: "ui-state", value: "Aliyun Captcha verification failed", reason: "Internal SDK diagnostic; callers replace it with localized captcha feedback." },
  { file: "src/components/auth/AliyunCaptchaWidget.tsx", category: "ui-state", value: "Aliyun Captcha initialization failed", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TencentCaptchaWidget.tsx", category: "ui-state", value: "Tencent Captcha script ID is already used by another element.", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TencentCaptchaWidget.tsx", category: "ui-state", value: "Tencent Captcha SDK is unavailable", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TencentCaptchaWidget.tsx", category: "ui-state", value: "Failed to load Tencent Captcha SDK", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TencentCaptchaWidget.tsx", category: "ui-state", value: "Tencent Captcha verification failed", reason: "Internal SDK diagnostic; callers replace it with localized captcha feedback." },
  { file: "src/components/auth/TencentCaptchaWidget.tsx", category: "ui-state", value: "Tencent Captcha initialization failed", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TurnstileWidget.tsx", category: "ui-state", value: "Turnstile script ID is already used by another element.", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TurnstileWidget.tsx", category: "ui-state", value: "Turnstile API was unavailable after the script loaded.", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TurnstileWidget.tsx", category: "ui-state", value: "Failed to load the Turnstile script.", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/components/auth/TurnstileWidget.tsx", category: "ui-state", value: "Failed to initialize Turnstile.", reason: "Internal SDK loader diagnostic; callers render localized captcha feedback." },
  { file: "src/api/client.ts", category: "ui-descriptor", value: "Request failed with status ${...}", reason: "Synthetic transport diagnostic; callers select a localized fallback by error code." },
  { file: "src/api/playground.ts", category: "ui-state", value: "Request failed with status ${...}", reason: "Internal gateway diagnostic; the playground renders its localized request failure fallback." },
  { file: "src/components/auth/captcha.ts", category: "ui-state", value: "Multiple captcha providers are enabled", reason: "Internal settings diagnostic; auth surfaces render localized captcha configuration feedback." },
  { file: "src/components/auth/captcha.ts", category: "ui-state", value: "Turnstile configuration is incomplete", reason: "Internal settings diagnostic; auth surfaces render localized captcha configuration feedback." },
  { file: "src/components/auth/captcha.ts", category: "ui-state", value: "Tencent captcha configuration is incomplete", reason: "Internal settings diagnostic; auth surfaces render localized captcha configuration feedback." },
  { file: "src/components/auth/captcha.ts", category: "ui-state", value: "Aliyun captcha configuration is incomplete", reason: "Internal settings diagnostic; auth surfaces render localized captcha configuration feedback." },
  { file: "src/pages/console/Billing.tsx", category: "jsx-expression", value: "USD", reason: "ISO 4217 fallback currency code." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "Codex CLI", reason: "Official client name." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "Codex CLI (WebSocket)", reason: "Official client and transport name." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "OpenCode", reason: "Official client name." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "macOS / Linux", reason: "Operating system names used as a technical platform selector." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "Windows", reason: "Operating system name used as a technical platform selector." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "Windows CMD", reason: "Operating system and shell names used as a technical platform selector." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "PowerShell", reason: "Official shell name." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "set ANTHROPIC_BASE_URL=${...} set ANTHROPIC_AUTH_TOKEN=${...} set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", reason: "Copyable command prompt configuration must remain verbatim." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "$env:ANTHROPIC_BASE_URL=\"${...}\" $env:ANTHROPIC_AUTH_TOKEN=\"${...}\" $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", reason: "Copyable PowerShell configuration must remain verbatim." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "export ANTHROPIC_BASE_URL=\"${...}\" export ANTHROPIC_AUTH_TOKEN=\"${...}\" export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", reason: "Copyable shell configuration must remain verbatim." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "set GOOGLE_GEMINI_BASE_URL=${...} set GEMINI_API_KEY=${...} set GEMINI_MODEL=${...}", reason: "Copyable command prompt configuration must remain verbatim." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "$env:GOOGLE_GEMINI_BASE_URL=\"${...}\" $env:GEMINI_API_KEY=\"${...}\" $env:GEMINI_MODEL=\"${...}\"", reason: "Copyable PowerShell configuration must remain verbatim." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "export GOOGLE_GEMINI_BASE_URL=\"${...}\" export GEMINI_API_KEY=\"${...}\" export GEMINI_MODEL=\"${...}\"", reason: "Copyable shell configuration must remain verbatim." },
  { file: "src/utils/clientConfig.ts", category: "ui-descriptor", value: "model_provider = \"OpenAI\" model = \"gpt-5.5\" review_model = \"gpt-5.5\" model_reasoning_effort = \"xhigh\" disable_response_storage = true network_access = \"enabled\" windows_wsl_setup_acknowledged = true [model_providers.OpenAI] name = \"OpenAI\" base_url = \"${...}\" wire_api = \"responses\"${...} requires_openai_auth = true [features]${...} goals = true", reason: "Copyable TOML configuration must remain verbatim." },
];

function productionFiles(extensions: ReadonlySet<string>): SourceDocument[] {
  return Object.entries(RAW_SOURCE_MODULES).flatMap(([modulePath, text]) => {
    const sourcePath = modulePath
      .replace(/^\.\.\/\.\//, "i18n/")
      .replace(/^\.\.\//, "")
      .replace(/^\.\//, "i18n/");
    if (/\.test\.|\.generated\./.test(sourcePath) || sourcePath === "test/setup.ts") return [];
    if (sourcePath.startsWith("assets/") || sourcePath.startsWith("i18n/resources/")) return [];
    const extension = sourcePath.endsWith(".tsx") ? ".tsx" : sourcePath.endsWith(".ts") ? ".ts" : "";
    return extensions.has(extension) ? [{ file: `src/${sourcePath}`, text }] : [];
  });
}

function isAllowlisted(finding: Finding): boolean {
  return HARDCODED_COPY_ALLOWLIST.some((entry) => entry.value === finding.value
    && (!entry.file || entry.file === finding.file)
    && (!entry.category || entry.category === finding.category));
}

function formatFindings(findings: readonly Finding[]): string {
  return findings
    .map(({ file, line, category, value }) => `${file}:${line} [${category}] ${JSON.stringify(value)}`)
    .join("\n");
}

function flattenResources(resource: ResourceTree, prefix = ""): Map<string, string> {
  const flattened = new Map<string, string>();
  for (const [key, value] of Object.entries(resource)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") flattened.set(path, value);
    else for (const [childKey, childValue] of flattenResources(value, path)) flattened.set(childKey, childValue);
  }
  return flattened;
}

interface DynamicTranslationContracts {
  agreementTitleKeys: readonly string[];
  billingStatusLabelKeys: readonly string[];
  clientConfigHintKeys: readonly string[];
  playgroundRoleLabelKeys: readonly string[];
}

function dynamicTranslationKeys(overrides: Partial<DynamicTranslationContracts> = {}): Set<string> {
  const contracts: DynamicTranslationContracts = {
    agreementTitleKeys: Object.values(BUILT_IN_AGREEMENT_TITLE_KEYS),
    billingStatusLabelKeys: Object.values(BILLING_STATUS_LABEL_KEYS),
    clientConfigHintKeys: Object.values(CLIENT_CONFIG_HINT_KEYS),
    playgroundRoleLabelKeys: Object.values(PLAYGROUND_ROLE_LABEL_KEYS),
    ...overrides,
  };
  return new Set([
    ...contracts.agreementTitleKeys.map((key) => `common.${key}`),
    ...contracts.billingStatusLabelKeys.map((key) => `console.${key}`),
    ...contracts.clientConfigHintKeys.map((key) => `console.${key}`),
    ...contracts.playgroundRoleLabelKeys.map((key) => `console.${key}`),
    // Runtime contracts below are finite typed values exported by production code.
    ...ANNOUNCEMENT_CATEGORIES.map((category) => `console.announcements.categories.${category}`),
    ...GLOBAL_ERROR_CODES.map((code) => `errors.${code}`),
    ...Object.values(SCOPED_ERROR_KEYS).map((key) => `errors.${key}`),
  ]);
}

describe("fixed frontend copy", () => {
  const sourceFiles = productionFiles(new Set([".ts", ".tsx"]));
  const resources = flattenResources(en);
  const dynamicKeys = dynamicTranslationKeys();

  it("keeps production TS and TSX user-facing copy behind i18n", () => {
    const findings = sourceFiles.flatMap(scanHardcodedCopy).filter((finding) => !isAllowlisted(finding));
    expect(formatFindings(findings), "Hardcoded user-facing copy found").toBe("");
  });

  it("uses a locale-neutral bootstrap document title", () => {
    const title = indexHtml.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    expect(title, "index.html title must remain brand-only before i18n initializes").toBe("Mikiko CC");
  });

  it("does not keep dead or incorrectly called translation leaves", () => {
    const audit = auditTranslationUsage(sourceFiles, new Set(resources.keys()), dynamicKeys);

    expect(audit.pluralMisuses.join("\n"), "Plural translation calls missing count").toBe("");
    expect(audit.unused.join("\n"), "Unused translation resources").toBe("");
    expect(
      [...dynamicKeys].filter((key) => !resources.has(key)),
      "Dynamic translation contracts must reference real resources",
    ).toEqual([]);
  });

  it("does not let new uppercase errors or announcement categories bypass usage checks", () => {
    const mutatedKeys = new Set([
      ...resources.keys(),
      "errors.NEW_UNUSED_CODE",
      "console.announcements.categories.security",
    ]);
    const audit = auditTranslationUsage(sourceFiles, mutatedKeys, dynamicKeys);

    expect(audit.unused).toEqual([
      "console.announcements.categories.security",
      "errors.NEW_UNUSED_CODE",
    ]);
  });

  it("exposes a resource as dead when a finite production contract drops its key", () => {
    const billingStatusLabelKeys = Object.values(BILLING_STATUS_LABEL_KEYS)
      .filter((key) => key !== "billing.statuses.completed");
    const audit = auditTranslationUsage(
      sourceFiles,
      new Set(resources.keys()),
      dynamicTranslationKeys({ billingStatusLabelKeys }),
    );

    expect(audit.unused).toEqual(["console.billing.statuses.completed"]);
  });
});
