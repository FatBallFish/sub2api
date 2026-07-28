import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Privacy from "./Privacy";
import Terms from "./Terms";
import Team from "../Team";

function publicSettingsResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
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

    render(<Privacy />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Privacy Markdown" })).toBeInTheDocument();
    });
    expect(screen.getByText("No training")).toBeInTheDocument();
  });

  it("renders terms markdown from public settings", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(publicSettingsResponse());

    render(<Terms />);

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
});
