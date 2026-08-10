import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, CheckCircle, Question, Copy, Check } from "@phosphor-icons/react";
import { listApiKeys, revealApiKey } from "../../api/keys";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import type { ApiKey } from "../../types/keys";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  errorMessage,
  resolveLocalizedMessage,
  translationMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";
import {
  buildClientConfigFiles,
  gatewayBaseUrl,
  getInstallClientOptions,
  getInstallShellOptions,
  normalizeClientForPlatform,
  normalizeShellForClient,
  type InstallClientId,
  type InstallShellId,
  type ClientConfigHintId,
} from "../../utils/clientConfig";

const CLIENT_CONFIG_HINT_KEYS = {
  claudeSettings: "installGuide.hintClaudeSettings",
  codexAuth: "installGuide.hintCodexAuth",
  openCodeMerge: "installGuide.hintOpenCode",
} as const satisfies Record<ClientConfigHintId, string>;

function maskKey(value: string, emptyLabel: string) {
  if (!value) return emptyLabel;
  if (value.includes("....")) return value;
  if (value.startsWith("sk-")) return `sk-....${value.slice(-4)}`;
  return `${value.slice(0, 3)}-....${value.slice(-4)}`;
}

function copyPayload(files: { path: string; content: string }[]) {
  return files.map((file) => `# ${file.path}\n${file.content}`).join("\n\n");
}

export default function InstallGuide() {
  const { t } = useTranslation("console");
  usePageTitle(t("installGuide.title"));
  const [params] = useSearchParams();
  const preferredKeyId = Number(params.get("key"));
  const [selectedClient, setSelectedClient] = useState<InstallClientId>("claude");
  const [selectedShell, setSelectedShell] = useState<InstallShellId>("unix");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | "all" | null>(null);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      listApiKeys({ page: 1, pageSize: 20, status: "active" }),
      getPublicSettings().catch(() => ({} as PublicSettings)),
    ])
      .then(([keyData, publicSettings]) => {
        if (!active) return;
        setKeys(keyData.items);
        setSettings(publicSettings);
        const preferred = Number.isFinite(preferredKeyId)
          ? keyData.items.find((key) => key.id === preferredKeyId)
          : undefined;
        setSelectedKeyId((preferred ?? keyData.items[0])?.id ?? null);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(errorMessage(reason, "apiKeysLoadFailed"));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [preferredKeyId]);

  const selectedKey = keys.find((key) => key.id === selectedKeyId) ?? keys[0];
  const baseUrl = gatewayBaseUrl(settings?.api_base_url);
  const clientOptions = getInstallClientOptions(selectedKey?.group?.platform, selectedKey?.group?.allow_messages_dispatch);
  const activeClient = normalizeClientForPlatform(
    selectedKey?.group?.platform,
    selectedClient,
    selectedKey?.group?.allow_messages_dispatch,
  );
  const shellOptions = getInstallShellOptions(activeClient);
  const activeShell = normalizeShellForClient(activeClient, selectedShell);
  const displayKey = revealedKey ?? maskKey(selectedKey?.key ?? "", t("installGuide.selectApiKey"));
  const files = selectedKey
    ? buildClientConfigFiles({
        platform: selectedKey.group?.platform,
        clientId: activeClient,
        shellId: activeShell,
        baseUrl,
        apiKey: displayKey,
      })
    : [];

  const revealSelectedKey = async () => {
    if (!selectedKey) throw new Error("selected API key is required");
    if (revealedKey) return revealedKey;
    const revealed = await revealApiKey(selectedKey.id);
    setRevealedKey(revealed.key);
    return revealed.key;
  };

  const copyConfig = async (index?: number) => {
    if (!selectedKey) {
      setError(translationMessage("console:installGuide.createKeyFirst"));
      return;
    }

    setCopying(true);
    setError(null);
    try {
      const realKey = await revealSelectedKey();
      const realFiles = buildClientConfigFiles({
        platform: selectedKey.group?.platform,
        clientId: activeClient,
        shellId: activeShell,
        baseUrl,
        apiKey: realKey,
      });
      const payload = typeof index === "number" ? realFiles[index]?.content ?? "" : copyPayload(realFiles);
      await navigator.clipboard.writeText(payload);
      setCopiedIndex(typeof index === "number" ? index : "all");
      window.setTimeout(() => setCopiedIndex(null), 2000);
    } catch (reason) {
      setError(errorMessage(reason, "apiKeyCopyFailed"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("installGuide.title")}</h1>
        <p className="text-sm text-zinc-500">{t("installGuide.description")}</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {resolveLocalizedMessage(error)}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <div className="space-y-12">
            <InstallStep step={1} title={t("installGuide.chooseApiKey")}>
              <div className="space-y-4">
                <p className="text-sm text-zinc-500">
                  {t("installGuide.chooseApiKeyDescription")}
                </p>
                {loading ? (
                  <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-500">
                    {t("installGuide.loadingKeys")}
                  </div>
                ) : keys.length === 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
                    {t("installGuide.noActiveKey")}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {keys.map((key) => (
                      <button
                        key={key.id}
                        type="button"
                        onClick={() => {
                          setSelectedKeyId(key.id);
                          setRevealedKey(null);
                        }}
                        className={`flex items-center justify-between rounded-xl border p-4 text-left transition-all ${
                          selectedKey?.id === key.id ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white hover:border-zinc-400"
                        }`}
                      >
                        <span>
                          <span className="block text-sm font-bold text-zinc-900">{key.name}</span>
                          <span className="mt-1 block text-xs font-mono text-zinc-400">{maskKey(key.key, t("installGuide.selectApiKey"))}</span>
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                          {key.status === "active" ? t("installGuide.statusActive") : key.status}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </InstallStep>

            <InstallStep step={2} title={t("installGuide.selectClient")}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {clientOptions.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setSelectedClient(client.id);
                        setSelectedShell(normalizeShellForClient(client.id, activeShell));
                      }}
                      className={`rounded-xl border p-4 text-center text-sm font-bold transition-all ${
                        activeClient === client.id
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 text-zinc-900 hover:border-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      {client.label}
                    </button>
                  ))}
                </div>

                {shellOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {shellOptions.map((shell) => (
                      <button
                        key={shell.id}
                        type="button"
                        onClick={() => setSelectedShell(shell.id)}
                        className={`rounded-full border px-4 py-2 text-xs font-bold transition ${
                          activeShell === shell.id
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"
                        }`}
                      >
                        {shell.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </InstallStep>

            <InstallStep step={3} title={t("installGuide.configureFiles")}>
              <div className="space-y-4">
                <p className="text-sm text-zinc-500">
                  {t("installGuide.endpointPrefix")} <code className="rounded bg-zinc-100 px-1 font-mono">{baseUrl}</code>. {t("installGuide.endpointDescription")}
                </p>

                {files.map((file, index) => (
                  <div key={`${file.path}-${index}`} className="space-y-2">
                    {file.hintId ? <p className="text-xs font-medium text-amber-600">{t(CLIENT_CONFIG_HINT_KEYS[file.hintId])}</p> : null}
                    <div className="group relative rounded-xl bg-zinc-900">
                      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
                        <span className="font-mono text-xs text-zinc-400">{file.path}</span>
                        <button
                          type="button"
                          onClick={() => void copyConfig(index)}
                          disabled={copying || !selectedKey}
                          aria-label={t("installGuide.copyFile", { path: file.path })}
                          className="rounded-lg border border-white/10 bg-white/5 p-2 text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {copiedIndex === index ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                        </button>
                      </div>
                      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
                        <code>{file.content}</code>
                      </pre>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => void copyConfig()}
                  disabled={copying || !selectedKey}
                  className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  {copiedIndex === "all" ? <Check size={16} /> : <Copy size={16} />}
                  {copying ? t("installGuide.copying") : t("installGuide.copyAll")}
                </button>
              </div>
            </InstallStep>

            <InstallStep step={4} title={t("installGuide.verifyConnection")}>
              <div className="flex items-center gap-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-6 text-emerald-900">
                <CheckCircle size={24} weight="fill" />
                <div className="text-sm">
                  <span className="font-bold">{t("installGuide.smokeTestLabel")}</span> {t("installGuide.smokeTestDescription")}
                </div>
              </div>
            </InstallStep>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-[2rem] border border-zinc-200 bg-zinc-50 p-8">
            <Question size={32} weight="duotone" className="text-zinc-400" />
            <h3 className="font-bold text-zinc-900">{t("installGuide.needHelp")}</h3>
            <p className="text-sm leading-relaxed text-zinc-500">
              {t("installGuide.helpDescription")}
            </p>
            <a href="/console/api-keys" className="group flex items-center gap-2 text-sm font-bold text-zinc-900">
              {t("installGuide.manageApiKeys")}
              <ArrowRight size={16} weight="bold" className="transition-transform group-hover:translate-x-1" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallStep({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-12">
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white shadow-lg">
        {step}
      </div>
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-zinc-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}
