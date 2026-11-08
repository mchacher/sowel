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
import {
  equipmentLabelMap,
  flattenZonesWithPath,
  zoneChainMap,
  type ZoneOption,
} from "../lib/zone-path";
import { MappingSourceFields } from "../components/publishers/MappingSourceFields";
import { TOP_LEVEL_H1 } from "../components/layout/page-title";

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
      <div className="px-4 sm:px-6 flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="lg:mb-6">
        <h1 className={TOP_LEVEL_H1}>{t("mqttPublishers.title")}</h1>
      </div>

      {/* Brokers section */}
      <div className="mb-6">
        <button
          onClick={() => setShowBrokers(!showBrokers)}
          className="flex items-center gap-2 text-small text-text-secondary hover:text-text transition-colors"
        >
          <Server size={16} strokeWidth={1.5} />
          {t("mqttPublishers.brokers")} ({brokers.length})
          {showBrokers ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showBrokers && <BrokersSection brokers={brokers} onRefresh={load} />}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setShowCreate(true)}
          disabled={brokers.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-fill text-white text-small rounded-sm hover:bg-primary-fill-hover transition-colors disabled:opacity-50"
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
        <div className="text-small text-text-tertiary py-10 text-center">
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

function BrokersSection({ brokers, onRefresh }: { brokers: MqttBroker[]; onRefresh: () => void }) {
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
            className="card flex items-center justify-between px-4 py-2.5 max-w-lg"
          >
            <div>
              <div className="text-small font-medium text-text">{broker.name}</div>
              <div className="text-caption text-text-tertiary font-mono">{broker.url}</div>
              {broker.username && (
                <div className="text-micro text-text-tertiary">
                  {t("mqttPublishers.brokerUsername")}
                  {t("common.colon")}
                  {broker.username}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEditingId(broker.id)}
                className="p-1.5 rounded-sm hover:bg-bg transition-colors text-text-tertiary hover:text-text"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => handleDelete(broker.id)}
                className="p-1.5 rounded-sm hover:bg-bg transition-colors text-text-tertiary hover:text-error"
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
          className="flex items-center gap-1.5 text-caption text-primary hover:text-primary-hover transition-colors"
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
    <form onSubmit={handleSubmit} className="card p-4 max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("mqttPublishers.brokerName")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Broker"
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("mqttPublishers.brokerUrl")}
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="mqtt://192.168.0.45:1883"
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text placeholder:text-text-tertiary font-mono"
          />
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("mqttPublishers.brokerUsername")}
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text"
          />
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("mqttPublishers.brokerPassword")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text"
          />
        </div>
        {error && <div className="text-micro text-error">{error}</div>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !url.trim()}
            className="px-4 py-1.5 bg-primary-fill text-white text-small rounded-sm hover:bg-primary-fill-hover disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : broker ? (
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
  const [onChangeOnly, setOnChangeOnly] = useState(publisher?.onChangeOnly ?? false);
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
          onChangeOnly,
        });
      } else {
        await createMqttPublisher({
          name: name.trim(),
          brokerId,
          topic: topic.trim(),
          onChangeOnly,
        });
      }
      onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card mb-4 p-4 max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("mqttPublishers.name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mon publisher"
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">
            {t("mqttPublishers.broker")}
          </label>
          <select
            value={brokerId}
            onChange={(e) => setBrokerId(e.target.value)}
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text"
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
          <label className="block text-caption text-text-secondary mb-1">
            {t("mqttPublishers.topic")}
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="sowel/publish/my-topic"
            className="w-full px-3 py-1.5 text-small bg-bg border border-border rounded-sm text-text placeholder:text-text-tertiary font-mono"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onChangeOnly}
            onChange={(e) => setOnChangeOnly(e.target.checked)}
            className="rounded-sm border-border"
          />
          <span className="text-caption text-text-secondary">
            {t("mqttPublishers.onChangeOnly")}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !brokerId || !topic.trim()}
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

  const flatZones = flattenZonesWithPath(zones);
  // Homonym equipments get a "name - zone" label in mapping rows (spec 139).
  const eqLabels = equipmentLabelMap(equipments, zoneChainMap(flatZones));
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
      return eq
        ? `${eqLabels.get(eq.id) ?? eq.name} → ${mapping.sourceKey}`
        : `??? → ${mapping.sourceKey}`;
    }
    if (mapping.sourceType === "recipe") {
      const inst = recipeInstances.find((i) => i.id === mapping.sourceId);
      const recipe = inst ? recipes.find((r) => r.id === inst.recipeId) : undefined;
      const label = recipe ? recipe.name : "???";
      return `${label} → ${mapping.sourceKey}`;
    }
    const zone = flatZones.find((z) => z.id === mapping.sourceId);
    return zone ? `${zone.label} → ${mapping.sourceKey}` : `??? → ${mapping.sourceKey}`;
  };

  return (
    <div className={`card p-4 ${publisher.enabled ? "" : "opacity-60"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Send size={18} strokeWidth={1.5} className="text-text-secondary" />
          <div>
            <h3 className="text-body font-medium text-text">{publisher.name}</h3>
            <span className="text-caption text-text-tertiary font-mono">{publisher.topic}</span>
            {broker && <span className="ml-2 text-micro text-text-tertiary">→ {broker.name}</span>}
            {publisher.onChangeOnly && (
              <span className="ml-2 text-micro text-primary bg-primary/10 px-1.5 py-0.5 rounded-sm">
                {t("mqttPublishers.onChangeOnlyBadge")}
              </span>
            )}
            {!publisher.brokerId && (
              <span className="ml-2 text-micro text-warning-ink">
                {t("mqttPublishers.noBroker")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={testing || publisher.mappings.length === 0 || !publisher.brokerId}
            className="flex items-center gap-1 px-2 py-1 text-micro rounded-sm hover:bg-bg transition-colors text-text-secondary hover:text-primary disabled:opacity-40"
            title={t("mqttPublishers.testPublish")}
          >
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {t("mqttPublishers.test")}
          </button>
          {testResult !== null && (
            <span className="text-micro text-success">
              {t("mqttPublishers.testResult", { count: testResult })}
            </span>
          )}
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
          {t("mqttPublishers.mappings")} ({publisher.mappings.length})
        </div>
        {publisher.mappings.length === 0 ? (
          <div className="text-caption text-text-tertiary italic">
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
          className="flex items-center gap-1.5 text-caption text-primary hover:text-primary-hover transition-colors"
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
  zones: ZoneOption[];
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

  const handleToggleEnabled = async () => {
    try {
      await updateMqttPublisherMapping(publisherId, mapping.id, { enabled: !mapping.enabled });
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
      <form onSubmit={handleSave} className="p-3 bg-background rounded-md">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-micro text-text-secondary mb-1">
              {t("mqttPublishers.publishKey")}
            </label>
            <input
              type="text"
              value={publishKey}
              onChange={(e) => setPublishKey(e.target.value)}
              className="w-full px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text font-mono"
              autoFocus
            />
          </div>
          <MappingSourceFields
            keyPrefix="mqttPublishers"
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
          />
        </div>
        {error && <div className="mt-2 text-micro text-error">{error}</div>}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="submit"
            disabled={saving || !publishKey.trim() || !sourceId || !sourceKey}
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
    <div
      className={`flex items-center justify-between px-3 py-1.5 bg-bg rounded-sm ${
        mapping.enabled ? "" : "opacity-50"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-caption font-mono text-text font-medium shrink-0">
          {mapping.publishKey}
        </span>
        <span className="text-micro text-text-tertiary">←</span>
        <span className="text-micro text-text-secondary truncate">
          [{mapping.sourceType}] {label}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="p-1 rounded-sm hover:bg-surface transition-colors text-text-tertiary hover:text-text"
          title={t("common.edit")}
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={handleToggleEnabled}
          className="p-1 rounded-sm hover:bg-surface transition-colors text-text-tertiary hover:text-text"
          title={
            mapping.enabled ? t("mqttPublishers.mappingDisable") : t("mqttPublishers.mappingEnable")
          }
        >
          {mapping.enabled ? <Power size={12} /> : <PowerOff size={12} />}
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded-sm hover:bg-surface transition-colors text-text-tertiary hover:text-error"
          title={t("common.delete")}
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
  const [publishKey, setPublishKey] = useState("");
  const [sourceType, setSourceType] = useState<"equipment" | "zone" | "recipe">("equipment");
  const [filterZoneId, setFilterZoneId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    <form onSubmit={handleSubmit} className="p-3 bg-background rounded-md">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-micro text-text-secondary mb-1">
            {t("mqttPublishers.publishKey")}
          </label>
          <input
            type="text"
            value={publishKey}
            onChange={(e) => setPublishKey(e.target.value)}
            placeholder="Thome"
            className="w-full px-2 py-1 text-caption border border-border bg-surface rounded-sm text-text font-mono placeholder:text-text-tertiary"
            autoFocus
          />
        </div>
        <MappingSourceFields
          keyPrefix="mqttPublishers"
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
        />
      </div>
      {error && <div className="mt-2 text-micro text-error">{error}</div>}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="submit"
          disabled={saving || !publishKey.trim() || !sourceId || !sourceKey}
          className="px-3 py-1 bg-primary-fill text-white text-caption rounded-sm hover:bg-primary-fill-hover disabled:opacity-50"
        >
          {t("mqttPublishers.addMapping")}
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
