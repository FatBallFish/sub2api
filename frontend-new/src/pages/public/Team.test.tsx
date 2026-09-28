import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import Team from "./Team";

describe("Team page", () => {
  it("renders Japanese fallback copy when no configured team document exists", async () => {
    await i18n.changeLanguage("ja");
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { login_agreement_enabled: false, login_agreement_documents: [] } }) });
    render(<Team />);

    expect(await screen.findByRole("heading", { name: "チームについて" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "運用を最優先" })).toBeInTheDocument();
    expect(document.title).toBe("チームについて | Mikiko CC");
  });
});
