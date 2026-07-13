import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowClockwise,
  ImageSquare,
  PaperPlaneTilt,
  SlidersHorizontal,
  SpinnerGap,
} from "@phosphor-icons/react";
import { listAvailableGroups, type AvailableGroup } from "../../api/groups";
import { listApiKeys, revealApiKey } from "../../api/keys";
import {
  buildPlaygroundPayload,
  extractImagesFromResponse,
  extractTextFromResponse,
  isImageGenerationModel,
  listGatewayModels,
  loadPlaygroundDraft,
  savePlaygroundDraft,
  sendPlaygroundRequest,
  type PlaygroundConfig,
  type PlaygroundMessage,
  type PlaygroundMode,
} from "../../api/playground";
import type { ApiKey } from "../../types/keys";

type SelectablePlaygroundMode = PlaygroundConfig["mode"];

const defaultConfig: PlaygroundConfig = {
  apiKeyId: null,
  groupId: null,
  mode: "chat",
  model: "gpt-4o",
  imageUrl: "",
  temperature: 0.7,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stream: false,
};

function nowISO() {
  return new Date().toISOString();
}

function messageID(role: string) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function compactJSON(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function modelSuggestions(group: AvailableGroup | undefined, gatewayModels: string[]) {
  const scoped = group?.supported_model_scopes?.filter(Boolean) ?? [];
  return Array.from(new Set([...gatewayModels, ...scoped]));
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const defaultPrompt = "Say hello and confirm this model is available.";

function resolveMode(config: PlaygroundConfig): PlaygroundMode {
  return isImageGenerationModel(config.model) ? "image" : config.mode;
}

function modeLabel(mode: PlaygroundMode) {
  switch (mode) {
    case "responses":
      return "Responses API";
    case "messages":
      return "Claude Messages";
    case "image":
      return "Images API";
    default:
      return "Chat Completions";
  }
}

function modeHint(mode: PlaygroundMode) {
  switch (mode) {
    case "responses":
      return "OpenAI checks use /v1/responses.";
    case "messages":
      return "Claude native checks use /v1/messages.";
    case "image":
      return "Image models return visual results from /v1/images/generations.";
    default:
      return "Chat checks use /v1/chat/completions.";
  }
}

export default function Playground() {
  const draft = useMemo(() => loadPlaygroundDraft(), []);
  const skipNextPersist = useRef(false);
  const [config, setConfig] = useState<PlaygroundConfig>({
    ...defaultConfig,
    ...(draft?.config ?? {}),
    mode: draft?.config.mode ?? defaultConfig.mode,
  });
  const [messages, setMessages] = useState<PlaygroundMessage[]>(draft?.messages ?? []);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [groups, setGroups] = useState<AvailableGroup[]>([]);
  const [gatewayModels, setGatewayModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawPreview, setRawPreview] = useState("");

  const selectedKey = keys.find((key) => key.id === config.apiKeyId);
  const selectedGroup = groups.find((group) => group.id === config.groupId);
  const mode: PlaygroundMode = resolveMode(config);
  const availableModels = modelSuggestions(selectedGroup, gatewayModels);
  const compatibleKeys = config.groupId
    ? keys.filter((key) => key.group_id === config.groupId)
    : keys;

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      listApiKeys({ page: 1, pageSize: 50, status: "active" }),
      listAvailableGroups(),
    ])
      .then(([keysResult, groupsResult]) => {
        if (!active) return;
        const loadedKeys = keysResult.status === "fulfilled" ? keysResult.value.items : [];
        const loadedGroups = groupsResult.status === "fulfilled" ? groupsResult.value : [];
        setKeys(loadedKeys);
        setGroups(loadedGroups);
        setConfig((current) => ({
          ...current,
          apiKeyId: current.apiKeyId ?? loadedKeys[0]?.id ?? null,
          groupId: current.groupId ?? loadedKeys[0]?.group_id ?? loadedGroups[0]?.id ?? null,
        }));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load playground data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    savePlaygroundDraft({ config, messages });
  }, [config, messages]);

  useEffect(() => {
    const selectedKeyId = selectedKey?.id;
    if (!selectedKeyId) return;
    let active = true;
    revealApiKey(selectedKeyId)
      .then((revealed) => listGatewayModels(revealed.key))
      .then((models) => {
        if (active) setGatewayModels(models);
      })
      .catch(() => {
        if (active) setGatewayModels([]);
      });
    return () => {
      active = false;
    };
  }, [selectedKey?.id]);

  function updateConfig(patch: Partial<PlaygroundConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  async function runPlayground(event: FormEvent) {
    event.preventDefault();
    if (!selectedKey) {
      setError("Select an active API key first.");
      return;
    }
    if (!prompt.trim()) {
      setError("Enter a message before running the test.");
      return;
    }

    setSending(true);
    setError(null);
    const userMessage: PlaygroundMessage = {
      id: messageID("user"),
      role: "user",
      content: prompt.trim(),
      images: config.imageUrl.trim() ? [config.imageUrl.trim()] : [],
      createdAt: nowISO(),
    };
    const history = messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
      .map(({ role, content, images }) => ({ role, content, images }));
    setMessages((current) => [...current, userMessage]);

    try {
      const revealed = await revealApiKey(selectedKey.id);
      const streamingAssistantId = messageID("assistant");
      if (config.stream && mode !== "image") {
        setMessages((current) => [
          ...current,
          {
            id: streamingAssistantId,
            role: "assistant",
            content: "",
            createdAt: nowISO(),
          },
        ]);
      }
      const response = await sendPlaygroundRequest(
        {
          apiKey: revealed.key,
          mode,
          model: config.model,
          prompt: prompt.trim(),
          imageUrl: config.imageUrl,
          stream: config.stream,
          temperature: config.temperature,
          topP: config.topP,
          frequencyPenalty: config.frequencyPenalty,
          presencePenalty: config.presencePenalty,
          history,
        },
        {
          onDelta: (delta) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === streamingAssistantId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message,
              ),
            );
          },
        },
      );
      const images = extractImagesFromResponse(response);
      const content = extractTextFromResponse(response) || (images.length ? "Image generated successfully." : compactJSON(response));
      const assistantMessage: PlaygroundMessage = {
        id: streamingAssistantId,
        role: "assistant",
        content,
        images,
        raw: response,
        createdAt: nowISO(),
      };
      setMessages((current) => {
        if (config.stream && mode !== "image") {
          return current.map((message) => (message.id === streamingAssistantId ? assistantMessage : message));
        }
        return [...current, assistantMessage];
      });
      setRawPreview(compactJSON(response));
      setPrompt("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Playground request failed.";
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: messageID("assistant"),
          role: "assistant",
          content: message,
          createdAt: nowISO(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function resetParameters() {
    setConfig({
      ...defaultConfig,
      model: availableModels[0] ?? config.model ?? defaultConfig.model,
    });
    setError(null);
  }

  function resetMessages() {
    setMessages([]);
    setPrompt(defaultPrompt);
    setRawPreview("");
    setError(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        Loading playground...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Playground</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Validate an API key, group route, model, and multimodal request without leaving the console.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetParameters}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
          >
            <ArrowClockwise size={16} weight="bold" />
            Reset parameters
          </button>
          <button
            type="button"
            onClick={resetMessages}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
          >
            <ArrowClockwise size={16} weight="bold" />
            Reset messages
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100 pb-4">
            <SlidersHorizontal size={18} weight="bold" className="text-zinc-900" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Configuration</h2>
          </div>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            Group
            <select
              value={config.groupId ?? ""}
              onChange={(event) => {
                const groupId = event.target.value ? Number(event.target.value) : null;
                const nextKey = keys.find((key) => key.group_id === groupId) ?? keys[0];
                updateConfig({ groupId, apiKeyId: nextKey?.id ?? null });
              }}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            >
              <option value="">All available groups</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}{group.platform ? ` · ${group.platform}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            API Key
            <select
              value={config.apiKeyId ?? ""}
              onChange={(event) => updateConfig({ apiKeyId: event.target.value ? Number(event.target.value) : null })}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            >
              <option value="">Select key</option>
              {compatibleKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            Model
            <input
              list="playground-models"
              value={config.model}
              onChange={(event) => updateConfig({ model: event.target.value })}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            />
            <datalist id="playground-models">
              {availableModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            API mode
            <select
              value={config.mode}
              disabled={mode === "image"}
              onChange={(event) => updateConfig({ mode: event.target.value as SelectablePlaygroundMode })}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              <option value="chat">Chat Completions</option>
              <option value="responses">Responses API</option>
              <option value="messages">Claude Messages</option>
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            Image URL
            <input
              value={config.imageUrl}
              onChange={(event) => updateConfig({ imageUrl: event.target.value })}
              placeholder="https://example.com/input.png"
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Temperature" value={config.temperature} min={0} max={2} step={0.1} onChange={(value) => updateConfig({ temperature: value })} />
            <NumberField label="Top P" value={config.topP} min={0} max={1} step={0.05} onChange={(value) => updateConfig({ topP: value })} />
            <NumberField label="Frequency Penalty" value={config.frequencyPenalty} min={-2} max={2} step={0.1} onChange={(value) => updateConfig({ frequencyPenalty: value })} />
            <NumberField label="Presence Penalty" value={config.presencePenalty} min={-2} max={2} step={0.1} onChange={(value) => updateConfig({ presencePenalty: value })} />
          </div>

          <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold text-zinc-700">
            Stream output
            <input
              type="checkbox"
              checked={config.stream}
              disabled={mode === "image"}
              onChange={(event) => updateConfig({ stream: event.target.checked })}
              className="h-4 w-4 accent-zinc-900"
            />
          </label>

          <div className="rounded-xl border border-zinc-200 bg-zinc-950 p-3 text-xs text-zinc-300">
            <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <span>{modeLabel(mode)}</span>
              <span>{selectedGroup?.platform ?? "auto"}</span>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap">{compactJSON(buildPlaygroundPayload({ ...config, apiKey: "", mode, prompt }))}</pre>
          </div>
        </aside>

        <section className="flex h-[calc(100vh-220px)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Conversation</h2>
              <p className="mt-1 text-xs text-zinc-400">Stored in this browser only.</p>
            </div>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              {messages.length} messages
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-zinc-50/70 p-5">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[280px] items-center justify-center text-center">
                <div>
                  <ImageSquare size={36} weight="duotone" className="mx-auto text-zinc-300" />
                  <p className="mt-3 text-sm font-bold text-zinc-700">No requests yet</p>
                  <p className="mt-1 text-xs text-zinc-400">Send a prompt to verify routing, credentials, and model output.</p>
                </div>
              </div>
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
          </div>

          <form onSubmit={runPlayground} className="border-t border-zinc-100 p-4">
            <label className="sr-only" htmlFor="playground-message">Message</label>
            <textarea
              id="playground-message"
              aria-label="Message"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-400">
                {modeHint(mode)}
              </p>
              <button
                type="submit"
                disabled={sending || !selectedKey}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? <SpinnerGap size={16} className="animate-spin" /> : <PaperPlaneTilt size={16} weight="bold" />}
                Run test
              </button>
            </div>
          </form>

          {rawPreview ? (
            <details className="border-t border-zinc-100 px-5 py-4 text-xs text-zinc-500">
              <summary className="cursor-pointer font-bold uppercase tracking-widest text-zinc-400">Raw response</summary>
              <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-zinc-950 p-3 text-zinc-300">{rawPreview}</pre>
            </details>
          ) : null}
        </section>
      </div>
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function NumberField({ label, value, min, max, step, onChange }: NumberFieldProps) {
  return (
    <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
      />
    </label>
  );
}

function MessageBubble({ message }: { message: PlaygroundMessage }) {
  const isUser = message.role === "user";
  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-2xl border px-4 py-3 shadow-sm ${isUser ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800"}`}>
        <div className={`mb-2 flex items-center justify-between gap-6 text-[10px] font-bold uppercase tracking-widest ${isUser ? "text-zinc-400" : "text-zinc-400"}`}>
          <span>{message.role}</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        {message.images && message.images.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {message.images.map((src, index) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                <img src={src} alt={`Generated result ${index + 1}`} className="h-auto w-full object-cover" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
