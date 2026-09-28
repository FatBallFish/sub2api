import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { resolveLocalizedMessage, translationMessage } from "./localizedMessage";

describe("localizedMessage", () => {
  it("keeps interpolation values while resolving with the active locale", async () => {
    const message = translationMessage("console:apiKeys.created", { name: "Tokyo Client" });

    await i18n.changeLanguage("zh-CN");
    expect(resolveLocalizedMessage(message)).toBe("已创建 API 密钥“Tokyo Client”。");

    await i18n.changeLanguage("ja");
    expect(resolveLocalizedMessage(message)).toBe("API キー「Tokyo Client」を作成しました。");
  });
});
