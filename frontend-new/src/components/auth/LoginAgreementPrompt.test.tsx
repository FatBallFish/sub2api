import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import LoginAgreementPrompt from "./LoginAgreementPrompt";

const documents = [
  { id: "terms", title: "后台服务条款", content_md: "terms" },
  { id: "usage-policy", title: "后台使用政策", content_md: "policy" },
  { id: "custom-contract", title: "Customer Contract", content_md: "custom" },
];

describe("LoginAgreementPrompt", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("uses localized built-in titles in checkbox links and preserves custom titles", () => {
    render(
      <MemoryRouter>
        <LoginAgreementPrompt
          accepted={false}
          documents={documents}
          mode="checkbox"
          open={false}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "服务条款" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "使用政策" })).toHaveAttribute("href", "/legal/usage-policy");
    expect(screen.getByRole("link", { name: "Customer Contract" })).toHaveAttribute("href", "/legal/custom-contract");
  });

  it("uses localized built-in titles in the modal document list", () => {
    render(
      <MemoryRouter>
        <LoginAgreementPrompt
          accepted={false}
          documents={documents}
          mode="modal"
          open
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "服务条款" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "使用政策" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Customer Contract" })).toBeInTheDocument();
  });

  it("updates a mounted built-in document title when the locale changes", async () => {
    await i18n.changeLanguage("en");
    render(
      <MemoryRouter>
        <LoginAgreementPrompt
          accepted={false}
          documents={documents}
          mode="checkbox"
          open={false}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Terms of Service" })).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByRole("link", { name: "利用規約" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Terms of Service" })).not.toBeInTheDocument();
  });

  it("localizes all modal controls while preserving custom document titles", async () => {
    await i18n.changeLanguage("zh-TW");
    render(
      <MemoryRouter>
        <LoginAgreementPrompt
          accepted={false}
          documents={documents}
          mode="modal"
          open
          updatedAt="2026-08-10"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "檢閱服務條款" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "關閉條款" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接受並繼續" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒絕" })).toBeInTheDocument();
    expect(screen.getByText(/更新於 2026年8月10日/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Customer Contract" })).toBeInTheDocument();
  });

  it("uses locale-appropriate punctuation between Japanese document links", async () => {
    await i18n.changeLanguage("ja");
    render(
      <MemoryRouter>
        <LoginAgreementPrompt
          accepted={false}
          documents={documents}
          mode="checkbox"
          open={false}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );

    const label = screen.getByRole("checkbox").closest("label");
    expect(label).toHaveTextContent("利用規約、利用ポリシー、Customer Contract");
    expect(label).not.toHaveTextContent("利用規約, 利用ポリシー");
  });

  it("keeps an invalid custom update value unchanged", () => {
    render(
      <MemoryRouter>
        <LoginAgreementPrompt
          accepted={false}
          documents={documents}
          mode="modal"
          open
          updatedAt="release-42"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/更新于 release-42/)).toBeInTheDocument();
  });
});
