import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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
  NotificationChannelType,
  NotificationChannelConfig,
  EquipmentWithDetails,
  ZoneWithChildren,
  RecipeInstance,
  RecipeInfo,
} from "../types";
import {
  deriveSourceZoneFilter,
  recipeInstanceLabel,
  repeatModeOf,
  repeatFieldsFor,
  type RepeatMode,
} from "../lib/notif-mapping";
import { flattenZonesWithPath, type ZoneOption } from "../lib/zone-path";
import { MappingSourceFields } from "../components/publishers/MappingSourceFields";
import {
  NOTIFICATION_CHANNELS,
  channelSpec,
  channelConfigComplete,
  useChannelLabel,
  useChannelOptionLabel,
} from "../components/publishers/notification-channels";
import { ChannelConfigFields } from "../components/publishers/ChannelConfigFields";
import { TOP_LEVEL_H1 } from "../components/layout/page-title";

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
      <div className="px-4 sm:px-6 flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="lg:mb-6">
        <h1 className={TOP_LEVEL_H1}>{t("notifPublishers.title")}</h1>
      </div>

      {/* Web Push on this device lives in Settings > Account (#1199) */}
      <p className="text-small text-text-secondary mb-4">
        {t("notifPublishers.pushMoved")}{" "}
        <Link to="/settings?tab=account#notifications" className="text-primary hover:underline">
          {t("notifPublishers.pushMovedLink")}
        </Link>
      </p>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-fill text-white text-small rounded-sm hover:bg-primary-fill-hover transition-colors"
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
        <div className="text-small text-text-tertiary py-10 text-center">
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
  const channelOptionLabel = useChannelOptionLabel();
  const [name, setName] = useState(publisher?.name ?? "");
  const [channelType, setChannelType] = useState<NotificationChannelType>(
    publisher?.channelType ?? "web-push",
  );
  // Flat config record driven by the channel descriptor (issue #457 step 2).
  const [config, setConfig] = useState<Record<string, string>>(() =>
    channelSpec(publisher?.channelType ?? "web-push").fromConfig(publisher?.channelConfig),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const spec = channelSpec(channelType);
  const canSubmit = !!name.trim() && channelConfigComplete(spec, config);

  const handleChannelChange = (type: NotificationChannelType) => {
    setChannelType(type);
    // Reset the config to the new channel's shape (keeps overlapping keys).
    setConfig((prev) => ({ ...channelSpec(type).fromConfig(undefined), ...prev }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const channelConfig: NotificationChannelConfig = spec.toConfig(config);
      if (publisher) {
        await updateNotificationPublisher(publisher.id, {
          name: name.trim(),
          channelType,
          channelConfig,
        });
      } else {
        await createNotificationPublisher({ name: name.trim(), channelType, channelConfig });
      }
      onSaved();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card mb-4 p-4 max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("notifPublishers.name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("notifPublishers.namePlaceholder")}
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("notifPublishers.channelType")}
          </label>
          <select
            value={channelType}
            onChange={(e) => handleChannelChange(e.target.value as NotificationChannelType)}
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text"
          >
            {NOTIFICATION_CHANNELS.map((c) => (
              <option key={c.type} value={c.type}>
                {channelOptionLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <ChannelConfigFields
          spec={spec}
          values={config}
          onChange={(key, value) => setConfig((prev) => ({ ...prev, [key]: value }))}
        />
        {error && <div className="text-micro text-error">{error}</div>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !canSubmit}
            className="px-4 py-1.5 bg-primary-fill text-white text-small rounded-sm hover:bg-primary-fill-hover disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : publisher ? (
              t("common.save")
            ) : (
              t("common.create")
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-small text-text-secondary hover:text-text transition-colors"
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
  const channelLabel = useChannelLabel();
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testingChannel, setTestingChannel] = useState(false);
  const [testingPub, setTestingPub] = useState(false);
  const [testChannelOk, setTestChannelOk] = useState(false);
  const [testResult, setTestResult] = useState<number | null>(null);

  const flatZones = flattenZonesWithPath(zones);

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
      if (!eq) return `??? → ${mapping.sourceKey}`;
      const zone = flatZones.find((z) => z.id === eq.zoneId);
      const zoneName = zone ? zone.label : "";
      return zoneName
        ? `${eq.name} (${zoneName}) → ${mapping.sourceKey}`
        : `${eq.name} → ${mapping.sourceKey}`;
    }
    if (mapping.sourceType === "recipe") {
      const inst = recipeInstances.find((i) => i.id === mapping.sourceId);
      const recipe = inst ? recipes.find((r) => r.id === inst.recipeId) : undefined;
      const label = recipe ? recipe.name : "???";
      const zoneId = inst?.params?.zone as string | undefined;
      const zone = zoneId ? flatZones.find((z) => z.id === zoneId) : undefined;
      return zone
        ? `${label} (${zone.label}) → ${mapping.sourceKey}`
        : `${label} → ${mapping.sourceKey}`;
    }
    const zone = flatZones.find((z) => z.id === mapping.sourceId);
    return zone ? `${zone.label} → ${mapping.sourceKey}` : `??? → ${mapping.sourceKey}`;
  };

  return (
    <div className={`card p-4 ${publisher.enabled ? "" : "opacity-60"}`}>
      {/* Header — stacks on mobile so the name stays readable and the
          actions sit on their own row instead of crushing into the title. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <Bell size={18} strokeWidth={1.5} className="text-text-secondary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-body font-medium text-text truncate">{publisher.name}</h3>
            <span className="text-caption text-text-tertiary">
              {channelLabel(publisher.channelType)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end self-end sm:self-auto">
          {testChannelOk && (
            <span className="text-caption text-success">{t("notifPublishers.testChannelOk")}</span>
          )}
          {testResult !== null && (
            <span className="text-micro text-success">
              {t("notifPublishers.testResult", { count: testResult })}
            </span>
          )}
          <button
            onClick={handleTestChannel}
            disabled={testingChannel}
            className="flex items-center gap-1 px-2 py-1 text-micro rounded-sm hover:bg-bg transition-colors text-text-secondary hover:text-primary disabled:opacity-40"
            title={t("notifPublishers.testChannelHint")}
          >
            {testingChannel ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <MessageSquare size={13} />
            )}
            <span className="hidden sm:inline">{t("notifPublishers.testChannel")}</span>
          </button>
          <button
            onClick={handleTestPublisher}
            disabled={testingPub || publisher.mappings.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-micro rounded-sm hover:bg-bg transition-colors text-text-secondary hover:text-primary disabled:opacity-40"
            title={t("notifPublishers.testPublisherHint")}
          >
            {testingPub ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            <span className="hidden sm:inline">{t("notifPublishers.test")}</span>
          </button>
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 rounded-sm hover:bg-bg transition-colors text-text-tertiary hover:text-text"
            title={t("common.edit")}
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="p-1.5 rounded-sm hover:bg-bg transition-colors"
            title={publisher.enabled ? t("common.disable") : t("common.enable")}
          >
            {publisher.enabled ? (
              <Power size={16} className="text-success" />
            ) : (
              <PowerOff size={16} className="text-text-tertiary" />
            )}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-sm hover:bg-bg transition-colors text-text-tertiary hover:text-error"
            title={t("common.delete")}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Mappings */}
      <div className="mb-3">
        <div className="text-caption text-text-secondary mb-2">
          {t("notifPublishers.mappings")} ({publisher.mappings.length})
        </div>
        {publisher.mappings.length === 0 ? (
          <div className="text-caption text-text-tertiary italic">
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
          className="flex items-center gap-1.5 text-caption text-primary hover:text-primary-hover transition-colors"
        >
          <Plus size={13} />
          {t("notifPublishers.addMapping")}
        </button>
      )}
    </div>
  );
}

// ── Mapping row (display + inline edit) ──────────────────────

/** Spec 128 — explicit re-notify control (mode + interval + optional max). */
function RepeatControl({
  mode,
  intervalMin,
  maxCount,
  onChange,
}: {
  mode: RepeatMode;
  intervalMin: number;
  maxCount: number;
  onChange: (next: { mode: RepeatMode; intervalMin: number; maxCount: number }) => void;
}) {
  const { t } = useTranslation();
  const inputCls =
    "w-16 px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text";
  return (
    <div>
      <label className="block text-micro text-text-secondary mb-1">
        {t("notifPublishers.repeat")}
      </label>
      <select
        value={mode}
        onChange={(e) => onChange({ mode: e.target.value as RepeatMode, intervalMin, maxCount })}
        className="w-full px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text"
      >
        <option value="none">{t("notifPublishers.repeatNone")}</option>
        <option value="forever">{t("notifPublishers.repeatForever")}</option>
        <option value="limited">{t("notifPublishers.repeatLimited")}</option>
      </select>
      {mode !== "none" && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-micro text-text-secondary">
          <span>{t("notifPublishers.repeatEvery")}</span>
          <input
            type="number"
            min={1}
            value={intervalMin}
            onChange={(e) => onChange({ mode, intervalMin: Number(e.target.value), maxCount })}
            className={inputCls}
          />
          <span>{t("notifPublishers.repeatMinutes")}</span>
          {mode === "limited" && (
            <>
              <span className="ml-1">{t("notifPublishers.repeatMaxLabel")}</span>
              <input
                type="number"
                min={1}
                value={maxCount}
                onChange={(e) => onChange({ mode, intervalMin, maxCount: Number(e.target.value) })}
                className={inputCls}
              />
              <span>{t("notifPublishers.repeatTimes")}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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
  zones: ZoneOption[];
  recipeInstances: RecipeInstance[];
  recipes: RecipeInfo[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(mapping.message);
  const [sourceType, setSourceType] = useState<"equipment" | "zone" | "recipe">(mapping.sourceType);
  const [filterZoneId, setFilterZoneId] = useState(() =>
    deriveSourceZoneFilter(mapping, equipments, recipeInstances),
  );
  const [sourceId, setSourceId] = useState(mapping.sourceId);
  const [sourceKey, setSourceKey] = useState(mapping.sourceKey);
  const [throttleMs, setThrottleMs] = useState(mapping.throttleMs);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(repeatModeOf(mapping));
  const [repeatInterval, setRepeatInterval] = useState(
    mapping.repeatMs ? Math.round(mapping.repeatMs / 60_000) : 60,
  );
  const [repeatMaxCount, setRepeatMaxCount] = useState(mapping.repeatMax ?? 3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !sourceId || !sourceKey) return;
    setSaving(true);
    setError("");
    try {
      const { repeatMs, repeatMax } = repeatFieldsFor(repeatMode, repeatInterval, repeatMaxCount);
      await updateNotificationPublisherMapping(publisherId, mapping.id, {
        message: message.trim(),
        sourceType,
        sourceId,
        sourceKey,
        throttleMs,
        repeatMs,
        repeatMax,
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
    setRepeatMode(repeatModeOf(mapping));
    setRepeatInterval(mapping.repeatMs ? Math.round(mapping.repeatMs / 60_000) : 60);
    setRepeatMaxCount(mapping.repeatMax ?? 3);
    setFilterZoneId("");
    setError("");
  };

  if (editing) {
    return (
      <form onSubmit={handleSave} className="p-3 bg-background rounded-md">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-micro text-text-secondary mb-1">
              {t("notifPublishers.message")}
            </label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text"
              autoFocus
            />
          </div>
          <MappingSourceFields
            keyPrefix="notifPublishers"
            sourceType={sourceType}
            setSourceType={setSourceType}
            sourceId={sourceId}
            setSourceId={setSourceId}
            sourceKey={sourceKey}
            setSourceKey={setSourceKey}
            filterZoneId={filterZoneId}
            setFilterZoneId={setFilterZoneId}
            equipments={equipments}
            zones={zones}
            recipeInstances={recipeInstances}
            recipes={recipes}
            recipeOptionLabel={(inst) => recipeInstanceLabel(inst, recipes, equipments)}
          />

          <div>
            <label className="block text-micro text-text-secondary mb-1">
              {t("notifPublishers.throttle")}
            </label>
            <input
              type="number"
              value={Math.round(throttleMs / 60000)}
              onChange={(e) => setThrottleMs(Number(e.target.value) * 60000)}
              min={0}
              step={1}
              className="w-full px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text font-mono"
            />
          </div>
        </div>
        <div className="mt-3">
          <RepeatControl
            mode={repeatMode}
            intervalMin={repeatInterval}
            maxCount={repeatMaxCount}
            onChange={(n) => {
              setRepeatMode(n.mode);
              setRepeatInterval(n.intervalMin);
              setRepeatMaxCount(n.maxCount);
            }}
          />
        </div>
        {error && <div className="mt-2 text-micro text-error">{error}</div>}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="submit"
            disabled={saving || !message.trim() || !sourceId || !sourceKey}
            className="px-3 py-1 bg-primary-fill text-white text-caption rounded-sm hover:bg-primary-fill-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : t("common.save")}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1 text-caption text-text-secondary hover:text-text transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2 px-3 py-2 bg-bg rounded-sm">
      <div className="flex flex-col gap-0.5 min-w-0 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-caption text-text font-medium truncate sm:max-w-[200px] sm:shrink-0">
          {mapping.message}
        </span>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-micro text-text-tertiary shrink-0">←</span>
          <span className="text-micro text-text-secondary truncate">
            [{mapping.sourceType}] {label}
          </span>
          <span className="text-micro text-text-tertiary shrink-0">
            {t("notifPublishers.throttleMinutes", {
              minutes: Math.round(mapping.throttleMs / 60000),
            })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => {
            // Re-derive the zone filter from the source in case the equipment/
            // recipe lists loaded after this row first mounted.
            setFilterZoneId(deriveSourceZoneFilter(mapping, equipments, recipeInstances));
            setEditing(true);
          }}
          className="p-1 rounded-sm hover:bg-surface transition-colors text-text-tertiary hover:text-text"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded-sm hover:bg-surface transition-colors text-text-tertiary hover:text-error"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Add mapping form ─────────────────────────────────────────

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
  zones: ZoneOption[];
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
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("none");
  const [repeatInterval, setRepeatInterval] = useState(60);
  const [repeatMaxCount, setRepeatMaxCount] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !sourceId || !sourceKey) return;
    setSaving(true);
    setError("");
    try {
      const { repeatMs, repeatMax } = repeatFieldsFor(repeatMode, repeatInterval, repeatMaxCount);
      await addNotificationPublisherMapping(publisherId, {
        message: message.trim(),
        sourceType,
        sourceId,
        sourceKey,
        throttleMs,
        repeatMs,
        repeatMax,
      });
      onAdded();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-3 bg-background rounded-md">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-micro text-text-secondary mb-1">
            {t("notifPublishers.message")}
          </label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("notifPublishers.messagePlaceholder")}
            className="w-full px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <MappingSourceFields
          keyPrefix="notifPublishers"
          sourceType={sourceType}
          setSourceType={setSourceType}
          sourceId={sourceId}
          setSourceId={setSourceId}
          sourceKey={sourceKey}
          setSourceKey={setSourceKey}
          filterZoneId={filterZoneId}
          setFilterZoneId={setFilterZoneId}
          equipments={equipments}
          zones={zones}
          recipeInstances={recipeInstances}
          recipes={recipes}
          recipeOptionLabel={(inst) => recipeInstanceLabel(inst, recipes, equipments)}
        />

        <div>
          <label className="block text-micro text-text-secondary mb-1">
            {t("notifPublishers.throttle")}
          </label>
          <input
            type="number"
            value={Math.round(throttleMs / 60000)}
            onChange={(e) => setThrottleMs(Number(e.target.value) * 60000)}
            min={0}
            step={1}
            className="w-full px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text font-mono"
          />
        </div>
      </div>
      <div className="mt-3">
        <RepeatControl
          mode={repeatMode}
          intervalMin={repeatInterval}
          maxCount={repeatMaxCount}
          onChange={(n) => {
            setRepeatMode(n.mode);
            setRepeatInterval(n.intervalMin);
            setRepeatMaxCount(n.maxCount);
          }}
        />
      </div>
      {error && <div className="mt-2 text-micro text-error">{error}</div>}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="submit"
          disabled={saving || !message.trim() || !sourceId || !sourceKey}
          className="px-3 py-1 bg-primary-fill text-white text-caption rounded-sm hover:bg-primary-fill-hover disabled:opacity-50"
        >
          {t("notifPublishers.addMapping")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-caption text-text-secondary hover:text-text transition-colors"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
