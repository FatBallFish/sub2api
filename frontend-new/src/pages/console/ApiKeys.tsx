import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Copy,
  Terminal,
  Check,
  ShieldCheck,
  PencilSimple,
  PauseCircle,
  Trash,
  CaretDown,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { createApiKey, deleteApiKey, listApiKeys, revealApiKey, updateApiKey } from "../../api/keys";
import { getUserGroupRates, listAvailableGroups, type AvailableGroup } from "../../api/groups";
import { getAPIKeysUsageStats } from "../../api/usage";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import type { ApiKey } from "../../types/keys";
import type { APIKeyUsageStats } from "../../types/usage";
import { buildCcSwitchImportDeeplink, gatewayBaseUrl, type CcSwitchClientType } from "../../utils/clientConfig";
import { formatCredits } from "../../utils/format";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  errorMessage,
  resolveLocalizedMessage,
  translationMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const tabs = [
  { labelKey: "apiKeys.allKeys", status: "all" },
  { labelKey: "apiKeys.active", status: "active" },
  { labelKey: "apiKeys.disabled", status: "inactive" },
  { labelKey: "apiKeys.exhausted", status: "quota_exhausted" },
] as const;

function maskKey(value: string) {
  if (!value) return "sk-....";
  if (value.includes("....")) return value;
  if (value.startsWith("sk-")) return `sk-....${value.slice(-4)}`;
  return `${value.slice(0, 3)}-....${value.slice(-4)}`;
}

function formatUsage(key: ApiKey, locale: string, t: TFunction<"console">, stats?: APIKeyUsageStats) {
  const used = stats?.total_actual_cost ?? key.quota_used;
  if (!key.quota) return `${formatCredits(used, locale)} / ${t("apiKeys.unlimited")}`;
  return `${formatCredits(used, locale)} / ${formatCredits(key.quota, locale)}`;
}

function formatPlatform(value: string | undefined, t: TFunction<"console">) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return t("apiKeys.platformAuto");
  const labels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Claude",
    claude: "Claude",
    gemini: "Gemini",
    antigravity: "Antigravity",
  };
  return labels[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatMultiplier(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "1.000x";
  return `${value.toFixed(3)}x`;
}

function hydrateApiKeyGroup(key: ApiKey, groups: AvailableGroup[]): ApiKey {
  const groupId = key.group_id;
  if (!groupId) return { ...key, group: undefined };
  const group = groups.find((item) => item.id === groupId);
  if (!group) return key;
  return {
    ...key,
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      platform: group.platform,
      rate_multiplier: group.rate_multiplier,
    },
  };
}

function applyEffectiveGroupRate(key: ApiKey, groups: AvailableGroup[], userRates: Record<string, number>) {
  const hydrated = hydrateApiKeyGroup(key, groups);
  const userRate = hydrated.group_id ? userRates[String(hydrated.group_id)] : undefined;
  if (!hydrated.group || typeof userRate !== "number" || !Number.isFinite(userRate) || userRate <= 0) return hydrated;
  return { ...hydrated, group: { ...hydrated.group, rate_multiplier: userRate } };
}

function relativeTime(value: string | null, t: TFunction<"console">) {
  if (!value) return t("apiKeys.never");
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return t("apiKeys.recently");
  const diffMinutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0);
  if (diffMinutes < 1) return t("apiKeys.justNow");
  if (diffMinutes < 60) return t("apiKeys.minutesAgo", { count: diffMinutes });
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t("apiKeys.hoursAgo", { count: diffHours });
  return t("apiKeys.daysAgo", { count: Math.round(diffHours / 24) });
}

export default function ApiKeys() {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [activeStatus, setActiveStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<LocalizedMessage | null>(null);
  const [actionError, setActionError] = useState<LocalizedMessage | null>(null);
  const [feedback, setFeedback] = useState<LocalizedMessage | null>(null);
  const [formError, setFormError] = useState<LocalizedMessage | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createQuota, setCreateQuota] = useState("");
  const [groups, setGroups] = useState<AvailableGroup[]>([]);
  const [userGroupRates, setUserGroupRates] = useState<Record<string, number>>({});
  const [usageStats, setUsageStats] = useState<Record<number, APIKeyUsageStats>>({});
  const [createGroupId, setCreateGroupId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [savingActionId, setSavingActionId] = useState<number | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [importingCcsId, setImportingCcsId] = useState<number | null>(null);
  const [pendingCcsKey, setPendingCcsKey] = useState<ApiKey | null>(null);
  const [ccsImportError, setCcsImportError] = useState<LocalizedMessage | null>(null);
  const createNameInputRef = useRef<HTMLInputElement>(null);
  const ccsInitialFocusRef = useRef<HTMLButtonElement>(null);
  const createDialogTitleId = useId();
  const ccsDialogTitleId = useId();
  const displayKeys = useMemo(
    () => keys.map((key) => applyEffectiveGroupRate(key, groups, userGroupRates)),
    [groups, keys, userGroupRates],
  );
  usePageTitle(t("apiKeys.title"));

  useEffect(() => {
    let active = true;

    listApiKeys({ page: 1, pageSize: 10, status: activeStatus })
      .then((data) => {
        if (active) {
          setKeys(data.items);
          setFatalError(null);
          if (data.items.length === 0) {
            setUsageStats({});
            return;
          }
          getAPIKeysUsageStats(data.items.map((key) => key.id))
            .then((usageData) => {
              if (!active) return;
              const stats: Record<string, APIKeyUsageStats> = usageData.stats ?? {};
              setUsageStats(
                Object.entries(stats).reduce<Record<number, APIKeyUsageStats>>(
                  (result, [key, value]) => {
                    result[Number(key)] = value;
                    return result;
                  },
                  {},
                ),
              );
            })
            .catch(() => {
              if (active) setUsageStats({});
            });
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setFatalError(errorMessage(reason, "apiKeysLoadFailed", "apiKeys"));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeStatus]);

  useEffect(() => {
    let active = true;
    Promise.all([listAvailableGroups(), getUserGroupRates().catch((): Record<string, number> => ({}))])
      .then(([data, userRates]) => {
        if (!active) return;
        const effectiveGroups = (Array.isArray(data) ? data : []).map((group) => {
          const userRate = userRates[String(group.id)];
          return Number.isFinite(userRate) && userRate > 0
            ? { ...group, rate_multiplier: userRate }
            : group;
        });
        setGroups(effectiveGroups);
        setUserGroupRates(userRates);
      })
      .catch(() => {
        if (active) setGroups([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getPublicSettings()
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch(() => {
        if (active) setSettings({});
      });
    return () => {
      active = false;
    };
  }, []);

  const copyKey = async (key: ApiKey) => {
    setActionError(null);
    setFeedback(null);
    let revealed: Awaited<ReturnType<typeof revealApiKey>>;
    try {
      revealed = await revealApiKey(key.id);
    } catch (reason) {
      setActionError(errorMessage(reason, "apiKeyRevealFailed", "apiKeys"));
      return;
    }
    try {
      await navigator.clipboard.writeText(revealed.key);
      setCopiedId(key.id);
      setFeedback(translationMessage("console:apiKeys.copied", { name: key.name }));
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch (reason) {
      setActionError(errorMessage(reason, "apiKeyCopyFailed", "apiKeys"));
    }
  };

  const executeCcsImport = async (key: ApiKey, clientType: CcSwitchClientType) => {
    const fromChooser = pendingCcsKey?.id === key.id;
    setImportingCcsId(key.id);
    if (fromChooser) setCcsImportError(null);
    else setActionError(null);
    setFeedback(null);
    try {
      const revealed = await revealApiKey(key.id);
      const providerName = (settings?.site_name || "Mikiko CC").trim() || "Mikiko CC";
      const deeplink = buildCcSwitchImportDeeplink({
        baseUrl: gatewayBaseUrl(settings?.api_base_url),
        platform: key.group?.platform,
        clientType,
        providerName,
        apiKey: revealed.key,
      });
      window.open(deeplink, "_self");
      setPendingCcsKey(null);
      setCcsImportError(null);
    } catch (reason) {
      const message = errorMessage(reason, "apiKeyImportFailed", "apiKeys");
      if (fromChooser) setCcsImportError(message);
      else setActionError(message);
    } finally {
      setImportingCcsId(null);
    }
  };

  const importToCcswitch = (key: ApiKey) => {
    if (key.group?.platform === "antigravity") {
      setCcsImportError(null);
      setPendingCcsKey(key);
      return;
    }
    void executeCcsImport(key, key.group?.platform === "gemini" ? "gemini" : "claude");
  };

  const changeStatus = (status: string) => {
    if (status === activeStatus) return;
    setActiveStatus(status);
    setLoading(true);
  };

  const closeCcsImport = () => {
    setPendingCcsKey(null);
    setCcsImportError(null);
  };

  const closeKeyModal = () => {
    setShowCreateModal(false);
    setEditingKey(null);
    setCreateName("");
    setCreateQuota("");
    setCreateGroupId("");
    setGroupPickerOpen(false);
    setFormError(null);
  };

  const openCreate = () => {
    setEditingKey(null);
    setCreateName(t("apiKeys.defaultName"));
    setCreateQuota("");
    setCreateGroupId("");
    setGroupPickerOpen(false);
    setFormError(null);
    setShowCreateModal(true);
  };

  const openEdit = (key: ApiKey) => {
    setEditingKey(key);
    setCreateName(key.name);
    setCreateQuota(key.quota ? String(key.quota) : "");
    setCreateGroupId(key.group_id ? String(key.group_id) : "");
    setGroupPickerOpen(false);
    setShowCreateModal(true);
  };

  const submitKeyForm = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = createName.trim();
    if (!normalizedName) {
      setFormError(translationMessage("console:apiKeys.nameRequired"));
      return;
    }
    const normalizedQuota = createQuota.trim();
    const parsedQuota = normalizedQuota ? Number(normalizedQuota) : undefined;
    if (parsedQuota !== undefined && (!Number.isFinite(parsedQuota) || parsedQuota < 0)) {
      setFormError(translationMessage("console:apiKeys.quotaInvalid"));
      return;
    }
    setCreating(true);
    setFormError(null);
    setFeedback(null);
    setFormError(null);
    try {
      const groupID = createGroupId ? Number(createGroupId) : null;
      const payload = {
        name: normalizedName,
        quota: parsedQuota,
        ...(!editingKey || groupID !== (editingKey.group_id ?? null) ? { group_id: groupID } : {}),
      };
      if (editingKey) {
        const updated = await updateApiKey(editingKey.id, payload);
        const hydrated = hydrateApiKeyGroup(updated, groups);
        setKeys((current) => current.map((item) => (item.id === hydrated.id ? hydrated : item)));
        setFeedback(translationMessage("console:apiKeys.updated", { name: hydrated.name }));
      } else {
        const created = await createApiKey(payload);
        const hydrated = hydrateApiKeyGroup(created, groups);
        setKeys((current) => [hydrated, ...current.filter((item) => item.id !== hydrated.id)]);
        setFeedback(translationMessage("console:apiKeys.created", { name: hydrated.name }));
      }
      closeKeyModal();
    } catch (reason) {
      setFormError(errorMessage(reason, "apiKeySaveFailed", "apiKeys"));
    } finally {
      setCreating(false);
    }
  };

  const setKeyStatus = async (key: ApiKey, status: "active" | "inactive") => {
    setSavingActionId(key.id);
    setActionError(null);
    setFeedback(null);
    try {
      const updated = await updateApiKey(key.id, { status });
      setKeys((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setFeedback(translationMessage(
        status === "active" ? "console:apiKeys.enabledSuccess" : "console:apiKeys.disabledSuccess",
        { name: key.name },
      ));
    } catch (reason) {
      setActionError(errorMessage(reason, "apiKeyUpdateFailed", "apiKeys"));
    } finally {
      setSavingActionId(null);
    }
  };

  const removeKey = async (key: ApiKey) => {
    setSavingActionId(key.id);
    setActionError(null);
    setFeedback(null);
    try {
      await deleteApiKey(key.id);
      setKeys((current) => current.filter((item) => item.id !== key.id));
      setFeedback(translationMessage("console:apiKeys.deleted", { name: key.name }));
    } catch (reason) {
      setActionError(errorMessage(reason, "apiKeyDeleteFailed", "apiKeys"));
    } finally {
      setSavingActionId(null);
    }
  };

  if (fatalError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">{t("apiKeys.unavailable")}</h1>
        <p className="mt-2">{resolveLocalizedMessage(fatalError)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("apiKeys.title")}</h1>
          <p className="text-zinc-500 text-sm">{t("apiKeys.description")}</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-zinc-800 transition-colors"
        >
          <Plus size={18} weight="bold" />
          {t("apiKeys.createNew")}
        </button>
      </div>

      {feedback ? (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {resolveLocalizedMessage(feedback)}
        </div>
      ) : null}

      {actionError ? (
        <DismissibleAlert message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}

      {/* Filters */}
      <div className="flex items-center gap-2 border-b border-zinc-200">
        {tabs.map((tab) => (
          <button
            key={tab.status}
            onClick={() => changeStatus(tab.status)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeStatus === tab.status ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {t(tab.labelKey)}
            {activeStatus === tab.status && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900"
              />
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
          {t("apiKeys.loading")}
        </div>
      )}

      {/* Keys Table */}
      {!loading && (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50/50 border-b border-zinc-200">
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">{t("apiKeys.name")}</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">{t("apiKeys.group")}</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">{t("apiKeys.key")}</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">{t("apiKeys.usage")}</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">{t("apiKeys.lastUsed")}</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest text-right">{t("apiKeys.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {displayKeys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-sm text-zinc-400">
                  {t("apiKeys.empty")}
                </td>
              </tr>
            ) : displayKeys.map((key) => (
              <tr key={key.id} className="group hover:bg-zinc-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-900">{key.name}</span>
                    <StatusBadge status={key.status} />
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-500">
                  <GroupSummary group={key.group} />
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded border border-zinc-200/50">
                      {maskKey(key.key)}
                    </code>
                    <button
                      onClick={() => void copyKey(key)}
                      aria-label={t("apiKeys.copy", { name: key.name })}
                      className="p-1 text-zinc-400 hover:text-zinc-900 transition-colors"
                    >
                      {copiedId === key.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-medium text-zinc-900">{formatUsage(key, locale, t, usageStats[key.id])}</td>
                <td className="px-6 py-4 text-sm text-zinc-500">{relativeTime(key.last_used_at, t)}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      to={`/console/install-guide?key=${key.id}`}
                      aria-label={t("apiKeys.installGuide", { name: key.name })}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                    >
                      <Terminal size={18} />
                    </Link>
                    {!settings?.hide_ccs_import_button ? (
                      <button
                        type="button"
                        disabled={importingCcsId === key.id}
                        onClick={() => importToCcswitch(key)}
                        aria-label={t("apiKeys.importCcswitch", { name: key.name })}
                        className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <UploadSimple size={18} weight="bold" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openEdit(key)}
                      aria-label={t("apiKeys.edit", { name: key.name })}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                    >
                      <PencilSimple size={18} weight="bold" />
                    </button>
                    <button
                      type="button"
                      disabled={savingActionId === key.id}
                      onClick={() => void setKeyStatus(key, key.status === "active" ? "inactive" : "active")}
                      aria-label={t(key.status === "active" ? "apiKeys.disable" : "apiKeys.enable", { name: key.name })}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <PauseCircle size={18} weight="bold" />
                    </button>
                    <button
                      type="button"
                      disabled={savingActionId === key.id}
                      onClick={() => void removeKey(key)}
                      aria-label={t("apiKeys.delete", { name: key.name })}
                      className="p-2 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash size={18} weight="bold" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {pendingCcsKey ? (
        <AccessibleModal
          labelledBy={ccsDialogTitleId}
          initialFocusRef={ccsInitialFocusRef}
          onClose={closeCcsImport}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
        >
            <div>
              <h2 id={ccsDialogTitleId} className="text-lg font-bold text-zinc-950">{t("apiKeys.importTitle")}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {t("apiKeys.importDescription")}
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                ref={ccsInitialFocusRef}
                type="button"
                onClick={() => void executeCcsImport(pendingCcsKey, "claude")}
                className="rounded-xl border border-zinc-200 p-4 text-sm font-bold text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-50"
              >
                Claude Code
              </button>
              <button
                type="button"
                onClick={() => void executeCcsImport(pendingCcsKey, "gemini")}
                className="rounded-xl border border-zinc-200 p-4 text-sm font-bold text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-50"
              >
                Gemini CLI
              </button>
            </div>
            {ccsImportError ? (
              <div className="mt-4">
                <DismissibleAlert message={ccsImportError} onDismiss={() => setCcsImportError(null)} compact />
              </div>
            ) : null}
            <button
              type="button"
              onClick={closeCcsImport}
              className="mt-4 w-full rounded-xl border border-zinc-200 py-3 text-sm font-bold text-zinc-600 transition hover:bg-zinc-50"
            >
              {t("apiKeys.cancel")}
            </button>
        </AccessibleModal>
      ) : null}

      {/* Security Banner */}
      <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl flex items-start gap-4">
        <div className="p-2 bg-white rounded-lg border border-zinc-200 shadow-sm">
          <ShieldCheck size={24} className="text-zinc-400" />
        </div>
        <div className="space-y-1">
          <h4 className="font-semibold text-zinc-900">{t("apiKeys.securityTitle")}</h4>
          <p className="text-sm text-zinc-500 leading-relaxed max-w-2xl">
            {t("apiKeys.securityDescription")}
          </p>
        </div>
      </div>

      {showCreateModal ? (
        <AccessibleModal
          labelledBy={createDialogTitleId}
          initialFocusRef={createNameInputRef}
          onClose={closeKeyModal}
          className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        >
          <form noValidate onSubmit={submitKeyForm}>
            <div className="space-y-1">
              <h2 id={createDialogTitleId} className="text-lg font-bold text-zinc-950">{t(editingKey ? "apiKeys.editTitle" : "apiKeys.createTitle")}</h2>
              <p className="text-sm text-zinc-500">
                {t(editingKey ? "apiKeys.editDescription" : "apiKeys.createDescription")}
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label htmlFor="create-key-name" className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  {t("apiKeys.keyName")}
                </label>
                <input
                  ref={createNameInputRef}
                  id="create-key-name"
                  required
                  value={createName}
                  onChange={(event) => {
                    setCreateName(event.target.value);
                    setFormError(null);
                  }}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <span id="create-key-group-label" className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  {t("apiKeys.group")}
                </span>
                <GroupPicker
                  groups={groups}
                  value={createGroupId}
                  open={groupPickerOpen}
                  onOpenChange={setGroupPickerOpen}
                  onChange={setCreateGroupId}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="create-key-quota" className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  {t("apiKeys.quota")}
                </label>
                <input
                  id="create-key-quota"
                  type="number"
                  min="0"
                  step="0.01"
                  value={createQuota}
                  onChange={(event) => {
                    setCreateQuota(event.target.value);
                    setFormError(null);
                  }}
                  placeholder={t("apiKeys.unlimited")}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
            </div>

            {formError ? (
              <div className="mt-4">
                <DismissibleAlert message={formError} onDismiss={() => setFormError(null)} compact />
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeKeyModal}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-50"
              >
                {t("apiKeys.cancel")}
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {creating ? t("apiKeys.saving") : t(editingKey ? "apiKeys.saveChanges" : "apiKeys.createKey")}
              </button>
            </div>
          </form>
        </AccessibleModal>
      ) : null}
    </div>
  );
}

function DismissibleAlert({
  message,
  onDismiss,
  compact = false,
}: {
  message: LocalizedMessage;
  onDismiss: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation("console");
  return (
    <div
      role="alert"
      className={compact
        ? "flex items-start justify-between gap-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
        : "flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"}
    >
      <span>{resolveLocalizedMessage(message)}</span>
      <button
        type="button"
        aria-label={t("apiKeys.dismissError")}
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-rose-500 hover:bg-rose-100 hover:text-rose-800"
      >
        <X size={16} weight="bold" />
      </button>
    </div>
  );
}

function AccessibleModal({
  labelledBy,
  initialFocusRef,
  onClose,
  className,
  children,
}: {
  labelledBy: string;
  initialFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  className: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap({
    active: true,
    containerRef: dialogRef,
    initialFocusRef,
    onEscape: onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={className}
      >
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("console");
  const styles: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-100",
    exhausted: "bg-amber-50 text-amber-700 border-amber-100",
    quota_exhausted: "bg-amber-50 text-amber-700 border-amber-100",
    disabled: "bg-zinc-100 text-zinc-600 border-zinc-200",
    inactive: "bg-zinc-100 text-zinc-600 border-zinc-200",
  };

  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${styles[status] || styles.disabled}`}>
      {status === "active"
        ? t("apiKeys.statusActive")
        : status === "quota_exhausted" || status === "exhausted"
          ? t("apiKeys.statusExhausted")
          : status === "inactive" || status === "disabled"
            ? t("apiKeys.statusDisabled")
            : status}
    </span>
  );
}

function GroupSummary({ group }: { group?: ApiKey["group"] }) {
  const { t } = useTranslation("console");
  if (!group) {
    return <span className="text-zinc-400">{t("apiKeys.unassigned")}</span>;
  }

  return (
    <div className="min-w-44">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-900">{group.name}</span>
        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          {formatPlatform(group.platform, t)}
        </span>
        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          {formatMultiplier(group.rate_multiplier)}
        </span>
      </div>
      {group.description ? (
        <p className="mt-1 max-w-56 truncate text-xs text-zinc-400" title={group.description}>
          {group.description}
        </p>
      ) : null}
    </div>
  );
}

function GroupPicker({
  groups,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  groups: AvailableGroup[];
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("console");
  const selected = groups.find((group) => String(group.id) === value);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    onOpenChange(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("apiKeys.selectGroup")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left text-sm outline-none transition-all hover:border-zinc-300 focus:border-zinc-900"
      >
        <span className="min-w-0">
          {selected ? (
            <>
              <span className="block truncate font-semibold text-zinc-900">{selected.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                <span>{formatPlatform(selected.platform, t)}</span>
                <span>{formatMultiplier(selected.rate_multiplier)}</span>
              </span>
            </>
          ) : (
            <>
              <span className="block font-semibold text-zinc-900">{t("apiKeys.unassigned")}</span>
              <span className="mt-1 block text-xs text-zinc-400">{t("apiKeys.noFixedGroup")}</span>
            </>
          )}
        </span>
        <CaretDown size={16} weight="bold" className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-labelledby="create-key-group-label"
          className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-2xl"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => choose("")}
            className={`w-full rounded-xl px-3 py-3 text-left transition-all ${!value ? "bg-zinc-900 text-white" : "hover:bg-zinc-50"}`}
          >
            <span className="block text-sm font-bold">{t("apiKeys.unassigned")}</span>
            <span className={`mt-1 block text-xs ${!value ? "text-zinc-300" : "text-zinc-500"}`}>{t("apiKeys.noFixedGroup")}</span>
          </button>
          {groups.map((group) => {
            const selectedOption = String(group.id) === value;
            const label = [
              group.name,
              group.description,
              formatPlatform(group.platform, t),
              formatMultiplier(group.rate_multiplier),
            ].filter(Boolean).join(" ");
            return (
              <button
                key={group.id}
                type="button"
                role="option"
                aria-label={label}
                aria-selected={selectedOption}
                onClick={() => choose(String(group.id))}
                className={`mt-1 w-full rounded-xl px-3 py-3 text-left transition-all ${
                  selectedOption ? "bg-zinc-900 text-white" : "hover:bg-zinc-50"
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{group.name}</span>
                    {group.description ? (
                      <span className={`mt-1 block truncate text-xs ${selectedOption ? "text-zinc-300" : "text-zinc-500"}`}>
                        {group.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${selectedOption ? "bg-white/10 text-white" : "bg-zinc-100 text-zinc-600"}`}>
                      {formatPlatform(group.platform, t)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${selectedOption ? "bg-emerald-400/20 text-emerald-100" : "bg-emerald-50 text-emerald-700"}`}>
                      {formatMultiplier(group.rate_multiplier)}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
