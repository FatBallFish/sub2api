import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import Blog from "./Blog";

describe("Blog page", () => {
  it("renders Japanese fixed copy and locale-formatted post dates", async () => {
    await i18n.changeLanguage("ja");
    render(<Blog />);

    expect(screen.getByRole("heading", { name: "ブログと更新情報" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "記事を読む" })).toHaveLength(2);
    expect(screen.getByText("2026年6月18日")).toBeInTheDocument();
    expect(document.title).toBe("ブログ | Mikiko CC");
  });
});
