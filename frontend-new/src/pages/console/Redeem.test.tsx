import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import Redeem from "./Redeem";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400
    ? { success: true, data }
    : { success: false, message: data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const profile = { id: 7, balance: 18.75, concurrency: 6 };

describe("Redeem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows account state, all legacy history types, guidance, and contact information", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const history = [
      { id: 1, code: "BALANCE-1", type: "balance", value: 10, status: "used", used_at: "2026-08-25T04:00:00Z", created_at: "2026-08-24T04:00:00Z" },
      { id: 2, code: "", type: "admin_balance", value: -2, status: "used", used_at: "2026-08-25T05:00:00Z", created_at: "2026-08-25T05:00:00Z", notes: "Correction" },
      { id: 3, code: "CONCURRENT-1", type: "concurrency", value: 3, status: "used", used_at: "2026-08-25T06:00:00Z", created_at: "2026-08-25T06:00:00Z" },
      { id: 4, code: "", type: "admin_concurrency", value: -1, status: "used", used_at: "2026-08-25T07:00:00Z", created_at: "2026-08-25T07:00:00Z" },
      { id: 5, code: "SUB-1", type: "subscription", value: 30, status: "used", used_at: "2026-08-25T08:00:00Z", created_at: "2026-08-25T08:00:00Z", validity_days: 30, group: { id: 9, name: "Claude Pro" } },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/user/profile") return Promise.resolve(jsonResponse(profile));
      if (url === "/api/v1/redeem/history") return Promise.resolve(jsonResponse(history));
      if (url === "/api/v1/settings/public") return Promise.resolve(jsonResponse({ contact_info: "support@example.com" }));
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(<Redeem />);

    expect(screen.getByText("Loading redemption details...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Redeem Code", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("18.750000")).toBeInTheDocument();
    expect(screen.getByText("6 requests")).toBeInTheDocument();
    expect(screen.getByText("Each code can only be used once.")).toBeInTheDocument();
    expect(screen.getByText("Codes can add balance, increase concurrency, or grant subscription access.")).toBeInTheDocument();
    expect(screen.getByText("Contact support if you have trouble redeeming a code.")).toBeInTheDocument();
    expect(screen.getByText("Balance and concurrency updates take effect immediately.")).toBeInTheDocument();
    expect(screen.getByText("support@example.com")).toBeInTheDocument();
    expect(screen.getByText("Balance added by redemption")).toBeInTheDocument();
    expect(screen.getByText("Balance deducted by administrator")).toBeInTheDocument();
    expect(screen.getByText("Concurrency added by redemption")).toBeInTheDocument();
    expect(screen.getByText("Concurrency reduced by administrator")).toBeInTheDocument();
    expect(screen.getByText("Subscription assigned")).toBeInTheDocument();
    expect(screen.getByText("30 days · Claude Pro")).toBeInTheDocument();
    expect(screen.getByText("Correction")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Redeem code" })).toBeDisabled();
  });

  it("trims and redeems a code, then refreshes account state and history", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    let historyCalls = 0;
    let profileCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") return Promise.resolve(jsonResponse({}));
      if (url === "/api/v1/user/profile") {
        profileCalls += 1;
        return Promise.resolve(jsonResponse(profileCalls === 1 ? profile : { ...profile, balance: 23.75, concurrency: 8 }));
      }
      if (url === "/api/v1/redeem/history") {
        historyCalls += 1;
        return Promise.resolve(jsonResponse(historyCalls === 1 ? [] : [
          { id: 8, code: "BALANCE-NEW", type: "balance", value: 5, status: "used", used_at: "2026-08-25T09:00:00Z", created_at: "2026-08-25T09:00:00Z" },
        ]));
      }
      if (url === "/api/v1/redeem" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({
          message: "Redeemed",
          type: "balance",
          value: 5,
          new_balance: 23.75,
          new_concurrency: 8,
        }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(<Redeem />);
    const codeInput = await screen.findByLabelText("Redeem code");
    await userEvent.type(codeInput, "  BALANCE-NEW  ");
    await userEvent.click(screen.getByRole("button", { name: "Redeem code" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Code redeemed successfully");
    expect(codeInput).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/redeem",
      expect.objectContaining({ body: JSON.stringify({ code: "BALANCE-NEW" }) }),
    );
    expect(await screen.findByText("Balance added by redemption")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("23.750000")).toBeInTheDocument();
      expect(screen.getByText("8 requests")).toBeInTheDocument();
    });
    expect(historyCalls).toBe(2);
    expect(profileCalls).toBe(2);
  });

  it("shows a backend redemption error and permits retry", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/user/profile") return Promise.resolve(jsonResponse(profile));
      if (url === "/api/v1/redeem/history") return Promise.resolve(jsonResponse([]));
      if (url === "/api/v1/settings/public") return Promise.resolve(jsonResponse({}));
      if (url === "/api/v1/redeem") return Promise.resolve(jsonResponse("This code has already been used", 400));
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(<Redeem />);
    await userEvent.type(await screen.findByLabelText("Redeem code"), "USED-CODE");
    await userEvent.click(screen.getByRole("button", { name: "Redeem code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This code has already been used");
    expect(screen.getByRole("button", { name: "Redeem code" })).toBeEnabled();
  });
});
