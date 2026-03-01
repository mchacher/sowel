import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Send,
  Plus,
  Trash2,
  Power,
  PowerOff,
  ChevronDown,
  ChevronUp,
  Settings2,
  Zap,
} from "lucide-react";
import {
  getMqttPublishers,
  createMqttPublisher,
  updateMqttPublisher,
  deleteMqttPublisher,
  addMqttPublisherMapping,
  removeMqttPublisherMapping,
  testMqttPublisher,
  getEquipments,
  getZones,
  getRecipeInstances,
  getRecipes,
  getSettings,
  updateSettings,
} from "../api";
import type {
  MqttPublisherWithMappings,
  MqttPublisherMapping,
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

export function MqttPublishersPage() {
  const { t } = useTranslation();
  const [publishers, setPublishers] = useState<MqttPublisherWithMappings[]>([]);
  const [equipments, setEquipments] = useState<EquipmentWithDetails[]>([]);
  const [zones, setZones] = useState<ZoneWithChildren[]>([]);
  const [recipeInstances, setRecipeInstances] = useState<RecipeInstance[]>([]);
  const [recipes, setRecipes] = useState<RecipeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBrokerSettings, setShowBrokerSettings] = useState(false);
  const [brokerUrl, setBrokerUrl] = useState("");
  const [brokerUsername, setBrokerUsername] = useState("");
  const [brokerPassword, setBrokerPassword] = useState("");
  const [savingBroker, setSavingBroker] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pubs, eqs, zs, ri, recs, settings] = await Promise.all([
        getMqttPublishers(),
        getEquipments(),
        getZones(),
        getRecipeInstances(),
        getRecipes(),
        getSettings(),
      ]);
      setPublishers(pubs);
      setEquipments(eqs);
      setZones(zs);
      setRecipeInstances(ri);
      setRecipes(recs);
      setBrokerUrl(settings["mqtt-publisher.brokerUrl"] ?? "");
      setBrokerUsername(settings["mqtt-publisher.username"] ?? "");
      setBrokerPassword(settings["mqtt-publisher.password"] ?? "");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveBroker = async () => {
    setSavingBroker(true);
    try {
      const entries: Record<string, string> = {
        "mqtt-publisher.brokerUrl": brokerUrl,
        "mqtt-publisher.username": brokerUsername,
        "mqtt-publisher.password": brokerPassword,
      };
      await updateSettings(entries);
    } catch {
      // ignore
    } finally {
      setSavingBroker(false);
    }
  };

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
          <Send size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("mqttPublishers.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-secondary mt-1">
          {t("mqttPublishers.subtitle")}
        </p>
      </div>

      {/* Broker settings */}
      <div className="mb-6">
        <button
          onClick={() => setShowBrokerSettings(!showBrokerSettings)}
          className="flex items-center gap-2 text-[13px] text-text-secondary hover:text-text transition-colors"
        >
          <Settings2 size={16} strokeWidth={1.5} />
          {t("mqttPublishers.brokerSettings")}
          {showBrokerSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showBrokerSettings && (
          <div className="mt-3 p-4 bg-surface rounded-[10px] border border-border max-w-lg">
            <p className="text-[12px] text-text-tertiary mb-3">
              {t("mqttPublishers.brokerHint")}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">
                  {t("mqttPublishers.brokerUrl")}
                </label>
                <input
                  type="text"
                  value={brokerUrl}
                  onChange={(e) => setBrokerUrl(e.target.value)}
                  placeholder="mqtt://192.168.0.45:1883"
                  className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
                />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">
                  {t("mqttPublishers.brokerUsername")}
                </label>
                <input
                  type="text"
                  value={brokerUsername}
                  onChange={(e) => setBrokerUsername(e.target.value)}
                  className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text"
                />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">
                  {t("mqttPublishers.brokerPassword")}
                </label>
                <input
                  type="password"
                  value={brokerPassword}
                  onChange={(e) => setBrokerPassword(e.target.value)}
                  className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text"
                />
              </div>
              <button
                onClick={handleSaveBroker}
                disabled={savingBroker}
                className="px-4 py-1.5 bg-primary text-white text-[13px] rounded-[6px] hover:bg-primary-hover disabled:opacity-50"
              >
                {savingBroker ? <Loader2 size={14} className="animate-spin" /> : t("common.save")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-[13px] rounded-[6px] hover:bg-primary-hover transition-colors"
        >
          <Plus size={14} />
          {t("mqttPublishers.newPublisher")}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreatePublisherForm
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Publisher cards */}
      {publishers.length === 0 ? (
        <div className="text-[13px] text-text-tertiary py-10 text-center">
          {t("mqttPublishers.empty")}
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

// ── Create form ──────────────────────────────────────────────

function CreatePublisherForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !topic.trim()) return;
    setSaving(true);
    try {
      await createMqttPublisher({ name: name.trim(), topic: topic.trim() });
      onCreated();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 bg-surface rounded-[10px] border border-border max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Living Room Display"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.topic")}
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="winch/homedisplay/livingroom"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !topic.trim()}
            className="px-4 py-1.5 bg-primary text-white text-[13px] rounded-[6px] hover:bg-primary-hover disabled:opacity-50"
          >
            {t("common.create")}
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
  publisher: MqttPublisherWithMappings;
  equipments: EquipmentWithDetails[];
  zones: ZoneWithChildren[];
  recipeInstances: RecipeInstance[];
  recipes: RecipeInfo[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<number | null>(null);

  const flatZones = flattenZones(zones);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { published } = await testMqttPublisher(publisher.id);
      setTestResult(published);
      setTimeout(() => setTestResult(null), 3000);
    } catch {
      // ignore
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await updateMqttPublisher(publisher.id, { enabled: !publisher.enabled });
      onRefresh();
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("mqttPublishers.confirmDelete"))) return;
    setDeleting(true);
    try {
      await deleteMqttPublisher(publisher.id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  };

  const handleRemoveMapping = async (mappingId: string) => {
    try {
      await removeMqttPublisherMapping(publisher.id, mappingId);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const resolveSourceLabel = (mapping: MqttPublisherMapping): string => {
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
          <Send size={18} strokeWidth={1.5} className="text-text-secondary" />
          <div>
            <h3 className="text-[14px] font-medium text-text">{publisher.name}</h3>
            <span className="text-[12px] text-text-tertiary font-mono">{publisher.topic}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={testing || publisher.mappings.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-[6px] hover:bg-bg transition-colors text-text-secondary hover:text-accent disabled:opacity-40"
            title={t("mqttPublishers.testPublish")}
          >
            {testing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Zap size={13} />
            )}
            {t("mqttPublishers.test")}
          </button>
          {testResult !== null && (
            <span className="text-[11px] text-green-500">
              {t("mqttPublishers.testResult", { count: testResult })}
            </span>
          )}
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
          {t("mqttPublishers.mappings")} ({publisher.mappings.length})
        </div>
        {publisher.mappings.length === 0 ? (
          <div className="text-[12px] text-text-tertiary italic">
            {t("mqttPublishers.noMappings")}
          </div>
        ) : (
          <div className="space-y-1">
            {publisher.mappings.map((mapping) => (
              <div
                key={mapping.id}
                className="flex items-center justify-between px-3 py-1.5 bg-bg rounded-[6px] text-[12px]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-text">
                    {mapping.publishKey}
                  </span>
                  <span className="text-text-tertiary">←</span>
                  <span className="text-text-secondary">
                    {resolveSourceLabel(mapping)}
                  </span>
                  <span className="text-text-tertiary text-[11px]">
                    ({mapping.sourceType})
                  </span>
                </div>
                <button
                  onClick={() => handleRemoveMapping(mapping.id)}
                  className="text-text-tertiary hover:text-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
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
          {t("mqttPublishers.addMapping")}
        </button>
      )}
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
  const [publishKey, setPublishKey] = useState("");
  const [sourceType, setSourceType] = useState<"equipment" | "zone" | "recipe">("equipment");
  const [filterZoneId, setFilterZoneId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Equipments filtered by selected zone
  const filteredEquipments = filterZoneId
    ? equipments.filter((e) => e.zoneId === filterZoneId)
    : equipments;

  // Recipe instances filtered by selected zone (zone stored in params.zone)
  const filteredRecipeInstances = filterZoneId
    ? recipeInstances.filter((i) => i.params.zone === filterZoneId)
    : recipeInstances;

  // Available keys depend on source type and selected source
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

  // Reset downstream selections when sourceType changes
  const handleSourceTypeChange = (val: "equipment" | "zone" | "recipe") => {
    setSourceType(val);
    setFilterZoneId("");
    setSourceId("");
    setSourceKey("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publishKey.trim() || !sourceId || !sourceKey) return;
    setSaving(true);
    setError("");
    try {
      await addMqttPublisherMapping(publisherId, {
        publishKey: publishKey.trim(),
        sourceType,
        sourceId,
        sourceKey,
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
        <div>
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("mqttPublishers.publishKey")}
          </label>
          <input
            type="text"
            value={publishKey}
            onChange={(e) => setPublishKey(e.target.value)}
            placeholder="Thome"
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text font-mono placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("mqttPublishers.sourceType")}
          </label>
          <select
            value={sourceType}
            onChange={(e) => handleSourceTypeChange(e.target.value as "equipment" | "zone" | "recipe")}
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
          >
            <option value="equipment">{t("mqttPublishers.equipment")}</option>
            <option value="zone">{t("mqttPublishers.zone")}</option>
            <option value="recipe">{t("mqttPublishers.recipe")}</option>
          </select>
        </div>

        {/* Zone selector — filter for equipment/recipe, direct source for zone */}
        <div>
          <label className="block text-[11px] text-text-secondary mb-1">
            {t("mqttPublishers.zone")}
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
                ? t("mqttPublishers.selectSource")
                : t("mqttPublishers.allZones")}
            </option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>

        {/* Equipment selector — only when sourceType is equipment */}
        {sourceType === "equipment" && (
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("mqttPublishers.equipment")}
            </label>
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSourceKey("");
              }}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="">{t("mqttPublishers.selectSource")}</option>
              {filteredEquipments.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Recipe instance selector — only when sourceType is recipe */}
        {sourceType === "recipe" && (
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("mqttPublishers.recipeInstance")}
            </label>
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSourceKey("");
              }}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="">{t("mqttPublishers.selectSource")}</option>
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
            {t("mqttPublishers.sourceKey")}
          </label>
          <select
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
            className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text"
            disabled={!sourceId}
          >
            <option value="">{t("mqttPublishers.selectKey")}</option>
            {availableKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div className="mt-2 text-[11px] text-red-500">{error}</div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="submit"
          disabled={saving || !publishKey.trim() || !sourceId || !sourceKey}
          className="px-3 py-1 bg-primary text-white text-[12px] rounded-[4px] hover:bg-primary-hover disabled:opacity-50"
        >
          {t("mqttPublishers.addMapping")}
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
