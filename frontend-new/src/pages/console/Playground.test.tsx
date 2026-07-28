import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Playground from "./Playground";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Playground", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads credentials, sends a chat request, renders generated images, and resets local data", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/keys?page=1&page_size=50&status=active")) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 100,
                key: "sk-....test",
                name: "Playground Key",
                group_id: 10,
                group: { id: 10, name: "OpenAI" },
                status: "active",
                quota: 0,
                quota_used: 0,
                last_used_at: null,
                created_at: "2026-06-20T00:00:00Z",
                updated_at: "2026-06-20T00:00:00Z",
              },
            ],
            total: 1,
            page: 1,
            page_size: 50,
            pages: 1,
          }),
        );
      }
      if (url.endsWith("/api/v1/groups/available")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 10,
              name: "OpenAI",
              platform: "openai",
              supported_model_scopes: ["gpt-4o", "gpt-image-2"],
            },
          ]),
        );
      }
      if (url.endsWith("/api/v1/keys/100/reveal")) {
        return Promise.resolve(jsonResponse({ key: "sk-full", expires_in_seconds: 60 }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(
          new Response(JSON.stringify({ object: "list", data: [{ id: "gpt-4o" }, { id: "gpt-image-2" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Model is reachable." } }],
              data: [{ url: "https://cdn.example.com/generated.png" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    globalThis.fetch = fetchMock;

    render(<Playground />);

    await screen.findByText("Playground Key");
    await user.clear(screen.getByLabelText(/message/i));
    await user.type(screen.getByLabelText(/message/i), "Ping this model");
    await user.click(screen.getByRole("button", { name: /run test/i }));

    await screen.findByText("Model is reachable.");
    expect(screen.getByLabelText(/message/i)).toHaveValue("");
    expect(screen.getByAltText("Generated result 1")).toHaveAttribute("src", "https://cdn.example.com/generated.png");
    expect(localStorage.getItem("mikiko.playground.v1")).toContain("Ping this model");

    await user.clear(screen.getByLabelText(/temperature/i));
    await user.type(screen.getByLabelText(/temperature/i), "0.3");
    await user.click(screen.getByRole("button", { name: /reset messages/i }));

    expect(screen.queryByText("Model is reachable.")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/temperature/i)).toHaveValue(0.3);
    expect(screen.getByLabelText(/message/i)).toHaveValue("Say hello and confirm this model is available.");
    expect(localStorage.getItem("mikiko.playground.v1")).toContain("\"messages\":[]");

    await user.click(screen.getByRole("button", { name: /reset parameters/i }));

    expect(screen.getByLabelText(/temperature/i)).toHaveValue(0.7);
    await waitFor(() => {
      expect(localStorage.getItem("mikiko.playground.v1")).toContain("\"temperature\":0.7");
    });
  });

  it("does not add fallback models that are absent from gateway models and group scopes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/keys?page=1&page_size=50&status=active")) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 100,
                key: "sk-....test",
                name: "Playground Key",
                group_id: 10,
                group: { id: 10, name: "OpenAI" },
                status: "active",
                quota: 0,
                quota_used: 0,
                last_used_at: null,
                created_at: "2026-06-20T00:00:00Z",
                updated_at: "2026-06-20T00:00:00Z",
              },
            ],
            total: 1,
            page: 1,
            page_size: 50,
            pages: 1,
          }),
        );
      }
      if (url.endsWith("/api/v1/groups/available")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 10,
              name: "OpenAI",
              platform: "openai",
              supported_model_scopes: ["gpt-5.5"],
            },
          ]),
        );
      }
      if (url.endsWith("/api/v1/keys/100/reveal")) {
        return Promise.resolve(jsonResponse({ key: "sk-full", expires_in_seconds: 60 }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(
          new Response(JSON.stringify({ object: "list", data: [{ id: "gpt-5.5" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    globalThis.fetch = fetchMock;

    render(<Playground />);

    await screen.findByText("Playground Key");
    await waitFor(() => {
      expect(document.querySelector('option[value="gpt-5.5"]')).toBeInTheDocument();
    });
    expect(document.querySelector('option[value="gpt-4o"]')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText(/model/i));
    await user.type(screen.getByLabelText(/model/i), "temporary-model");
    await user.click(screen.getByRole("button", { name: /reset parameters/i }));

    expect(screen.getByLabelText(/model/i)).toHaveValue("gpt-5.5");
  });
});
