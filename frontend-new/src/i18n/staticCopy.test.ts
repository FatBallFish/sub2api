import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import { ANNOUNCEMENT_CATEGORIES } from "../types/announcements";
import { GLOBAL_ERROR_CODES, SCOPED_ERROR_KEYS } from "../utils/localizedError";
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
];

function productionFiles(extensions: ReadonlySet<string>): SourceDocument[] {
  return Object.entries(RAW_SOURCE_MODULES).flatMap(([modulePath, text]) => {
    const sourcePath = modulePath.replace(/^\.\.\//, "");
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

function dynamicTranslationKeys(): Set<string> {
  return new Set([
    // Agreement IDs map to this finite title family in utils/loginAgreement.ts.
    "common.legalDocuments.terms",
    "common.legalDocuments.usagePolicy",
    "common.legalDocuments.supportedRegions",
    "common.legalDocuments.serviceSpecificTerms",
    // These keys are selected by finite status/hint/role maps in their page modules.
    "console.billing.statuses.completed",
    "console.billing.statuses.paid",
    "console.billing.statuses.pending",
    "console.billing.statuses.recharging",
    "console.billing.statuses.cancelled",
    "console.billing.statuses.expired",
    "console.billing.statuses.failed",
    "console.billing.statuses.refundRequested",
    "console.billing.statuses.refunding",
    "console.billing.statuses.refundPending",
    "console.billing.statuses.partiallyRefunded",
    "console.billing.statuses.refunded",
    "console.billing.statuses.refundFailed",
    "console.installGuide.hintClaudeSettings",
    "console.installGuide.hintCodexAuth",
    "console.installGuide.hintOpenCode",
    "console.playground.role.user",
    "console.playground.role.assistant",
    "console.playground.role.system",
    // Runtime contracts below are finite typed values exported by production code.
    ...ANNOUNCEMENT_CATEGORIES.map((category) => `console.announcements.categories.${category}`),
    ...GLOBAL_ERROR_CODES.map((code) => `errors.${code}`),
    ...Object.values(SCOPED_ERROR_KEYS).map((key) => `errors.${key}`),
  ]);
}

describe("fixed frontend copy", () => {
  const tsxFiles = productionFiles(new Set([".tsx"]));
  const sourceFiles = productionFiles(new Set([".ts", ".tsx"]));
  const resources = flattenResources(en);
  const dynamicKeys = dynamicTranslationKeys();

  it("keeps production TSX user-facing copy behind i18n", () => {
    const findings = tsxFiles.flatMap(scanHardcodedCopy).filter((finding) => !isAllowlisted(finding));
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
});
