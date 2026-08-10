import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
import { ApiError } from "../../api/client";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  errorMessage,
  rawMessage,
  resolveLocalizedMessage,
  translationMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";

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

function isSerializedProviderResponse(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function modelSuggestions(group: AvailableGroup | undefined, gatewayModels: string[]) {
  const scoped = group?.supported_model_scopes?.filter(Boolean) ?? [];
  return Array.from(new Set([...gatewayModels, ...scoped]));
}

function formatTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function resolveMode(config: PlaygroundConfig): PlaygroundMode {
  return isImageGenerationModel(config.model) ? "image" : config.mode;
}

function modeLabel(mode: PlaygroundMode, t: TFunction<"console">) {
  switch (mode) {
    case "responses":
      return t("playground.modes.responses");
    case "messages":
      return t("playground.modes.messages");
    case "image":
      return t("playground.modes.image");
    default:
      return t("playground.modes.chat");
  }
}

function modeHint(mode: PlaygroundMode, t: TFunction<"console">) {
  switch (mode) {
    case "responses":
      return t("playground.hintResponses");
    case "messages":
      return t("playground.hintMessages");
    case "image":
      return t("playground.hintImages");
    default:
      return t("playground.hintChat");
  }
}

export default function Playground() {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language;
  usePageTitle(t("playground.title"));
  const draft = useMemo(() => loadPlaygroundDraft(), []);
  const skipNextPersist = useRef(false);
  const [config, setConfig] = useState<PlaygroundConfig>({
    ...defaultConfig,
    ...(draft?.config ?? {}),
    mode: draft?.config.mode ?? defaultConfig.mode,
  });
  const [messages, setMessages] = useState<PlaygroundMessage[]>(draft?.messages ?? []);
  const [prompt, setPrompt] = useState<string>(() => t("playground.defaultPrompt"));
  const defaultPromptRef = useRef(t("playground.defaultPrompt"));
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [groups, setGroups] = useState<AvailableGroup[]>([]);
  const [gatewayModels, setGatewayModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [loadNotice, setLoadNotice] = useState<LocalizedMessage | null>(null);
  const [rawPreview, setRawPreview] = useState("");

  const selectedKey = keys.find((key) =>
    key.id === config.apiKeyId && (!config.groupId || key.group_id === config.groupId));
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
        if (keysResult.status === "rejected") {
          setError(errorMessage(keysResult.reason, "playgroundKeysLoadFailed"));
        }
        if (groupsResult.status === "rejected" && keysResult.status === "fulfilled") {
          setLoadNotice(errorMessage(groupsResult.reason, "playgroundGroupsLoadFailed"));
        }
        setKeys(loadedKeys);
        setGroups(loadedGroups);
        setConfig((current) => {
          if (groupsResult.status === "rejected") {
            const currentKey = loadedKeys.find((key) => key.id === current.apiKeyId);
            return { ...current, apiKeyId: currentKey?.id ?? loadedKeys[0]?.id ?? null, groupId: null };
          }
          const currentKey = loadedKeys.find((key) => key.id === current.apiKeyId);
          const groupId = current.groupId ?? currentKey?.group_id ?? loadedKeys[0]?.group_id ?? loadedGroups[0]?.id ?? null;
          const compatibleCurrentKey = currentKey && (!groupId || currentKey.group_id === groupId)
            ? currentKey
            : undefined;
          const nextKey = compatibleCurrentKey
            ?? loadedKeys.find((key) => !groupId || key.group_id === groupId);
          return { ...current, apiKeyId: nextKey?.id ?? null, groupId };
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextDefault = t("playground.defaultPrompt");
    setPrompt((current) => current === defaultPromptRef.current ? nextDefault : current);
    defaultPromptRef.current = nextDefault;
  }, [locale, t]);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    savePlaygroundDraft({ config, messages });
  }, [config, messages]);

  useEffect(() => {
    const selectedKeyId = selectedKey?.id;
    setGatewayModels([]);
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
      setError(translationMessage(config.groupId
        ? "console:playground.noCompatibleKey"
        : "console:playground.selectActiveKey"));
      return;
    }
    if (!prompt.trim()) {
      setError(translationMessage("console:playground.messageRequired"));
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
      const content = extractTextFromResponse(response) || (images.length ? "" : compactJSON(response));
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
      const message = reason instanceof Error
        && !(reason instanceof ApiError)
        && isSerializedProviderResponse(reason.message)
        ? rawMessage(reason.message)
        : errorMessage(reason, "playgroundRequestFailed");
      setError(message);
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
    setPrompt(t("playground.defaultPrompt"));
    setRawPreview("");
    setError(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        {t("playground.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("playground.title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t("playground.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetParameters}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
          >
            <ArrowClockwise size={16} weight="bold" />
            {t("playground.resetParameters")}
          </button>
          <button
            type="button"
            onClick={resetMessages}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
          >
            <ArrowClockwise size={16} weight="bold" />
            {t("playground.resetMessages")}
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {resolveLocalizedMessage(error)}
        </div>
      ) : null}

      {loadNotice ? (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {resolveLocalizedMessage(loadNotice)}
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100 pb-4">
            <SlidersHorizontal size={18} weight="bold" className="text-zinc-900" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">{t("playground.configuration")}</h2>
          </div>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            {t("playground.group")}
            <select
              value={config.groupId ?? ""}
              onChange={(event) => {
                const groupId = event.target.value ? Number(event.target.value) : null;
                const nextKey = keys.find((key) => !groupId || key.group_id === groupId);
                updateConfig({ groupId, apiKeyId: nextKey?.id ?? null });
              }}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            >
              <option value="">{t("playground.allGroups")}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}{group.platform ? ` · ${group.platform}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            {t("playground.apiKey")}
            <select
              value={config.apiKeyId ?? ""}
              onChange={(event) => updateConfig({ apiKeyId: event.target.value ? Number(event.target.value) : null })}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            >
              <option value="">{t("playground.selectKey")}</option>
              {compatibleKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            {t("playground.model")}
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
            {t("playground.apiMode")}
            <select
              value={config.mode}
              disabled={mode === "image"}
              onChange={(event) => updateConfig({ mode: event.target.value as SelectablePlaygroundMode })}
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              <option value="chat">{t("playground.modes.chat")}</option>
              <option value="responses">{t("playground.modes.responses")}</option>
              <option value="messages">{t("playground.modes.messages")}</option>
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            {t("playground.imageUrl")}
            <input
              value={config.imageUrl}
              onChange={(event) => updateConfig({ imageUrl: event.target.value })}
              placeholder="https://example.com/input.png"
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t("playground.temperature")} value={config.temperature} min={0} max={2} step={0.1} onChange={(value) => updateConfig({ temperature: value })} />
            <NumberField label={t("playground.topP")} value={config.topP} min={0} max={1} step={0.05} onChange={(value) => updateConfig({ topP: value })} />
            <NumberField label={t("playground.frequencyPenalty")} value={config.frequencyPenalty} min={-2} max={2} step={0.1} onChange={(value) => updateConfig({ frequencyPenalty: value })} />
            <NumberField label={t("playground.presencePenalty")} value={config.presencePenalty} min={-2} max={2} step={0.1} onChange={(value) => updateConfig({ presencePenalty: value })} />
          </div>

          <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold text-zinc-700">
            {t("playground.streamOutput")}
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
              <span>{modeLabel(mode, t)}</span>
              <span>{selectedGroup?.platform ?? t("playground.auto")}</span>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap">{compactJSON(buildPlaygroundPayload({ ...config, apiKey: "", mode, prompt }))}</pre>
          </div>
        </aside>

        <section className="flex h-[calc(100vh-220px)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">{t("playground.conversation")}</h2>
              <p className="mt-1 text-xs text-zinc-400">{t("playground.browserOnly")}</p>
            </div>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              {t("playground.messageCount", { count: messages.length })}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-zinc-50/70 p-5">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[280px] items-center justify-center text-center">
                <div>
                  <ImageSquare size={36} weight="duotone" className="mx-auto text-zinc-300" />
                  <p className="mt-3 text-sm font-bold text-zinc-700">{t("playground.empty")}</p>
                  <p className="mt-1 text-xs text-zinc-400">{t("playground.emptyDescription")}</p>
                </div>
              </div>
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
          </div>

          <form onSubmit={runPlayground} className="border-t border-zinc-100 p-4">
            <label className="sr-only" htmlFor="playground-message">{t("playground.message")}</label>
            <textarea
              id="playground-message"
              aria-label={t("playground.message")}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-400">
                {modeHint(mode, t)}
              </p>
              <button
                type="submit"
                disabled={sending || !selectedKey}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? <SpinnerGap size={16} className="animate-spin" /> : <PaperPlaneTilt size={16} weight="bold" />}
                {sending ? t("playground.running") : t("playground.runTest")}
              </button>
            </div>
          </form>

          {rawPreview ? (
            <details className="border-t border-zinc-100 px-5 py-4 text-xs text-zinc-500">
              <summary className="cursor-pointer font-bold uppercase tracking-widest text-zinc-400">{t("playground.rawResponse")}</summary>
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
  const { t, i18n } = useTranslation("console");
  const isUser = message.role === "user";
  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-2xl border px-4 py-3 shadow-sm ${isUser ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800"}`}>
        <div className={`mb-2 flex items-center justify-between gap-6 text-[10px] font-bold uppercase tracking-widest ${isUser ? "text-zinc-400" : "text-zinc-400"}`}>
          <span>{t(`playground.role.${message.role}`)}</span>
          <span>{formatTime(message.createdAt, i18n.resolvedLanguage || i18n.language)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content || t("playground.imageGenerated")}</p>
        {message.images && message.images.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {message.images.map((src, index) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                <img src={src} alt={t("playground.generatedResult", { index: index + 1 })} className="h-auto w-full object-cover" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
