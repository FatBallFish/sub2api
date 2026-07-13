import { useEffect, useState, type FormEvent } from "react";
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
  UploadSimple
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { createApiKey, deleteApiKey, listApiKeys, revealApiKey, updateApiKey } from "../../api/keys";
import { listAvailableGroups, type AvailableGroup } from "../../api/groups";
import { getAPIKeysUsageStats } from "../../api/usage";
import { getPublicSettings, type PublicSettings } from "../../api/settings";
import type { ApiKey } from "../../types/keys";
import type { APIKeyUsageStats } from "../../types/usage";
import { buildCcSwitchImportDeeplink, gatewayBaseUrl, type CcSwitchClientType } from "../../utils/clientConfig";
import { formatCredits } from "../../utils/format";

const tabs = [
  { label: "All Keys", status: "all" },
  { label: "Active", status: "active" },
  { label: "Disabled", status: "inactive" },
  { label: "Exhausted", status: "quota_exhausted" },
];

function maskKey(value: string) {
  if (!value) return "sk-....";
  if (value.includes("....")) return value;
  if (value.startsWith("sk-")) return `sk-....${value.slice(-4)}`;
  return `${value.slice(0, 3)}-....${value.slice(-4)}`;
}

function formatUsage(key: ApiKey, stats?: APIKeyUsageStats) {
  const used = stats?.total_actual_cost ?? key.quota_used;
  if (!key.quota) return `${formatCredits(used)} / Unlimited`;
  return `${formatCredits(used)} / ${formatCredits(key.quota)}`;
}

function formatPlatform(value?: string) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return "Auto";
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
  const existing = key.group;
  if (existing?.id === groupId && existing.name && existing.rate_multiplier !== undefined) return key;
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

function relativeTime(value: string | null) {
  if (!value) return "Never";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Recently";
  const diffMinutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

export default function ApiKeys() {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [activeStatus, setActiveStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("Local Development");
  const [createQuota, setCreateQuota] = useState("");
  const [groups, setGroups] = useState<AvailableGroup[]>([]);
  const [usageStats, setUsageStats] = useState<Record<number, APIKeyUsageStats>>({});
  const [createGroupId, setCreateGroupId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [savingActionId, setSavingActionId] = useState<number | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [importingCcsId, setImportingCcsId] = useState<number | null>(null);
  const [pendingCcsKey, setPendingCcsKey] = useState<ApiKey | null>(null);

  useEffect(() => {
    let active = true;

    listApiKeys({ page: 1, pageSize: 10, status: activeStatus })
      .then((data) => {
        if (active) {
          setKeys(data.items);
          setError(null);
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
          setError(reason instanceof Error ? reason.message : "Unable to load API keys.");
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
    listAvailableGroups()
      .then((data) => {
        if (active) setGroups(Array.isArray(data) ? data : []);
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
    const revealed = await revealApiKey(key.id);
    await navigator.clipboard.writeText(revealed.key);
    setCopiedId(key.id);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  const executeCcsImport = async (key: ApiKey, clientType: CcSwitchClientType) => {
    setImportingCcsId(key.id);
    setError(null);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to import this key to CCSwitch.");
    } finally {
      setImportingCcsId(null);
      setPendingCcsKey(null);
    }
  };

  const importToCcswitch = (key: ApiKey) => {
    if (key.group?.platform === "antigravity") {
      setPendingCcsKey(key);
      return;
    }
    void executeCcsImport(key, key.group?.platform === "gemini" ? "gemini" : "claude");
  };

  const changeStatus = (status: string) => {
    setActiveStatus(status);
    setLoading(true);
  };

  const closeKeyModal = () => {
    setShowCreateModal(false);
    setEditingKey(null);
    setCreateName("Local Development");
    setCreateQuota("");
    setCreateGroupId("");
    setGroupPickerOpen(false);
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
    setCreating(true);
    setError(null);
    try {
      const quota = createQuota.trim() ? Number(createQuota) : undefined;
      const groupID = createGroupId ? Number(createGroupId) : null;
      const payload = {
        name: createName.trim(),
        quota: quota && Number.isFinite(quota) ? quota : undefined,
        ...(!editingKey || groupID !== (editingKey.group_id ?? null) ? { group_id: groupID } : {}),
      };
      if (editingKey) {
        const updated = await updateApiKey(editingKey.id, payload);
        const hydrated = hydrateApiKeyGroup(updated, groups);
        setKeys((current) => current.map((item) => (item.id === hydrated.id ? hydrated : item)));
      } else {
        const created = await createApiKey(payload);
        const hydrated = hydrateApiKeyGroup(created, groups);
        setKeys((current) => [hydrated, ...current.filter((item) => item.id !== hydrated.id)]);
      }
      closeKeyModal();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save API key.");
    } finally {
      setCreating(false);
    }
  };

  const setKeyStatus = async (key: ApiKey, status: "active" | "inactive") => {
    setSavingActionId(key.id);
    setError(null);
    try {
      const updated = await updateApiKey(key.id, { status });
      setKeys((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update API key.");
    } finally {
      setSavingActionId(null);
    }
  };

  const removeKey = async (key: ApiKey) => {
    setSavingActionId(key.id);
    setError(null);
    try {
      await deleteApiKey(key.id);
      setKeys((current) => current.filter((item) => item.id !== key.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete API key.");
    } finally {
      setSavingActionId(null);
    }
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">API keys unavailable</h1>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">API Keys</h1>
          <p className="text-zinc-500 text-sm">Create and manage access credentials for your AI coding clients.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-zinc-800 transition-colors"
        >
          <Plus size={18} weight="bold" />
          Create New Key
        </button>
      </div>

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
            {tab.label}
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
          Loading API keys...
        </div>
      )}

      {/* Keys Table */}
      {!loading && (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50/50 border-b border-zinc-200">
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">Name</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">Group</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">Key</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">Usage</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">Last Used</th>
              <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {keys.map((key) => (
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
                      aria-label={`Copy ${key.name}`}
                      className="p-1 text-zinc-400 hover:text-zinc-900 transition-colors"
                    >
                      {copiedId === key.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-medium text-zinc-900">{formatUsage(key, usageStats[key.id])}</td>
                <td className="px-6 py-4 text-sm text-zinc-500">{relativeTime(key.last_used_at)}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      to={`/console/install-guide?key=${key.id}`}
                      aria-label={`Open install guide for ${key.name}`}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                    >
                      <Terminal size={18} />
                    </Link>
                    {!settings?.hide_ccs_import_button ? (
                      <button
                        type="button"
                        disabled={importingCcsId === key.id}
                        onClick={() => importToCcswitch(key)}
                        aria-label={`Import ${key.name} to CCSwitch`}
                        className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <UploadSimple size={18} weight="bold" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openEdit(key)}
                      aria-label={`Edit ${key.name}`}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                    >
                      <PencilSimple size={18} weight="bold" />
                    </button>
                    <button
                      type="button"
                      disabled={savingActionId === key.id}
                      onClick={() => void setKeyStatus(key, key.status === "active" ? "inactive" : "active")}
                      aria-label={`${key.status === "active" ? "Disable" : "Enable"} ${key.name}`}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <PauseCircle size={18} weight="bold" />
                    </button>
                    <button
                      type="button"
                      disabled={savingActionId === key.id}
                      onClick={() => void removeKey(key)}
                      aria-label={`Delete ${key.name}`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div>
              <h2 className="text-lg font-bold text-zinc-950">Import to CCSwitch</h2>
              <p className="mt-1 text-sm text-zinc-500">
                This Antigravity group supports multiple client types. Choose which CCSwitch client profile to create.
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
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
            <button
              type="button"
              onClick={() => setPendingCcsKey(null)}
              className="mt-4 w-full rounded-xl border border-zinc-200 py-3 text-sm font-bold text-zinc-600 transition hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Security Banner */}
      <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl flex items-start gap-4">
        <div className="p-2 bg-white rounded-lg border border-zinc-200 shadow-sm">
          <ShieldCheck size={24} className="text-zinc-400" />
        </div>
        <div className="space-y-1">
          <h4 className="font-semibold text-zinc-900">Security Best Practices</h4>
          <p className="text-sm text-zinc-500 leading-relaxed max-w-2xl">
            Never share your API keys or check them into source control. Each key is encrypted at rest.
            We recommend using separate keys for local development and CI/CD environments.
          </p>
        </div>
      </div>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <form onSubmit={submitKeyForm} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-zinc-950">{editingKey ? "Edit API Key" : "Create API Key"}</h2>
              <p className="text-sm text-zinc-500">
                {editingKey ? "Update the key label and usage quota." : "Generate a key for one environment or client."}
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label htmlFor="create-key-name" className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  Key Name
                </label>
                <input
                  id="create-key-name"
                  required
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <span id="create-key-group-label" className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  Group
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
                  Quota
                </label>
                <input
                  id="create-key-quota"
                  type="number"
                  min="0"
                  step="0.01"
                  value={createQuota}
                  onChange={(event) => setCreateQuota(event.target.value)}
                  placeholder="Unlimited"
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeKeyModal}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {creating ? "Saving..." : editingKey ? "Save Changes" : "Create Key"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-100",
    exhausted: "bg-amber-50 text-amber-700 border-amber-100",
    disabled: "bg-zinc-100 text-zinc-600 border-zinc-200",
  };

  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${styles[status] || styles.disabled}`}>
      {status}
    </span>
  );
}

function GroupSummary({ group }: { group?: ApiKey["group"] }) {
  if (!group) {
    return <span className="text-zinc-400">Unassigned</span>;
  }

  return (
    <div className="min-w-44">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-900">{group.name}</span>
        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          {formatPlatform(group.platform)}
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
  const selected = groups.find((group) => String(group.id) === value);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    onOpenChange(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Select group"
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
                <span>{formatPlatform(selected.platform)}</span>
                <span>{formatMultiplier(selected.rate_multiplier)}</span>
              </span>
            </>
          ) : (
            <>
              <span className="block font-semibold text-zinc-900">Unassigned</span>
              <span className="mt-1 block text-xs text-zinc-400">No fixed routing group</span>
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
            <span className="block text-sm font-bold">Unassigned</span>
            <span className={`mt-1 block text-xs ${!value ? "text-zinc-300" : "text-zinc-500"}`}>No fixed routing group</span>
          </button>
          {groups.map((group) => {
            const selectedOption = String(group.id) === value;
            const label = [
              group.name,
              group.description,
              formatPlatform(group.platform),
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
                      {formatPlatform(group.platform)}
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
