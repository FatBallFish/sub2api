import { describe, expect, it } from "vitest";
import {
  auditTranslationUsage,
  scanHardcodedCopy,
  type SourceDocument,
} from "./staticAnalysis";

function fixture(text: string): SourceDocument {
  return { file: "src/Fixture.tsx", text };
}

describe("hardcoded copy AST analysis", () => {
  it("detects compound UI feedback setters without flagging a technical status setter", () => {
    const findings = scanHardcodedCopy(fixture(`
      setActionError("Could not save changes");
      setLoadNotice(\`Loaded \${count} records\`);
      setFeedback("Settings saved for " + user);
      setKeyStatus("active");
    `));

    expect(findings.map(({ category, value }) => [category, value])).toEqual([
      ["ui-state", "Could not save changes"],
      ["ui-state", "Loaded ${...} records"],
      ["ui-state", "Settings saved for ${...}"],
    ]);
  });

  it("detects string templates and concatenation in JSX children and user-facing attributes", () => {
    const findings = scanHardcodedCopy(fixture(`
      function Example({ name }: { name: string }) {
        return <Panel
          message={"Welcome " + name}
          content={\`Plan \${name} is unavailable\`}
          text="Continue setup"
          subtitle={name + " details"}
        >
          <span>{"Hello " + name + "!"}</span>
        </Panel>;
      }
    `));

    expect(findings.map(({ category, value }) => [category, value])).toEqual([
      ["jsx-attribute", "Welcome ${...}"],
      ["jsx-attribute", "Plan ${...} is unavailable"],
      ["jsx-attribute", "Continue setup"],
      ["jsx-attribute", "${...} details"],
      ["jsx-expression", "Hello ${...}!"],
    ]);
  });

  it("detects expanded literal UI descriptor fields", () => {
    const findings = scanHardcodedCopy(fixture(`
      const notice = {
        message: "Payment " + status,
        content: \`Order \${reference} needs attention\`,
        text: "Try again",
        subtitle: "Billing notice",
      };
    `));

    expect(findings.map(({ category, value }) => [category, value])).toEqual([
      ["ui-descriptor", "Payment ${...}"],
      ["ui-descriptor", "Order ${...} needs attention"],
      ["ui-descriptor", "Try again"],
      ["ui-descriptor", "Billing notice"],
    ]);
  });
});

describe("translation usage AST analysis", () => {
  const pluralKeys = new Set([
    "console.referral.users_one",
    "console.referral.users_other",
  ]);

  it("requires count before a base call consumes a plural family", () => {
    const withoutCount = auditTranslationUsage([
      fixture(`
        const { t } = useTranslation("console");
        t("referral.users", { formattedCount: "2" });
      `),
    ], pluralKeys);

    expect([...withoutCount.used]).toEqual([]);
    expect(withoutCount.unused).toEqual([
      "console.referral.users_one",
      "console.referral.users_other",
    ]);
    expect(withoutCount.pluralMisuses).toEqual([
      "src/Fixture.tsx:3 plural key console.referral.users requires a count option",
    ]);

    const withCount = auditTranslationUsage([
      fixture(`
        const { t } = useTranslation("console");
        t("referral.users", { count: total, formattedCount: "2" });
      `),
    ], pluralKeys);

    expect([...withCount.used].sort()).toEqual([...pluralKeys].sort());
    expect(withCount.unused).toEqual([]);
    expect(withCount.pluralMisuses).toEqual([]);
  });

  it("does not treat a newly added uppercase resource as dynamically used", () => {
    const keys = new Set(["errors.KNOWN_CODE", "errors.NEW_UNUSED_CODE"]);
    const audit = auditTranslationUsage([], keys, new Set(["errors.KNOWN_CODE"]));

    expect(audit.unused).toEqual(["errors.NEW_UNUSED_CODE"]);
  });
});
