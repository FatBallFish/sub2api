import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import en from "./resources/en";

type ResourceTree = { readonly [key: string]: string | ResourceTree };
type FindingCategory = "jsx-text" | "jsx-expression" | "jsx-attribute" | "ui-state" | "ui-descriptor";

interface Finding {
  category: FindingCategory;
  file: string;
  line: number;
  value: string;
}

interface AllowlistEntry {
  category?: FindingCategory;
  file?: string;
  value: string;
  reason: string;
}

interface SourceDocument {
  file: string;
  text: string;
}

const RAW_SOURCE_MODULES = import.meta.glob("../**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const USER_FACING_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "placeholder",
  "title",
  "alt",
  "label",
  "description",
  "heading",
  "buttonText",
  "emptyText",
  "helpText",
  "tooltip",
  "caption",
  "summary",
]);
const UI_STATE_CALLS = new Set(["Error", "setError", "setStatus", "setMessage"]);
const UI_DESCRIPTOR_FIELDS = new Set([
  "label",
  "title",
  "description",
  "heading",
  "buttonText",
  "emptyText",
  "helpText",
  "tooltip",
  "caption",
  "summary",
]);

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

function normalizedCopy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeCopy(value: string): boolean {
  return /[A-Za-z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function literalValue(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return normalizedCopy(node.text);
  return null;
}

function literalBranches(node: ts.Node | undefined): string[] {
  const literal = literalValue(node);
  if (literal !== null) return [literal];
  if (node && ts.isConditionalExpression(node)) {
    return [...literalBranches(node.whenTrue), ...literalBranches(node.whenFalse)];
  }
  return [];
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function callName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function scanHardcodedCopy(source: SourceDocument): Finding[] {
  const sourceFile = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];

  const report = (node: ts.Node, category: FindingCategory, rawValue: string) => {
    const value = normalizedCopy(rawValue);
    if (!value || !looksLikeCopy(value)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      category,
      file: source.file,
      line: line + 1,
      value,
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      report(node, "jsx-text", node.text);
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      for (const value of literalBranches(node.expression)) report(node, "jsx-expression", value);
    } else if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) report(node, "jsx-attribute", initializer.text);
      if (initializer && ts.isJsxExpression(initializer)) {
        for (const value of literalBranches(initializer.expression)) report(node, "jsx-attribute", value);
      }
    } else if (ts.isCallExpression(node) && UI_STATE_CALLS.has(callName(node.expression) ?? "")) {
      for (const value of literalBranches(node.arguments[0])) report(node, "ui-state", value);
    } else if (ts.isNewExpression(node) && UI_STATE_CALLS.has(callName(node.expression) ?? "")) {
      for (const value of literalBranches(node.arguments?.[0])) report(node, "ui-state", value);
    } else if (ts.isPropertyAssignment(node) && UI_DESCRIPTOR_FIELDS.has(propertyName(node.name) ?? "")) {
      for (const value of literalBranches(node.initializer)) report(node, "ui-descriptor", value);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
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

function translationFunctions(sourceFile: ts.SourceFile): Map<string, string> {
  const functions = new Map<string, string>();

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "useTranslation") {
      const namespace = literalValue(node.initializer.arguments[0]) ?? "common";
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        if ((propertyName(element.propertyName) ?? element.name.text) === "t") {
          functions.set(element.name.text, namespace);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
}

function collectTranslationUsage(files: readonly SourceDocument[], resourceKeys: ReadonlySet<string>): Set<string> {
  const used = new Set<string>();

  const addKey = (key: string, namespace?: string) => {
    const fullKey = key.includes(":") ? key.replace(":", ".") : `${namespace ?? "common"}.${key}`;
    if (resourceKeys.has(fullKey)) used.add(fullKey);
    for (const pluralSuffix of ["_one", "_other", "_zero", "_few", "_many"]) {
      if (resourceKeys.has(`${fullKey}${pluralSuffix}`)) used.add(`${fullKey}${pluralSuffix}`);
    }
  };

  for (const file of files) {
    const sourceFile = ts.createSourceFile(file.file, file.text, ts.ScriptTarget.Latest, true, file.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const functions = translationFunctions(sourceFile);

    const namespaceOption = (node: ts.Expression | undefined): string | undefined => {
      if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property.name) === "ns") {
          return literalValue(property.initializer) ?? undefined;
        }
      }
      return undefined;
    };

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression);
        const keys = literalBranches(node.arguments[0]);
        if (name === "translationMessage") for (const key of keys) addKey(key);
        if (name === "errorMessage") {
          for (const fallback of literalBranches(node.arguments[1])) addKey(fallback, "errors");
        }
        if (name === "localizedErrorMessage") {
          for (const fallback of literalBranches(node.arguments[1])) addKey(fallback, "errors");
        }
        if (name && functions.has(name)) {
          const namespace = namespaceOption(node.arguments[1]) ?? functions.get(name);
          for (const key of keys) addKey(key, namespace);
        }
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "t") {
          for (const key of keys) if (key.includes(":")) addKey(key);
        }
      } else if (ts.isPropertyAssignment(node)) {
        const name = propertyName(node.name);
        const value = literalValue(node.initializer);
        if (value && (name === "labelKey" || name === "translationKey")) {
          const namespaces = [...functions.values()];
          addKey(value, namespaces.length === 1 ? namespaces[0] : "common");
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return used;
}

describe("fixed frontend copy", () => {
  const tsxFiles = productionFiles(new Set([".tsx"]));

  it("keeps production TSX user-facing copy behind i18n", () => {
    const findings = tsxFiles.flatMap(scanHardcodedCopy).filter((finding) => !isAllowlisted(finding));
    expect(formatFindings(findings), "Hardcoded user-facing copy found").toBe("");
  });

  it("uses a locale-neutral bootstrap document title", () => {
    const title = indexHtml.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    expect(title, "index.html title must remain brand-only before i18n initializes").toBe("Mikiko CC");
  });

  it("does not keep dead translation leaves", () => {
    const resources = flattenResources(en);
    const sourceFiles = productionFiles(new Set([".ts", ".tsx"]));
    const used = collectTranslationUsage(sourceFiles, new Set(resources.keys()));

    // Backend error codes are looked up by their exact runtime error.code value.
    const dynamicErrorCode = (key: string) => /^errors\.[A-Z][A-Z0-9_]+$/.test(key);
    // These exact keys are selected by finite ID/status/role maps at runtime.
    const dynamicKeys = new Set([
      "common.legalDocuments.terms",
      "common.legalDocuments.usagePolicy",
      "common.legalDocuments.supportedRegions",
      "common.legalDocuments.serviceSpecificTerms",
      "errors.scoped.auth.INVALID_USER",
      "errors.scoped.affiliate.INVALID_USER",
      "errors.scoped.payment.DAILY_LIMIT_EXCEEDED",
      "errors.scoped.payment.INVALID_AMOUNT",
      "errors.scoped.payment.INVALID_STATUS",
      "errors.scoped.payment.NOT_FOUND",
      "errors.scoped.subscription.DAILY_LIMIT_EXCEEDED",
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
    ]);
    // Announcement categories are backend values addressed as categories.${category}.
    const dynamicPrefixes = ["console.announcements.categories."];
    const unused = [...resources.keys()].filter((key) => !used.has(key)
      && !dynamicErrorCode(key)
      && !dynamicKeys.has(key)
      && !dynamicPrefixes.some((prefix) => key.startsWith(prefix)));

    expect(unused.join("\n"), "Unused translation resources (remove or document precise dynamic addressing)").toBe("");
  });
});
