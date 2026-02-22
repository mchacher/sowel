import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDevices } from "../store/useDevices";
import { DeviceList } from "../components/devices/DeviceList";
import { Radio, Loader2, Search, X } from "lucide-react";
import { useWsSubscription } from "../hooks/useWsSubscription";

export function DevicesPage() {
  useWsSubscription(["devices"]);
  const { t } = useTranslation();
  const devices = useDevices((s) => s.devices);
  const deviceData = useDevices((s) => s.deviceData);
  const loading = useDevices((s) => s.loading);
  const error = useDevices((s) => s.error);
  const [filter, setFilter] = useState("");

  const deviceList = Object.values(devices);
  const onlineCount = deviceList.filter((d) => d.status === "online").length;

  const filtered = filter
    ? deviceList.filter((d) =>
        d.name.toLowerCase().includes(filter.toLowerCase())
      )
    : deviceList;

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            {t("devices.title")}
          </h1>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {deviceList.length === 0
              ? t("devices.waitingDiscovery")
              : t("devices.subtitle", { count: deviceList.length, online: onlineCount })}
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
              {filter ? `${filtered.length}/${deviceList.length}` : deviceList.length}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <DeviceList devices={filtered} deviceData={deviceData} />
      )}
    </div>
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
