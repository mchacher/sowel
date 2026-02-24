import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useDevices } from "../store/useDevices";
import { DeviceList } from "../components/devices/DeviceList";
import { Radio, Loader2, Search, X } from "lucide-react";
import { useWsSubscription } from "../hooks/useWsSubscription";

/** Labels for integration tabs. */
const INTEGRATION_LABELS: Record<string, string> = {
  zigbee2mqtt: "Zigbee2MQTT",
  panasonic_cc: "Panasonic CC",
  mcz_maestro: "MCZ Maestro",
  netatmo_hc: "Legrand H+C",
  tasmota: "Tasmota",
  esphome: "ESPHome",
  shelly: "Shelly",
  custom_mqtt: "MQTT",
};

const ALL_TAB = "__all__";

export function DevicesPage() {
  useWsSubscription(["devices"]);
  const { t } = useTranslation();
  const devices = useDevices((s) => s.devices);
  const deviceData = useDevices((s) => s.deviceData);
  const loading = useDevices((s) => s.loading);
  const error = useDevices((s) => s.error);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("q") ?? "";
  const activeTab = searchParams.get("tab") ?? ALL_TAB;

  const setFilter = (q: string) => {
    setSearchParams((prev) => {
      if (q) prev.set("q", q);
      else prev.delete("q");
      return prev;
    }, { replace: true });
  };
  const setActiveTab = (tab: string) => {
    setSearchParams((prev) => {
      if (tab === ALL_TAB) prev.delete("tab");
      else prev.set("tab", tab);
      return prev;
    }, { replace: true });
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
  const tabFiltered = resolvedTab === ALL_TAB
    ? deviceList
    : deviceList.filter((d) => d.integrationId === resolvedTab);

  const filtered = filter
    ? tabFiltered.filter((d) =>
        d.name.toLowerCase().includes(filter.toLowerCase())
      )
    : tabFiltered;

  const onlineCount = tabFiltered.filter((d) => d.status === "online").length;

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("devices.title")}
          </h1>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {tabFiltered.length === 0
              ? t("devices.waitingDiscovery")
              : t("devices.subtitle", { count: tabFiltered.length, online: onlineCount })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Filter input */}
          <div className="relative">
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
              className="w-[200px] pl-8 pr-8 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
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

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[6px] bg-primary-light text-primary">
            <Radio size={16} strokeWidth={1.5} />
            <span className="text-[13px] font-medium">
              {filter ? `${filtered.length}/${tabFiltered.length}` : tabFiltered.length}
            </span>
          </div>
        </div>
      </div>

      {/* Integration tabs */}
      {tabs.length > 1 && (
        <div className="flex items-center gap-1 mb-4 border-b border-border">
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
                label={INTEGRATION_LABELS[integrationId] ?? integrationId}
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
        <DeviceList devices={filtered} deviceData={deviceData} activeTab={resolvedTab === ALL_TAB ? null : resolvedTab} />
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
        px-3 py-2 text-[13px] font-medium transition-colors duration-150
        border-b-2 -mb-px cursor-pointer
        ${active
          ? "border-primary text-primary"
          : "border-transparent text-text-tertiary hover:text-text-secondary hover:border-border"
        }
      `}
    >
      {label}
      <span className={`ml-1.5 text-[11px] tabular-nums ${active ? "text-primary/70" : "text-text-tertiary"}`}>
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
      <h3 className="text-[16px] font-medium text-text mb-1">{t("devices.error.title")}</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">
        {error}
      </p>
      <button
        onClick={() => fetchDevices()}
        className="px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 ease-out"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
