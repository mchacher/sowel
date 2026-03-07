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
  Zap,
  Server,
  Pencil,
} from "lucide-react";
import {
  getMqttPublishers,
  createMqttPublisher,
  updateMqttPublisher,
  deleteMqttPublisher,
  addMqttPublisherMapping,
  updateMqttPublisherMapping,
  removeMqttPublisherMapping,
  testMqttPublisher,
  getEquipments,
  getZones,
  getRecipeInstances,
  getRecipes,
  getMqttBrokers,
  createMqttBroker,
  updateMqttBroker,
  deleteMqttBroker,
} from "../api";
import type {
  MqttPublisherWithMappings,
  MqttPublisherMapping,
  EquipmentWithDetails,
  ZoneWithChildren,
  RecipeInstance,
  RecipeInfo,
  MqttBroker,
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
  const [brokers, setBrokers] = useState<MqttBroker[]>([]);
  const [equipments, setEquipments] = useState<EquipmentWithDetails[]>([]);
  const [zones, setZones] = useState<ZoneWithChildren[]>([]);
  const [recipeInstances, setRecipeInstances] = useState<RecipeInstance[]>([]);
  const [recipes, setRecipes] = useState<RecipeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBrokers, setShowBrokers] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pubs, eqs, zs, ri, recs, brks] = await Promise.all([
        getMqttPublishers(),
        getEquipments(),
        getZones(),
        getRecipeInstances(),
        getRecipes(),
        getMqttBrokers(),
      ]);
      setPublishers(pubs);
      setEquipments(eqs);
      setZones(zs);
      setRecipeInstances(ri);
      setRecipes(recs);
      setBrokers(brks);
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
          <Send size={22} strokeWidth={1.5} className="text-text-secondary" />
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("mqttPublishers.title")}
          </h1>
        </div>
        <p className="text-[13px] text-text-secondary mt-1">
          {t("mqttPublishers.subtitle")}
        </p>
      </div>

      {/* Brokers section */}
      <div className="mb-6">
        <button
          onClick={() => setShowBrokers(!showBrokers)}
          className="flex items-center gap-2 text-[13px] text-text-secondary hover:text-text transition-colors"
        >
          <Server size={16} strokeWidth={1.5} />
          {t("mqttPublishers.brokers")} ({brokers.length})
          {showBrokers ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showBrokers && (
          <BrokersSection brokers={brokers} onRefresh={load} />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setShowCreate(true)}
          disabled={brokers.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-[13px] rounded-[6px] hover:bg-primary-hover transition-colors disabled:opacity-50"
          title={brokers.length === 0 ? t("mqttPublishers.noBrokersHint") : undefined}
        >
          <Plus size={14} />
          {t("mqttPublishers.newPublisher")}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <PublisherForm
          brokers={brokers}
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
          {t("mqttPublishers.empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {publishers.map((pub) => (
            <PublisherCard
              key={pub.id}
              publisher={pub}
              brokers={brokers}
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

// ── Brokers section ───────────────────────────────────────────

function BrokersSection({
  brokers,
  onRefresh,
}: {
  brokers: MqttBroker[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm(t("mqttPublishers.confirmDeleteBroker"))) return;
    try {
      await deleteMqttBroker(id);
      onRefresh();
    } catch (err: unknown) {
      if (err instanceof Error) alert(err.message);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {brokers.map((broker) =>
        editingId === broker.id ? (
          <BrokerForm
            key={broker.id}
            broker={broker}
            onSaved={() => {
              setEditingId(null);
              onRefresh();
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div
            key={broker.id}
            className="flex items-center justify-between px-4 py-2.5 bg-surface rounded-[10px] border border-border max-w-lg"
          >
            <div>
              <div className="text-[13px] font-medium text-text">{broker.name}</div>
              <div className="text-[12px] text-text-tertiary font-mono">{broker.url}</div>
              {broker.username && (
                <div className="text-[11px] text-text-tertiary">{t("mqttPublishers.brokerUsername")}: {broker.username}</div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEditingId(broker.id)}
                className="p-1.5 rounded-[6px] hover:bg-bg transition-colors text-text-tertiary hover:text-text"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => handleDelete(broker.id)}
                className="p-1.5 rounded-[6px] hover:bg-bg transition-colors text-text-tertiary hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ),
      )}
      {showAdd ? (
        <BrokerForm
          onSaved={() => {
            setShowAdd(false);
            onRefresh();
          }}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary-hover transition-colors"
        >
          <Plus size={13} />
          {t("mqttPublishers.addBroker")}
        </button>
      )}
    </div>
  );
}

// ── Broker form (create + edit) ──────────────────────────────

function BrokerForm({
  broker,
  onSaved,
  onCancel,
}: {
  broker?: MqttBroker;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(broker?.name ?? "");
  const [url, setUrl] = useState(broker?.url ?? "");
  const [username, setUsername] = useState(broker?.username ?? "");
  const [password, setPassword] = useState(broker?.password ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (broker) {
        await updateMqttBroker(broker.id, {
          name: name.trim(),
          url: url.trim(),
          username: username.trim() || undefined,
          password: password || undefined,
        });
      } else {
        await createMqttBroker({
          name: name.trim(),
          url: url.trim(),
          username: username.trim() || undefined,
          password: password || undefined,
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
    <form onSubmit={handleSubmit} className="p-4 bg-surface rounded-[10px] border border-border max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.brokerName")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Broker"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.brokerUrl")}
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="mqtt://192.168.0.45:1883"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary font-mono"
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.brokerUsername")}
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text"
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.brokerPassword")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text"
          />
        </div>
        {error && <div className="text-[11px] text-red-500">{error}</div>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !url.trim()}
            className="px-4 py-1.5 bg-primary text-white text-[13px] rounded-[6px] hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : broker ? t("common.save") : t("common.create")}
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

// ── Publisher form (create + edit) ─────────────────────────────

function PublisherForm({
  publisher,
  brokers,
  onSaved,
  onCancel,
}: {
  publisher?: MqttPublisherWithMappings;
  brokers: MqttBroker[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(publisher?.name ?? "");
  const [brokerId, setBrokerId] = useState(
    publisher?.brokerId ?? (brokers.length === 1 ? brokers[0].id : ""),
  );
  const [topic, setTopic] = useState(publisher?.topic ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !brokerId || !topic.trim()) return;
    setSaving(true);
    try {
      if (publisher) {
        await updateMqttPublisher(publisher.id, {
          name: name.trim(),
          brokerId,
          topic: topic.trim(),
        });
      } else {
        await createMqttPublisher({ name: name.trim(), brokerId, topic: topic.trim() });
      }
      onSaved();
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
            placeholder="Mon publisher"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.broker")}
          </label>
          <select
            value={brokerId}
            onChange={(e) => setBrokerId(e.target.value)}
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text"
          >
            <option value="">{t("mqttPublishers.selectBroker")}</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.url})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("mqttPublishers.topic")}
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="sowel/publish/my-topic"
            className="w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !brokerId || !topic.trim()}
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
  brokers,
  equipments,
  zones,
  recipeInstances,
  recipes,
  onRefresh,
}: {
  publisher: MqttPublisherWithMappings;
  brokers: MqttBroker[];
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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<number | null>(null);

  const flatZones = flattenZones(zones);
  const broker = brokers.find((b) => b.id === publisher.brokerId);

  if (editing) {
    return (
      <PublisherForm
        publisher={publisher}
        brokers={brokers}
        onSaved={() => {
          setEditing(false);
          onRefresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

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
            {broker && (
              <span className="ml-2 text-[11px] text-text-tertiary">
                → {broker.name}
              </span>
            )}
            {!publisher.brokerId && (
              <span className="ml-2 text-[11px] text-amber-500">
                {t("mqttPublishers.noBroker")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={testing || publisher.mappings.length === 0 || !publisher.brokerId}
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
          {t("mqttPublishers.mappings")} ({publisher.mappings.length})
        </div>
        {publisher.mappings.length === 0 ? (
          <div className="text-[12px] text-text-tertiary italic">
            {t("mqttPublishers.noMappings")}
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
          {t("mqttPublishers.addMapping")}
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
  mapping: MqttPublisherMapping;
  label: string;
  equipments: EquipmentWithDetails[];
  zones: FlatZone[];
  recipeInstances: RecipeInstance[];
  recipes: RecipeInfo[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [publishKey, setPublishKey] = useState(mapping.publishKey);
  const [sourceType, setSourceType] = useState<"equipment" | "zone" | "recipe">(mapping.sourceType);
  const [filterZoneId, setFilterZoneId] = useState("");
  const [sourceId, setSourceId] = useState(mapping.sourceId);
  const [sourceKey, setSourceKey] = useState(mapping.sourceKey);
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
    if (!publishKey.trim() || !sourceId || !sourceKey) return;
    setSaving(true);
    setError("");
    try {
      await updateMqttPublisherMapping(publisherId, mapping.id, {
        publishKey: publishKey.trim(),
        sourceType,
        sourceId,
        sourceKey,
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
      await removeMqttPublisherMapping(publisherId, mapping.id);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setPublishKey(mapping.publishKey);
    setSourceType(mapping.sourceType);
    setSourceId(mapping.sourceId);
    setSourceKey(mapping.sourceKey);
    setFilterZoneId("");
    setError("");
  };

  if (editing) {
    return (
      <form onSubmit={handleSave} className="p-3 bg-bg rounded-[6px] border border-border">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">
              {t("mqttPublishers.publishKey")}
            </label>
            <input
              type="text"
              value={publishKey}
              onChange={(e) => setPublishKey(e.target.value)}
              className="w-full px-2 py-1 text-[12px] bg-surface border border-border rounded-[4px] text-text font-mono"
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
        <span className="text-[12px] font-mono text-text font-medium shrink-0">
          {mapping.publishKey}
        </span>
        <span className="text-[11px] text-text-tertiary">←</span>
        <span className="text-[11px] text-text-secondary truncate">
          [{mapping.sourceType}] {label}
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
