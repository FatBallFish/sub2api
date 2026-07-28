import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaygroundPayload,
  clearPlaygroundStorage,
  extractImagesFromResponse,
  extractTextFromResponse,
  isImageGenerationModel,
  loadPlaygroundDraft,
  savePlaygroundDraft,
  sendPlaygroundRequest,
  type PlaygroundDraft,
} from "./playground";

describe("playground helpers", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds a multimodal chat payload with enabled parameters", () => {
    const payload = buildPlaygroundPayload({
      mode: "chat",
      model: "gpt-4o",
      prompt: "Describe this image",
      imageUrl: "https://example.com/cat.png",
      stream: true,
      temperature: 0.4,
      topP: 0.8,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      history: [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
      ],
    });

    expect(payload).toEqual({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Answer normally.",
        },
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
      stream: true,
      temperature: 0.4,
      top_p: 0.8,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
    });
  });

  it("uses neutral playground instructions without embedding the selected model name", () => {
    const payload = buildPlaygroundPayload({
      mode: "responses",
      model: "gpt-5.5",
      prompt: "What model are you?",
      imageUrl: "",
      stream: false,
      temperature: 0.7,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });

    expect(payload).toMatchObject({ instructions: expect.any(String) });
    const instructions = (payload as { instructions: string }).instructions;
    expect(instructions).not.toContain("gpt-5.5");
  });

  it("builds an image generation payload for image models", () => {
    expect(isImageGenerationModel("gpt-image-2")).toBe(true);

    expect(
      buildPlaygroundPayload({
        mode: "image",
        model: "gpt-image-2",
        prompt: "A quiet workstation",
        imageUrl: "",
        stream: false,
        temperature: 0.7,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      }),
    ).toEqual({
      model: "gpt-image-2",
      prompt: "A quiet workstation",
      n: 1,
    });
  });

  it("builds an OpenAI Responses payload with multimodal input", () => {
    const payload = buildPlaygroundPayload({
      mode: "responses",
      model: "gpt-5.4",
      prompt: "Describe this image",
      imageUrl: "https://example.com/desk.png",
      stream: true,
      temperature: 0.2,
      topP: 0.9,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      history: [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
      ],
    });

    expect(payload).toEqual({
      model: "gpt-5.4",
      instructions: "Answer normally.",
      input: [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Describe this image" },
            { type: "input_image", image_url: "https://example.com/desk.png" },
          ],
        },
      ],
      stream: true,
      temperature: 0.2,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
    });
  });

  it("builds a Claude Messages payload for native Anthropic checks", () => {
    expect(
      buildPlaygroundPayload({
        mode: "messages",
        model: "claude-sonnet-4-6",
        prompt: "ping",
        imageUrl: "",
        stream: false,
        temperature: 0.7,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      }),
    ).toEqual({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: "Answer normally.",
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      temperature: 0.7,
      top_p: 1,
    });
  });

  it("extracts image URLs and base64 data from gateway responses", () => {
    expect(
      extractImagesFromResponse({
        data: [
          { url: "https://cdn.example.com/result.png" },
          { b64_json: "abc123" },
        ],
      }),
    ).toEqual(["https://cdn.example.com/result.png", "data:image/png;base64,abc123"]);

    expect(
      extractImagesFromResponse({
        choices: [
          {
            message: {
              content: [
                { type: "image_url", image_url: { url: "https://cdn.example.com/chat.png" } },
              ],
            },
          },
        ],
      }),
    ).toEqual(["https://cdn.example.com/chat.png"]);
  });

  it("extracts assistant content from SSE stream chunks instead of returning raw event frames", () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    expect(extractTextFromResponse(stream)).toBe("Hello world");
  });

  it("extracts assistant content from Responses API objects and SSE events", () => {
    expect(
      extractTextFromResponse({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Responses object text" }],
          },
        ],
      }),
    ).toBe("Responses object text");

    const stream = [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      "",
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":" responses"}',
      "",
      'event: response.completed',
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Hello responses"}]}]}}',
      "",
    ].join("\n");

    expect(extractTextFromResponse(stream)).toBe("Hello responses");
  });

  it("persists and clears playground draft data in localStorage only", () => {
    const draft: PlaygroundDraft = {
      config: {
        apiKeyId: 100,
        groupId: 10,
        mode: "chat",
        model: "gpt-4o",
        imageUrl: "",
        temperature: 0.3,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        stream: false,
      },
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: "2026-06-20T00:00:00Z" }],
    };

    savePlaygroundDraft(draft);
    expect(loadPlaygroundDraft()).toEqual(draft);

    clearPlaygroundStorage();
    expect(loadPlaygroundDraft()).toBeNull();
  });

  it("sends playground requests to the selected gateway endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
    });
    globalThis.fetch = fetchMock;

    await sendPlaygroundRequest({
      apiKey: "sk-test",
      mode: "chat",
      model: "gpt-4o",
      prompt: "ping",
      imageUrl: "",
      stream: false,
      temperature: 0.7,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );

    await sendPlaygroundRequest({
      apiKey: "sk-test",
      mode: "responses",
      model: "gpt-5.4",
      prompt: "ping",
      imageUrl: "",
      stream: false,
      temperature: 0.7,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });

    await sendPlaygroundRequest({
      apiKey: "sk-test",
      mode: "messages",
      model: "claude-sonnet-4-6",
      prompt: "ping",
      imageUrl: "",
      stream: false,
      temperature: 0.7,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });

    expect(fetchMock).toHaveBeenCalledWith("/v1/responses", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/v1/messages", expect.objectContaining({ method: "POST" }));
  });

  it("emits streaming text deltas while the response body is still being read", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    let pullCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (pullCount >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[pullCount]));
        pullCount += 1;
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    globalThis.fetch = fetchMock;
    const deltas: string[] = [];

    const payload = await sendPlaygroundRequest(
      {
        apiKey: "sk-test",
        mode: "chat",
        model: "gpt-4o",
        prompt: "ping",
        imageUrl: "",
        stream: true,
        temperature: 0.7,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      },
      { onDelta: (delta) => deltas.push(delta) },
    );

    expect(deltas).toEqual(["Hello", " world"]);
    expect(payload).toContain("Hello world");
  });
});
