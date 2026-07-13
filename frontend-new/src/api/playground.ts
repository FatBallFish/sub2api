export type PlaygroundMode = "chat" | "responses" | "messages" | "image";

export interface PlaygroundConfig {
  apiKeyId: number | null;
  groupId: number | null;
  mode: Exclude<PlaygroundMode, "image">;
  model: string;
  imageUrl: string;
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stream: boolean;
}

export interface PlaygroundMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  raw?: unknown;
  createdAt: string;
}

export interface PlaygroundDraft {
  config: PlaygroundConfig;
  messages: PlaygroundMessage[];
}

export interface PlaygroundRequestInput {
  apiKey?: string;
  mode: PlaygroundMode;
  model: string;
  prompt: string;
  imageUrl: string;
  stream: boolean;
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  history?: Pick<PlaygroundMessage, "role" | "content" | "images">[];
}

export interface PlaygroundRequestOptions {
  onDelta?: (delta: string) => void;
}

type JsonRecord = Record<string, unknown>;

const STORAGE_KEY = "mikiko.playground.v1";

export function isImageGenerationModel(model: string) {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.includes("image") ||
    normalized.includes("imagen") ||
    normalized.includes("dall-e") ||
    normalized.includes("gpt-image")
  );
}

function messageContent(prompt: string, imageUrl: string) {
  const trimmedImage = imageUrl.trim();
  if (!trimmedImage) return prompt;
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: trimmedImage } },
  ];
}

function responsesContent(prompt: string, imageUrl: string) {
  const trimmedImage = imageUrl.trim();
  if (!trimmedImage) return prompt;
  return [
    { type: "input_text", text: prompt },
    { type: "input_image", image_url: trimmedImage },
  ];
}

function playgroundIdentityInstruction() {
  return "Answer normally.";
}

function chatHistory(input: PlaygroundRequestInput) {
  return (input.history ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
}

export function buildPlaygroundPayload(input: PlaygroundRequestInput) {
  if (input.mode === "image") {
    return {
      model: input.model,
      prompt: input.prompt,
      n: 1,
    };
  }

  if (input.mode === "responses") {
    return {
      model: input.model,
      instructions: playgroundIdentityInstruction(),
      input: [
        ...chatHistory(input),
        {
          role: "user",
          content: responsesContent(input.prompt, input.imageUrl),
        },
      ],
      stream: input.stream,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
    };
  }

  if (input.mode === "messages") {
    return {
      model: input.model,
      max_tokens: 1024,
      system: playgroundIdentityInstruction(),
      messages: [
        ...chatHistory(input),
        {
          role: "user",
          content: input.prompt,
        },
      ],
      stream: input.stream,
      temperature: input.temperature,
      top_p: input.topP,
    };
  }

  return {
    model: input.model,
    messages: [
      {
        role: "system",
        content: playgroundIdentityInstruction(),
      },
      ...chatHistory(input),
      {
        role: "user",
        content: messageContent(input.prompt, input.imageUrl),
      },
    ],
    stream: input.stream,
    temperature: input.temperature,
    top_p: input.topP,
    frequency_penalty: input.frequencyPenalty,
    presence_penalty: input.presencePenalty,
  };
}

function addImage(images: string[], value: unknown) {
  if (typeof value !== "string" || !value.trim()) return;
  images.push(value.trim());
}

function collectImages(value: unknown, images: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectImages(item, images));
    return;
  }

  const record = value as JsonRecord;
  addImage(images, record.url);
  if (typeof record.b64_json === "string" && record.b64_json.trim()) {
    images.push(`data:image/png;base64,${record.b64_json.trim()}`);
  }

  const imageURL = record.image_url;
  if (typeof imageURL === "string") {
    addImage(images, imageURL);
  } else if (imageURL && typeof imageURL === "object") {
    addImage(images, (imageURL as JsonRecord).url);
  }

  Object.values(record).forEach((item) => collectImages(item, images));
}

export function extractImagesFromResponse(response: unknown) {
  const images: string[] = [];
  collectImages(response, images);
  return Array.from(new Set(images));
}

export function extractTextFromResponse(response: unknown) {
  if (typeof response === "string") {
    return extractTextFromStream(response) || response;
  }
  if (!response || typeof response !== "object") return "";
  const record = response as JsonRecord;
  if (typeof record.output_text === "string") return record.output_text;
  const outputText = extractTextFromResponsesOutput(record.output);
  if (outputText) return outputText;
  if (record.response && typeof record.response === "object") {
    const nested = record.response as JsonRecord;
    if (typeof nested.output_text === "string") return nested.output_text;
    const nestedOutputText = extractTextFromResponsesOutput(nested.output);
    if (nestedOutputText) return nestedOutputText;
  }
  const contentText = extractTextFromContentArray(record.content);
  if (contentText) return contentText;
  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as JsonRecord | undefined;
    const message = first?.message as JsonRecord | undefined;
    const content = message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (part && typeof part === "object" ? (part as JsonRecord).text : ""))
        .filter((text): text is string => typeof text === "string" && text.length > 0)
        .join("\n");
    }
    if (typeof first?.text === "string") return first.text;
  }
  return "";
}

function extractTextFromContentArray(content: unknown) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as JsonRecord;
      const text = record.text ?? record.output_text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractTextFromResponsesOutput(output: unknown) {
  if (!Array.isArray(output)) return "";
  return output
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as JsonRecord;
      if (typeof record.text === "string") return record.text;
      if (typeof record.output_text === "string") return record.output_text;
      return extractTextFromContentArray(record.content);
    })
    .filter(Boolean)
    .join("\n");
}

function extractTextFromStream(stream: string) {
  const chunks: string[] = [];
  let completedText = "";
  const lines = stream.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data) as JsonRecord;
      if (typeof parsed.delta === "string" && parsed.type === "response.output_text.delta") {
        chunks.push(parsed.delta);
        continue;
      }
      const responseText = extractTextFromResponse(parsed);
      if (parsed.type === "response.completed" && responseText) {
        completedText = responseText;
        continue;
      }
      const choices = parsed.choices;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          if (!choice || typeof choice !== "object") continue;
          const choiceRecord = choice as JsonRecord;
          const delta = choiceRecord.delta as JsonRecord | undefined;
          const message = choiceRecord.message as JsonRecord | undefined;
          const content = delta?.content ?? message?.content ?? choiceRecord.text;
          if (typeof content === "string") chunks.push(content);
        }
      }
    } catch {
      // Ignore malformed event frames and keep parsing later chunks.
    }
  }
  return chunks.join("") || completedText;
}

function extractDeltaFromStreamPayload(parsed: JsonRecord) {
  if (typeof parsed.delta === "string" && parsed.type === "response.output_text.delta") {
    return parsed.delta;
  }
  const choices = parsed.choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") return "";
        const choiceRecord = choice as JsonRecord;
        const delta = choiceRecord.delta as JsonRecord | undefined;
        const message = choiceRecord.message as JsonRecord | undefined;
        const content = delta?.content ?? message?.content ?? choiceRecord.text;
        return typeof content === "string" ? content : "";
      })
      .join("");
  }
  const anthropicDelta = parsed.delta;
  if (anthropicDelta && typeof anthropicDelta === "object") {
    const text = (anthropicDelta as JsonRecord).text;
    if (typeof text === "string") return text;
  }
  if (parsed.type === "content_block_delta" && parsed.delta && typeof parsed.delta === "object") {
    const text = (parsed.delta as JsonRecord).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function extractSSEDataBlocks(buffer: string) {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() ?? "";
  const blocks = parts.map((part) =>
    part
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n"),
  );
  return { blocks, remainder };
}

function emitStreamDeltasFromBuffer(buffer: string, onDelta: (delta: string) => void) {
  const { blocks, remainder } = extractSSEDataBlocks(buffer);
  const emitted: string[] = [];
  for (const data of blocks) {
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as JsonRecord;
      const delta = extractDeltaFromStreamPayload(parsed);
      if (delta) {
        emitted.push(delta);
        onDelta(delta);
      }
    } catch {
      // Ignore malformed event frames and keep parsing later chunks.
    }
  }
  return { emittedText: emitted.join(""), remainder };
}

export function savePlaygroundDraft(draft: PlaygroundDraft) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function loadPlaygroundDraft(): PlaygroundDraft | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlaygroundDraft;
  } catch {
    return null;
  }
}

export function clearPlaygroundStorage() {
  window.localStorage.removeItem(STORAGE_KEY);
}

async function parseGatewayResponse(response: Response, options: PlaygroundRequestOptions = {}) {
  const contentType = response.headers?.get("Content-Type") || "";
  if (contentType.includes("text/event-stream") && response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let pending = "";
    let emittedText = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      if (options.onDelta) {
        const parsed = emitStreamDeltasFromBuffer(pending + chunk, options.onDelta);
        emittedText += parsed.emittedText;
        pending = parsed.remainder;
      }
    }
    const tail = decoder.decode();
    if (tail) {
      raw += tail;
      if (options.onDelta) {
        const parsed = emitStreamDeltasFromBuffer(pending + tail + "\n\n", options.onDelta);
        emittedText += parsed.emittedText;
      }
    } else if (options.onDelta && pending.trim()) {
      const parsed = emitStreamDeltasFromBuffer(pending + "\n\n", options.onDelta);
      emittedText += parsed.emittedText;
    }
    return emittedText || extractTextFromResponse(raw) || raw;
  }
  if (contentType.includes("application/json") && typeof response.json === "function") {
    return response.json();
  }
  if (typeof response.text === "function") {
    return response.text();
  }
  if (typeof response.json === "function") {
    return response.json();
  }
  return null;
}

export async function sendPlaygroundRequest(input: PlaygroundRequestInput, options: PlaygroundRequestOptions = {}) {
  const endpoint =
    input.mode === "image"
      ? "/v1/images/generations"
      : input.mode === "responses"
        ? "/v1/responses"
        : input.mode === "messages"
          ? "/v1/messages"
          : "/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey || ""}`,
    },
    body: JSON.stringify(buildPlaygroundPayload(input)),
  });
  const payload = await parseGatewayResponse(response, options);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object"
        ? JSON.stringify(payload)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export interface GatewayModel {
  id?: string;
  name?: string;
  display_name?: string;
}

export async function listGatewayModels(apiKey: string) {
  const response = await fetch("/v1/models", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const payload = await parseGatewayResponse(response);
  if (!response.ok) return [];
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as JsonRecord).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const model = item as GatewayModel;
      return model.id || model.name || model.display_name || "";
    })
    .filter((model): model is string => Boolean(model));
}
