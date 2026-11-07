import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useDevices } from "../store/useDevices";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { DeviceList } from "../components/devices/DeviceList";
import { flattenZonesWithPath } from "../lib/zone-path";
import { Radio, Loader2, Search, X } from "lucide-react";
import { useWsSubscription } from "../hooks/useWsSubscription";
import { INTEGRATION_LABELS } from "../constants";
import { PageHeader } from "../components/layout/PageHeader";
import { getIntegrations } from "../api";

const ALL_TAB = "__all__";

export function DevicesPage() {
  useWsSubscription(["devices", "equipments", "zones"]);
  const { t } = useTranslation();
  const devices = useDevices((s) => s.devices);
  const deviceData = useDevices((s) => s.deviceData);
  const loading = useDevices((s) => s.loading);
  const error = useDevices((s) => s.error);
  const equipments = useEquipments((s) => s.equipments);
  const zoneTree = useZones((s) => s.tree);

  // Tab labels come from the installed plugin's own name (« LoRa2MQTT », « Somfy RTS
  // Bridge »), not from cutting its id (« Lora2mqtt », « Somfy Rts »). The fixed list
  // and the cut stay as fallbacks while the names load, or if they cannot.
  const [integrationNames, setIntegrationNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    getIntegrations()
      .then((list) => {
        if (!cancelled) setIntegrationNames(Object.fromEntries(list.map((i) => [i.id, i.name])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Flatten zone tree into id → path-aware label map (spec 139)
  const zoneNames = useMemo(
    () => new Map(flattenZonesWithPath(zoneTree).map((z) => [z.id, z.label])),
    [zoneTree],
  );

  // Build map: deviceId → list of equipments that reference it via bindings
  const deviceEquipmentMap = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; zoneName?: string; zoneId?: string }[]
    >();
    for (const eq of equipments) {
      const deviceIds = new Set<string>();
      for (const b of eq.dataBindings ?? []) {
        if (b.deviceId) deviceIds.add(b.deviceId);
      }
      const zoneName = eq.zoneId ? zoneNames.get(eq.zoneId) : undefined;
      for (const deviceId of deviceIds) {
        if (!map.has(deviceId)) map.set(deviceId, []);
        map.get(deviceId)!.push({ id: eq.id, name: eq.name, zoneName, zoneId: eq.zoneId });
      }
    }
    return map;
  }, [equipments, zoneNames]);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("q") ?? "";
  const activeTab = searchParams.get("tab") ?? ALL_TAB;

  const setFilter = (q: string) => {
    setSearchParams(
      (prev) => {
        if (q) prev.set("q", q);
        else prev.delete("q");
        return prev;
      },
      { replace: true },
    );
  };
  const setActiveTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        if (tab === ALL_TAB) prev.delete("tab");
        else prev.set("tab", tab);
        return prev;
      },
      { replace: true },
    );
  };

  const deviceList = Object.values(devices);

  // Build tabs from actual integrations present in device list
  const tabs = useMemo(() => {
    const integrationIds = new Set(deviceList.map((d) => d.integrationId));
    return Array.from(integrationIds)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [deviceList]);

  // If active tab no longer exists (e.g. integration removed), fall back to all
  const resolvedTab = activeTab === ALL_TAB || tabs.includes(activeTab) ? activeTab : ALL_TAB;

  // Filter by tab then by search
  const tabFiltered =
    resolvedTab === ALL_TAB
      ? deviceList
      : deviceList.filter((d) => d.integrationId === resolvedTab);

  const filtered = filter
    ? tabFiltered.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()))
    : tabFiltered;

  const onlineCount = tabFiltered.filter((d) => d.status === "online").length;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        className="mb-4"
        title={t("devices.title")}
        subtitle={
          tabFiltered.length === 0
            ? t("devices.waitingDiscovery")
            : t("devices.subtitle", { count: tabFiltered.length, online: onlineCount })
        }
        actions={
          <>
            {/* Filter input */}
            <div className="relative flex-1 sm:flex-none">
              <Search
                size={14}
                strokeWidth={1.5}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
              />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("devices.filterPlaceholder")}
                className="w-full sm:w-[200px] pl-8 pr-8 py-1.5 text-small border border-border bg-surface rounded-sm outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
              />
              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-sm bg-primary-light text-primary">
              <Radio size={16} strokeWidth={1.5} />
              <span className="text-small font-medium">
                {filter ? `${filtered.length}/${tabFiltered.length}` : tabFiltered.length}
              </span>
            </div>
          </>
        }
      />

      {/* Integration tabs */}
      {tabs.length > 1 && (
        <div className="flex items-center gap-1 mb-4 border-b border-border overflow-x-auto whitespace-nowrap -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabButton
            label={t("common.all")}
            count={deviceList.length}
            active={resolvedTab === ALL_TAB}
            onClick={() => setActiveTab(ALL_TAB)}
          />
          {tabs.map((integrationId) => {
            const count = deviceList.filter((d) => d.integrationId === integrationId).length;
            return (
              <TabButton
                key={integrationId}
                label={
                  integrationNames[integrationId] ??
                  INTEGRATION_LABELS[integrationId] ??
                  integrationId
                    .split(/[-_]/)
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")
                }
                count={count}
                active={resolvedTab === integrationId}
                onClick={() => setActiveTab(integrationId)}
              />
            );
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <DeviceList
          devices={filtered}
          deviceData={deviceData}
          activeTab={resolvedTab === ALL_TAB ? null : resolvedTab}
          deviceEquipmentMap={deviceEquipmentMap}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        shrink-0 px-3 py-2 text-small font-medium transition-colors duration-150
        border-b-2 -mb-px cursor-pointer
        ${
          active
            ? "border-primary text-primary"
            : "border-transparent text-text-tertiary hover:text-text-secondary hover:border-border"
        }
      `}
    >
      {label}
      <span
        className={`ml-1.5 text-micro tabular-nums ${active ? "text-primary/70" : "text-text-tertiary"}`}
      >
        {count}
      </span>
    </button>
  );
}

function ErrorState({ error }: { error: string }) {
  const { t } = useTranslation();
  const fetchDevices = useDevices((s) => s.fetchDevices);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
        <Radio size={28} strokeWidth={1.5} className="text-error" />
      </div>
      <h3 className="text-lead font-medium text-text mb-1">{t("devices.error.title")}</h3>
      <p className="text-small text-text-secondary max-w-[320px] mb-4">{error}</p>
      <button
        onClick={() => fetchDevices()}
        className="px-4 py-2 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover transition-colors duration-150 ease-out"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
