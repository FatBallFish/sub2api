import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import Privacy from "./Privacy";
import Terms from "./Terms";
import LegalDocument from "./LegalDocument";
import Team from "../Team";

function publicSettingsResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        login_agreement_enabled: true,
        login_agreement_updated_at: "2026-06-19",
        login_agreement_documents: [
          { id: "terms", title: "Terms of Service", content_md: "## Terms Markdown\n\n- Acceptable use" },
          { id: "privacy", title: "Privacy Policy", content_md: "## Privacy Markdown\n\n**No training** by default." },
          { id: "team", title: "Team", content_md: "## Team Markdown\n\nOperator-led support." },
        ],
      },
    }),
  };
}

describe("public markdown pages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders privacy markdown from public settings", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(publicSettingsResponse());

    render(<MemoryRouter><Privacy /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Privacy Markdown" })).toBeInTheDocument();
    });
    expect(screen.getByText("No training")).toBeInTheDocument();
  });

  it("renders terms markdown from public settings", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(publicSettingsResponse());

    render(<MemoryRouter><Terms /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Terms Markdown" })).toBeInTheDocument();
    });
    expect(screen.getByText("Acceptable use")).toBeInTheDocument();
  });

  it("renders team markdown from public settings", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(publicSettingsResponse());

    render(<Team />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Team Markdown" })).toBeInTheDocument();
    });
    expect(screen.getByText("Operator-led support.")).toBeInTheDocument();
  });

  it("renders every configured agreement document by id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(publicSettingsResponse());

    render(
      <MemoryRouter initialEntries={["/legal/terms"]}>
        <Routes>
          <Route path="/legal/:documentId" element={<LegalDocument />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Terms Markdown" })).toBeInTheDocument();
  });

  it("localizes built-in document headings without translating backend markdown", async () => {
    await i18n.changeLanguage("ja");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          login_agreement_enabled: true,
          login_agreement_documents: [
            { id: "terms", title: "后台服务条款", content_md: "## Backend Markdown\n\nDo not translate this body." },
          ],
        },
      }),
    });

    render(
      <MemoryRouter initialEntries={["/legal/terms"]}>
        <Routes>
          <Route path="/legal/:documentId" element={<LegalDocument />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "利用規約", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Backend Markdown" })).toBeInTheDocument();
    expect(screen.getByText("Do not translate this body.")).toBeInTheDocument();
  });

  it("redirects legal routes home when the agreement is disabled", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          login_agreement_enabled: false,
          login_agreement_documents: [
            { id: "privacy", title: "Privacy Policy", content_md: "Should stay hidden" },
          ],
        },
      }),
    });

    render(
      <MemoryRouter initialEntries={["/privacy"]}>
        <Routes>
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/" element={<div>Landing Home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Landing Home")).toBeInTheDocument();
    expect(screen.queryByText("Should stay hidden")).not.toBeInTheDocument();
  });
});
