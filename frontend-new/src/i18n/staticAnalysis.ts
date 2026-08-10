import * as ts from "typescript";
import { PLURAL_SUFFIXES } from "./resourceIntegrity";

export type FindingCategory = "jsx-text" | "jsx-expression" | "jsx-attribute" | "ui-state" | "ui-descriptor";

export interface Finding {
  category: FindingCategory;
  file: string;
  line: number;
  value: string;
}

export interface SourceDocument {
  file: string;
  text: string;
}

export interface TranslationUsageAudit {
  used: Set<string>;
  unused: string[];
  pluralMisuses: string[];
}

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
  "message",
  "content",
  "text",
  "subtitle",
]);
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
  "message",
  "content",
  "text",
  "subtitle",
]);
const NON_UI_STATE_SETTERS = new Set([
  // These update API-key filter/status data, never rendered feedback copy.
  "setActiveStatus",
  "setKeyStatus",
]);

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

function literalAlternatives(node: ts.Node | undefined): string[] {
  const literal = literalValue(node);
  if (literal !== null) return [literal];
  if (node && ts.isConditionalExpression(node)) {
    return [...literalAlternatives(node.whenTrue), ...literalAlternatives(node.whenFalse)];
  }
  if (node && ts.isParenthesizedExpression(node)) return literalAlternatives(node.expression);
  return [];
}

interface ExpressionSkeleton {
  hasLiteral: boolean;
  value: string;
}

function expressionSkeleton(node: ts.Expression): ExpressionSkeleton {
  if (ts.isParenthesizedExpression(node)) return expressionSkeleton(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { hasLiteral: true, value: node.text };
  }
  if (ts.isTemplateExpression(node)) {
    return {
      hasLiteral: true,
      value: node.head.text + node.templateSpans.map((span) => `\${...}${span.literal.text}`).join(""),
    };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionSkeleton(node.left);
    const right = expressionSkeleton(node.right);
    return {
      hasLiteral: left.hasLiteral || right.hasLiteral,
      value: left.value + right.value,
    };
  }
  return { hasLiteral: false, value: "${...}" };
}

function stringExpressionValues(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  if (ts.isConditionalExpression(node)) {
    return [...stringExpressionValues(node.whenTrue), ...stringExpressionValues(node.whenFalse)];
  }
  const skeleton = expressionSkeleton(node);
  return skeleton.hasLiteral ? [normalizedCopy(skeleton.value)] : [];
}

function propertyName(node: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function callName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function isUiStateSetter(name: string): boolean {
  if (name === "Error") return true;
  if (NON_UI_STATE_SETTERS.has(name)) return false;
  return /^set(?:[A-Z][A-Za-z0-9]*)?(?:Error|Status|Message|Notice|Alert|Feedback)$/.test(name);
}

export function scanHardcodedCopy(source: SourceDocument): Finding[] {
  const sourceFile = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];

  const report = (node: ts.Node, category: FindingCategory, rawValue: string) => {
    const value = normalizedCopy(rawValue);
    if (!value || !looksLikeCopy(value)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({ category, file: source.file, line: line + 1, value });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      report(node, "jsx-text", node.text);
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      for (const value of stringExpressionValues(node.expression)) report(node, "jsx-expression", value);
    } else if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) report(node, "jsx-attribute", initializer.text);
      if (initializer && ts.isJsxExpression(initializer)) {
        for (const value of stringExpressionValues(initializer.expression)) report(node, "jsx-attribute", value);
      }
    } else if (ts.isCallExpression(node) && isUiStateSetter(callName(node.expression) ?? "")) {
      for (const value of stringExpressionValues(node.arguments[0])) report(node, "ui-state", value);
    } else if (ts.isNewExpression(node) && callName(node.expression) === "Error") {
      for (const value of stringExpressionValues(node.arguments?.[0])) report(node, "ui-state", value);
    } else if (ts.isPropertyAssignment(node) && UI_DESCRIPTOR_FIELDS.has(propertyName(node.name) ?? "")) {
      for (const value of stringExpressionValues(node.initializer)) report(node, "ui-descriptor", value);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
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

function objectHasProperty(node: ts.Expression | undefined, key: string): boolean {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => (
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
      && propertyName(property.name) === key
  ));
}

function namespaceOption(node: ts.Expression | undefined): string | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === "ns") {
      return literalValue(property.initializer) ?? undefined;
    }
  }
  return undefined;
}

export function auditTranslationUsage(
  files: readonly SourceDocument[],
  resourceKeys: ReadonlySet<string>,
  dynamicKeys: ReadonlySet<string> = new Set(),
): TranslationUsageAudit {
  const used = new Set<string>();
  const pluralMisuses = new Set<string>();

  const addKey = (
    key: string,
    namespace: string | undefined,
    hasCount: boolean,
    node: ts.Node,
    sourceFile: ts.SourceFile,
    file: string,
  ) => {
    const fullKey = key.includes(":") ? key.replace(":", ".") : `${namespace ?? "common"}.${key}`;
    if (resourceKeys.has(fullKey)) used.add(fullKey);
    const pluralKeys = PLURAL_SUFFIXES
      .map((suffix) => `${fullKey}_${suffix}`)
      .filter((pluralKey) => resourceKeys.has(pluralKey));
    if (pluralKeys.length === 0) return;
    if (hasCount) {
      for (const pluralKey of pluralKeys) used.add(pluralKey);
      return;
    }
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    pluralMisuses.add(`${file}:${line + 1} plural key ${fullKey} requires a count option`);
  };

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file.file,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      file.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const functions = translationFunctions(sourceFile);

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression);
        const keys = literalAlternatives(node.arguments[0]);
        const hasCount = objectHasProperty(node.arguments[1], "count");
        if (name === "translationMessage") {
          for (const key of keys) addKey(key, undefined, hasCount, node, sourceFile, file.file);
        }
        if (name === "errorMessage" || name === "localizedErrorMessage") {
          for (const fallback of literalAlternatives(node.arguments[1])) {
            addKey(fallback, "errors", false, node, sourceFile, file.file);
          }
        }
        if (name && functions.has(name)) {
          const namespace = namespaceOption(node.arguments[1]) ?? functions.get(name);
          for (const key of keys) addKey(key, namespace, hasCount, node, sourceFile, file.file);
        }
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "t") {
          for (const key of keys) {
            if (key.includes(":")) addKey(key, undefined, hasCount, node, sourceFile, file.file);
          }
        }
      } else if (ts.isPropertyAssignment(node)) {
        const name = propertyName(node.name);
        const value = literalValue(node.initializer);
        if (value && (name === "labelKey" || name === "translationKey")) {
          const namespaces = [...functions.values()];
          addKey(value, namespaces.length === 1 ? namespaces[0] : "common", false, node, sourceFile, file.file);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return {
    used,
    unused: [...resourceKeys].filter((key) => !used.has(key) && !dynamicKeys.has(key)).sort(),
    pluralMisuses: [...pluralMisuses].sort(),
  };
}
