import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Bell,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Zap,
  Pencil,
  MessageSquare,
} from "lucide-react";
import {
  getNotificationPublishers,
  createNotificationPublisher,
  updateNotificationPublisher,
  deleteNotificationPublisher,
  addNotificationPublisherMapping,
  updateNotificationPublisherMapping,
  removeNotificationPublisherMapping,
  testNotificationChannel,
  testNotificationPublisher,
  getEquipments,
  getZones,
  getRecipeInstances,
  getRecipes,
} from "../api";
import type {
  NotificationPublisherWithMappings,
  NotificationPublisherMapping,
  TelegramChannelConfig,
  EquipmentWithDetails,
  ZoneWithChildren,
  RecipeInstance,
  RecipeInfo,
} from "../types";

const ZONE_AGG_KEYS = [
  "temperature",
  "humidity",
  "luminosity",
  "motion",
  "motionSensors",
  "openDoors",
  "openWindows",
  "waterLeak",
  "smoke",
  "lightsOn",
  "lightsTotal",
  "shuttersOpen",
  "shuttersTotal",
  "averageShutterPosition",
  "isDaylight",
];

const DEFAULT_THROTTLE_MS = 300_000; // 5 min

export function NotificationPublishersPage() {
  const { t } = useTranslation();
  const [publishers, setPublishers] = useState<NotificationPublisherWithMappings[]>([]);
  const [equipments, setEquipments] = useState<EquipmentWithDetails[]>([]);
  const [zones, setZones] = useState<ZoneWithChildren[]>([]);
  const [recipeInstances, setRecipeInstances] = useState<RecipeInstance[]>([]);
  const [recipes, setRecipes] = useState<RecipeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pubs, eqs, zs, ri, recs] = await Promise.all([
        getNotificationPublishers(),
        getEquipments(),
        getZones(),
        getRecipeInstances(),
        getRecipes(),
      ]);
      setPublishers(pubs);
      setEquipments(eqs);
      setZones(zs);
      setRecipeInstances(ri);
      setRecipes(recs);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <Bell size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("notifPublishers.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-secondary mt-1">
          {t("notifPublishers.subtitle")}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-[13px] rounded-[6px] hover:bg-primary-hover transition-colors"
        >
          <Plus size={14} />
          {t("notifPublishers.newPublisher")}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <PublisherForm
          onSaved={() => {
            setShowCreate(false);
            load();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Publisher cards */}
      {publishers.length === 0 ? (
        <div className="text-[13px] text-text-tertiary py-10 text-center">
          {t("notifPublishers.empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {publishers.map((pub) => (
            <PublisherCard
              key={pub.id}
              publisher={pub}
              equipments={equipments}
              zones={zones}
              recipeInstances={recipeInstances}
              recipes={recipes}
              onRefresh={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Publisher form (create + edit) ─────────────────────────────

function PublisherForm({
  publisher,
  onSaved,
  onCancel,
}: {
  publisher?: NotificationPublisherWithMappings;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(publisher?.name ?? "");
  const [botToken, setBotToken] = useState(publisher?.channelConfig?.botToken ?? "");
  const [chatId, setChatId] = useState(publisher?.channelConfig?.chatId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !botToken.trim() || !chatId.trim()) return;
    setSaving(true);
    setError("");
    try {
      const channelConfig: TelegramChannelConfig = {
        botToken: botToken.trim(),
        chatId: chatId.trim(),
      };
      if (publisher) {
        await updateNotificationPublisher(publisher.id, {
          name: name.trim(),
          channelConfig,
        });
      } else {
        await createNotificationPublisher({
          name: name.trim(),
          channelType: "telegram",
          channelConfig,
        });
      }
      onSaved();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 bg-surface rounded-[10px] border border-border max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("notifPublishers.name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Telegram Home"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("notifPublishers.botToken")}
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text font-mono placeholder:text-text-tertiary"
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("notifPublishers.chatId")}
          </label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-1001234567890"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text font-mono placeholder:text-text-tertiary"
          />
        </div>
        {error && <div className="text-[11px] text-red-500">{error}</div>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !botToken.trim() || !chatId.trim()}
            className="px-4 py-1.5 bg-primary text-white text-[13px] rounded-[6px] hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : publisher ? t("common.save") : t("common.create")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-[13px] text-text-secondary hover:text-text transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Publisher card ────────────────────────────────────────────

function PublisherCard({
  publisher,
  equipments,
  zones,
  recipeInstances,
  recipes,
  onRefresh,
}: {
  publisher: NotificationPublisherWithMappings;
  equipments: EquipmentWithDetails[];
  zones: ZoneWithChildren[];
  recipeInstances: RecipeInstance[];
  recipes: RecipeInfo[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testingChannel, setTestingChannel] = useState(false);
  const [testingPub, setTestingPub] = useState(false);
  const [testChannelOk, setTestChannelOk] = useState(false);
  const [testResult, setTestResult] = useState<number | null>(null);

  const flatZones = flattenZones(zones);

  if (editing) {
    return (
      <PublisherForm
        publisher={publisher}
        onSaved={() => {
          setEditing(false);
          onRefresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const handleTestChannel = async () => {
    setTestingChannel(true);
    setTestChannelOk(false);
    try {
      await testNotificationChannel(publisher.id);
      setTestChannelOk(true);
      setTimeout(() => setTestChannelOk(false), 3000);
    } catch {
      // ignore
    } finally {
      setTestingChannel(false);
    }
  };

  const handleTestPublisher = async () => {
    setTestingPub(true);
    setTestResult(null);
    try {
      const { sent } = await testNotificationPublisher(publisher.id);
      setTestResult(sent);
      setTimeout(() => setTestResult(null), 3000);
    } catch {
      // ignore
    } finally {
      setTestingPub(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await updateNotificationPublisher(publisher.id, { enabled: !publisher.enabled });
      onRefresh();
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("notifPublishers.confirmDelete"))) return;
    setDeleting(true);
    try {
      await deleteNotificationPublisher(publisher.id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  };

  const resolveSourceLabel = (mapping: NotificationPublisherMapping): string => {
    if (mapping.sourceType === "equipment") {
      const eq = equipments.find((e) => e.id === mapping.sourceId);
      return eq ? `${eq.name} → ${mapping.sourceKey}` : `??? → ${mapping.sourceKey}`;
    }
    if (mapping.sourceType === "recipe") {
      const inst = recipeInstances.find((i) => i.id === mapping.sourceId);
      const recipe = inst ? recipes.find((r) => r.id === inst.recipeId) : undefined;
      const label = recipe ? recipe.name : "???";
      return `${label} → ${mapping.sourceKey}`;
    }
    const zone = flatZones.find((z) => z.id === mapping.sourceId);
    return zone ? `${zone.name} → ${mapping.sourceKey}` : `??? → ${mapping.sourceKey}`;
  };

  return (
    <div className={`p-4 bg-surface rounded-[10px] border ${publisher.enabled ? "border-border" : "border-border opacity-60"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Bell size={18} strokeWidth={1.5} className="text-text-secondary" />
          <div>
            <h3 className="text-[14px] font-medium text-text">{publisher.name}</h3>
            <span className="text-[12px] text-text-tertiary">
              Telegram
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestChannel}
            disabled={testingChannel}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-[6px] hover:bg-bg transition-colors text-text-secondary hover:text-accent disabled:opacity-40"
            title={t("notifPublishers.testChannelHint")}
          >
            {testingChannel ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <MessageSquare size={13} />
            )}
            {t("notifPublishers.testChannel")}
          </button>
          <button
            onClick={handleTestPublisher}
            disabled={testingPub || publisher.mappings.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-[6px] hover:bg-bg transition-colors text-text-secondary hover:text-accent disabled:opacity-40"
            title={t("notifPublishers.testPublisherHint")}
          >
            {testingPub ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Zap size={13} />
            )}
            {t("notifPublishers.test")}
          </button>
          {testChannelOk && (
            <span className="text-[11px] text-green-500">
              {t("notifPublishers.testChannelOk")}
            </span>
          )}
          {testResult !== null && (
            <span className="text-[11px] text-green-500">
              {t("notifPublishers.testResult", { count: testResult })}
            </span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 rounded-[6px] hover:bg-bg transition-colors text-text-tertiary hover:text-text"
            title={t("common.edit")}
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="p-1.5 rounded-[6px] hover:bg-bg transition-colors"
            title={publisher.enabled ? t("common.disable") : t("common.enable")}
          >
            {publisher.enabled ? (
              <Power size={16} className="text-green-500" />
            ) : (
              <PowerOff size={16} className="text-text-tertiary" />
            )}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-[6px] hover:bg-bg transition-colors text-text-tertiary hover:text-red-500"
            title={t("common.delete")}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Mappings */}
      <div className="mb-3">
        <div className="text-[12px] text-text-secondary mb-2">
          {t("notifPublishers.mappings")} ({publisher.mappings.length})
        </div>
        {publisher.mappings.length === 0 ? (
          <div className="text-[12px] text-text-tertiary italic">
            {t("notifPublishers.noMappings")}
          </div>
        ) : (
          <div className="space-y-1">
            {publisher.mappings.map((mapping) => (
              <MappingRow
                key={mapping.id}
                publisherId={publisher.id}
                mapping={mapping}
                label={resolveSourceLabel(mapping)}
                equipments={equipments}
                zones={flatZones}
                recipeInstances={recipeInstances}
                recipes={recipes}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add mapping */}
      {showAddMapping ? (
        <AddMappingForm
          publisherId={publisher.id}
          equipments={equipments}
          zones={flatZones}
          recipeInstances={recipeInstances}
          recipes={recipes}
          onAdded={() => {
            setShowAddMapping(false);
            onRefresh();
          }}
          onCancel={() => setShowAddMapping(false)}
        />
      ) : (
        <button
          onClick={() => setShowAddMapping(true)}
          className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary-hover transition-colors"
        >
          <Plus size={13} />
          {t("notifPublishers.addMapping")}
        </button>
      )}
    </div>
  );
}

// ── Mapping row (display + inline edit) ──────────────────────

function MappingRow({
  publisherId,
  mapping,
  label,
  equipments,
  zones,
  recipeInstances,
  recipes,
  onRefresh,
}: {
  publisherId: string;
  mapping: NotificationPublisherMapping;
  label: string;
  equipments: EquipmentWithDetails[];
  zones: FlatZone[];
  recipeInstances: RecipeInstance[];
  recipes: RecipeInfo[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(mapping.message);
  const [sourceType, setSourceType] = useState<"equipment" | "zone" | "recipe">(mapping.sourceType);
  const [filterZoneId, setFilterZoneId] = useState("");
  const [sourceId, setSourceId] = useState(mapping.sourceId);
  const [sourceKey, setSourceKey] = useState(mapping.sourceKey);
  const [throttleMs, setThrottleMs] = useState(mapping.throttleMs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filteredEquipments = filterZoneId
    ? equipments.filter((e) => e.zoneId === filterZoneId)
    : equipments;

  const filteredRecipeInstances = filterZoneId
    ? recipeInstances.filter((i) => i.params.zone === filterZoneId)
    : recipeInstances;

  const availableKeys: string[] = (() => {
    if (sourceType === "zone") return ZONE_AGG_KEYS;
    if (sourceType === "equipment" && sourceId) {
      const eq = equipments.find((e) => e.id === sourceId);
      if (eq) return eq.dataBindings.map((b) => b.alias);
    }
    if (sourceType === "recipe" && sourceId) {
      const inst = recipeInstances.find((i) => i.id === sourceId);
      if (inst?.state) return Object.keys(inst.state);
    }
    return [];
  })();

  const handleSourceTypeChange = (val: "equipment" | "zone" | "recipe") => {
    setSourceType(val);
    setFilterZoneId("");
    setSourceId("");
    setSourceKey("");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !sourceId || !sourceKey) return;
    setSaving(true);
    setError("");
    try {
      await updateNotificationPublisherMapping(publisherId, mapping.id, {
        message: message.trim(),
        sourceType,
        sourceId,
        sourceKey,
        throttleMs,
      });
      setEditing(false);
      onRefresh();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await removeNotificationPublisherMapping(publisherId, mapping.id);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setMessage(mapping.message);
    setSourceType(mapping.sourceType);
    setSourceId(mapping.sourceId);
    setSourceKey(mapping.sourceKey);
    setThrottleMs(mapping.throttleMs);
    setFilterZoneId("");
    setError("");
  };

  if (editing) {
    return (
      <form onSubmit={handleSave} className="p-3 bg-bg rounded-[6px] border border-border">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("notifPublishers.message")}
            </label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("notifPublishers.sourceType")}
            </label>
            <select
              value={sourceType}
              onChange={(e) => handleSourceTypeChange(e.target.value as "equipment" | "zone" | "recipe")}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="equipment">{t("notifPublishers.equipment")}</option>
              <option value="zone">{t("notifPublishers.zone")}</option>
              <option value="recipe">{t("notifPublishers.recipe")}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("notifPublishers.zone")}
            </label>
            <select
              value={sourceType === "zone" ? sourceId : filterZoneId}
              onChange={(e) => {
                if (sourceType === "zone") {
                  setSourceId(e.target.value);
                  setSourceKey("");
                } else {
                  setFilterZoneId(e.target.value);
                  setSourceId("");
                  setSourceKey("");
                }
              }}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="">
                {sourceType === "zone"
                  ? t("notifPublishers.selectSource")
                  : t("notifPublishers.allZones")}
              </option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          {sourceType === "equipment" && (
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">
                {t("notifPublishers.equipment")}
              </label>
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setSourceKey("");
                }}
                className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
              >
                <option value="">{t("notifPublishers.selectSource")}</option>
                {filteredEquipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {sourceType === "recipe" && (
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">
                {t("notifPublishers.recipeInstance")}
              </label>
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setSourceKey("");
                }}
                className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
              >
                <option value="">{t("notifPublishers.selectSource")}</option>
                {filteredRecipeInstances.map((inst) => {
                  const recipe = recipes.find((r) => r.id === inst.recipeId);
                  return (
                    <option key={inst.id} value={inst.id}>
                      {recipe?.name ?? inst.recipeId}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("notifPublishers.sourceKey")}
            </label>
            <select
              value={sourceKey}
              onChange={(e) => setSourceKey(e.target.value)}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
              disabled={!sourceId}
            >
              <option value="">{t("notifPublishers.selectKey")}</option>
              {availableKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("notifPublishers.throttle")}
            </label>
            <input
              type="number"
              value={Math.round(throttleMs / 60000)}
              onChange={(e) => setThrottleMs(Number(e.target.value) * 60000)}
              min={0}
              step={1}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text font-mono"
            />
          </div>
        </div>
        {error && (
          <div className="mt-2 text-[11px] text-red-500">{error}</div>
        )}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="submit"
            disabled={saving || !message.trim() || !sourceId || !sourceKey}
            className="px-3 py-1 bg-primary text-white text-[12px] rounded-[4px] hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : t("common.save")}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1 text-[12px] text-text-secondary hover:text-text transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-bg rounded-[4px]">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[12px] text-text font-medium shrink-0 max-w-[200px] truncate">
          {mapping.message}
        </span>
        <span className="text-[11px] text-text-tertiary">←</span>
        <span className="text-[11px] text-text-secondary truncate">
          [{mapping.sourceType}] {label}
        </span>
        <span className="text-[10px] text-text-tertiary shrink-0">
          {t("notifPublishers.throttleMinutes", { minutes: Math.round(mapping.throttleMs / 60000) })}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="p-1 rounded hover:bg-surface transition-colors text-text-tertiary hover:text-text"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded hover:bg-surface transition-colors text-text-tertiary hover:text-red-500"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Add mapping form ─────────────────────────────────────────

interface FlatZone {
  id: string;
  name: string;
}

function flattenZones(zones: ZoneWithChildren[]): FlatZone[] {
  const result: FlatZone[] = [];
  const recurse = (list: ZoneWithChildren[], parentLabel?: string) => {
    for (const z of list) {
      const label = parentLabel ? `${parentLabel} › ${z.name}` : z.name;
      result.push({ id: z.id, name: label });
      if (z.children.length > 0) recurse(z.children, label);
    }
  };
  recurse(zones, undefined);
  return result;
}

function AddMappingForm({
  publisherId,
  equipments,
  zones,
  recipeInstances,
  recipes,
  onAdded,
  onCancel,
}: {
  publisherId: string;
  equipments: EquipmentWithDetails[];
  zones: FlatZone[];
  recipeInstances: RecipeInstance[];
  recipes: RecipeInfo[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [sourceType, setSourceType] = useState<"equipment" | "zone" | "recipe">("equipment");
  const [filterZoneId, setFilterZoneId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [throttleMs, setThrottleMs] = useState(DEFAULT_THROTTLE_MS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filteredEquipments = filterZoneId
    ? equipments.filter((e) => e.zoneId === filterZoneId)
    : equipments;

  const filteredRecipeInstances = filterZoneId
    ? recipeInstances.filter((i) => i.params.zone === filterZoneId)
    : recipeInstances;

  const availableKeys: string[] = (() => {
    if (sourceType === "zone") return ZONE_AGG_KEYS;
    if (sourceType === "equipment" && sourceId) {
      const eq = equipments.find((e) => e.id === sourceId);
      if (eq) return eq.dataBindings.map((b) => b.alias);
    }
    if (sourceType === "recipe" && sourceId) {
      const inst = recipeInstances.find((i) => i.id === sourceId);
      if (inst?.state) return Object.keys(inst.state);
    }
    return [];
  })();

  const handleSourceTypeChange = (val: "equipment" | "zone" | "recipe") => {
    setSourceType(val);
    setFilterZoneId("");
    setSourceId("");
    setSourceKey("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !sourceId || !sourceKey) return;
    setSaving(true);
    setError("");
    try {
      await addNotificationPublisherMapping(publisherId, {
        message: message.trim(),
        sourceType,
        sourceId,
        sourceKey,
        throttleMs,
      });
      onAdded();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-3 bg-bg rounded-[6px] border border-border">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("notifPublishers.message")}
          </label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("notifPublishers.messagePlaceholder")}
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("notifPublishers.sourceType")}
          </label>
          <select
            value={sourceType}
            onChange={(e) => handleSourceTypeChange(e.target.value as "equipment" | "zone" | "recipe")}
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
          >
            <option value="equipment">{t("notifPublishers.equipment")}</option>
            <option value="zone">{t("notifPublishers.zone")}</option>
            <option value="recipe">{t("notifPublishers.recipe")}</option>
          </select>
        </div>

        {/* Zone selector */}
        <div>
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("notifPublishers.zone")}
          </label>
          <select
            value={sourceType === "zone" ? sourceId : filterZoneId}
            onChange={(e) => {
              if (sourceType === "zone") {
                setSourceId(e.target.value);
                setSourceKey("");
              } else {
                setFilterZoneId(e.target.value);
                setSourceId("");
                setSourceKey("");
              }
            }}
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
          >
            <option value="">
              {sourceType === "zone"
                ? t("notifPublishers.selectSource")
                : t("notifPublishers.allZones")}
            </option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>

        {sourceType === "equipment" && (
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("notifPublishers.equipment")}
            </label>
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSourceKey("");
              }}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="">{t("notifPublishers.selectSource")}</option>
              {filteredEquipments.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {sourceType === "recipe" && (
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("notifPublishers.recipeInstance")}
            </label>
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSourceKey("");
              }}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="">{t("notifPublishers.selectSource")}</option>
              {filteredRecipeInstances.map((inst) => {
                const recipe = recipes.find((r) => r.id === inst.recipeId);
                return (
                  <option key={inst.id} value={inst.id}>
                    {recipe?.name ?? inst.recipeId}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div>
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("notifPublishers.sourceKey")}
          </label>
          <select
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            disabled={!sourceId}
          >
            <option value="">{t("notifPublishers.selectKey")}</option>
            {availableKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("notifPublishers.throttle")}
          </label>
          <input
            type="number"
            value={Math.round(throttleMs / 60000)}
            onChange={(e) => setThrottleMs(Number(e.target.value) * 60000)}
            min={0}
            step={1}
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text font-mono"
          />
        </div>
      </div>
      {error && (
        <div className="mt-2 text-[11px] text-red-500">{error}</div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="submit"
          disabled={saving || !message.trim() || !sourceId || !sourceKey}
          className="px-3 py-1 bg-primary text-white text-[12px] rounded-[4px] hover:bg-primary-hover disabled:opacity-50"
        >
          {t("notifPublishers.addMapping")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-[12px] text-text-secondary hover:text-text transition-colors"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
