import { afterEach, describe, expect, it, vi } from "vitest";
import { getRedeemHistory, redeemCode } from "./redeem";

describe("redeem API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redeems a code and returns the resulting account values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        message: "Redeemed",
        type: "subscription",
        value: 30,
        new_balance: 42.5,
        new_concurrency: 8,
        group_name: "Claude Pro",
        validity_days: 30,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock;

    await expect(redeemCode("SUB-2026")).resolves.toMatchObject({
      type: "subscription",
      group_name: "Claude Pro",
      validity_days: 30,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/redeem",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "SUB-2026" }),
      }),
    );
  });

  it("loads redemption and administrator adjustment history", async () => {
    const history = [
      {
        id: 1,
        code: "BALANCE-1",
        type: "balance",
        value: 10,
        status: "used",
        used_at: "2026-08-25T04:00:00Z",
        created_at: "2026-08-24T04:00:00Z",
      },
      {
        id: 2,
        code: "",
        type: "admin_balance",
        value: -2,
        status: "used",
        used_at: "2026-08-25T05:00:00Z",
        created_at: "2026-08-25T05:00:00Z",
        notes: "Correction",
      },
      {
        id: 3,
        code: "SUB-1",
        type: "subscription",
        value: 30,
        status: "used",
        used_at: "2026-08-25T06:00:00Z",
        created_at: "2026-08-25T06:00:00Z",
        group_id: 9,
        validity_days: 30,
        group: { id: 9, name: "Claude Pro" },
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: history,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock;

    await expect(getRedeemHistory()).resolves.toEqual(history);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/redeem/history",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
