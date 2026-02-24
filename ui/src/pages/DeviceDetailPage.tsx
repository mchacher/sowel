import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Radio,
  Loader2,
  ChevronDown,
  ChevronRight,
  Zap,
  Trash2,
} from "lucide-react";
import type { DeviceOrder, DeviceWithDetails } from "../types";
import { getDevice, getDeviceRawExpose, deleteDevice } from "../api";
import { useDevices } from "../store/useDevices";
import { DeviceNameEditor } from "../components/devices/DeviceNameEditor";
import { DeviceDataTable } from "../components/devices/DeviceDataTable";
import { sourceLabel } from "../lib/format";
import { RelativeTime } from "../components/RelativeTime";
import { useWsSubscription } from "../hooks/useWsSubscription";

export function DeviceDetailPage() {
  useWsSubscription(["devices"]);
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateDeviceName = useDevices((s) => s.updateDeviceName);

  // Device from store (real-time updates)
  const device = useDevices((s) => (id ? s.devices[id] : undefined));
  const liveData = useDevices((s) => (id ? s.deviceData[id] : undefined));

  // Full detail from API (orders, etc.)
  const [detail, setDetail] = useState<DeviceWithDetails | null>(null);
  const [rawExpose, setRawExpose] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm(t("devices.deleteConfirm"))) return;
    setDeleting(true);
    try {
      await deleteDevice(id);
      navigate(-1);
    } catch {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- loading state before async fetch
    setError(null);

    Promise.all([getDevice(id), getDeviceRawExpose(id)])
      .then(([deviceDetail, raw]) => {
        if (cancelled) return;
        setDetail(deviceDetail);
        setRawExpose(raw.expose);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load device");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (error || !device || !detail) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text transition-colors duration-150 ease-out mb-6"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          {t("devices.backToDevices")}
        </button>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h3 className="text-[16px] font-medium text-text mb-1">{t("devices.notFound.title")}</h3>
          <p className="text-[13px] text-text-secondary">{error ?? t("devices.notFound.message")}</p>
        </div>
      </div>
    );
  }

  // Merge live data with detail data (live data takes precedence for values)
  const mergedData = liveData ?? detail.data;

  return (
    <div className="p-6 max-w-[960px]">
      {/* Back navigation */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text transition-colors duration-150 ease-out mb-6"
      >
        <ArrowLeft size={16} strokeWidth={1.5} />
        {t("devices.backToDevices")}
      </button>

      {/* Device header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-[10px] bg-primary-light flex items-center justify-center">
            <Radio size={24} strokeWidth={1.5} className="text-primary" />
          </div>
          <div>
            <DeviceNameEditor
              name={device.name}
              onSave={(name) => updateDeviceName(device.id, name)}
            />
            <div className="flex items-center gap-3 mt-1.5">
              <StatusBadge status={device.status} />
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-border-light text-[11px] font-medium text-text-secondary">
                {sourceLabel(device.source)}
              </span>
              {device.manufacturer && (
                <span className="text-[12px] text-text-tertiary">
                  {device.manufacturer}{device.model ? ` · ${device.model}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] font-medium text-error hover:bg-error/10 transition-colors duration-150 cursor-pointer disabled:opacity-50"
        >
          <Trash2 size={14} strokeWidth={1.5} />
          {deleting ? t("common.deleting") : t("common.delete")}
        </button>
      </div>

      {/* Info bar */}
      <div className="flex flex-wrap gap-4 mb-8 p-4 bg-surface rounded-[10px] border border-border">
        <InfoItem label={t("devices.sourceId")} value={device.sourceDeviceId} mono />
        {!!device.ieeeAddress && (
          <InfoItem label={t("devices.ieeeAddress")} value={device.ieeeAddress} mono />
        )}
        <InfoItem label={t("devices.lastSeen")} value={<RelativeTime iso={device.lastSeen} />} />
        <InfoItem label={t("devices.created")} value={<RelativeTime iso={device.createdAt} />} />
      </div>

      {/* Data section */}
      <section className="mb-8">
        <h2 className="text-[20px] font-semibold text-text leading-[28px] mb-4">
          {t("devices.data")}
        </h2>
        <div className="bg-surface rounded-[10px] border border-border overflow-hidden">
          <DeviceDataTable data={mergedData} />
        </div>
      </section>

      {/* Orders section */}
      {detail.orders.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[20px] font-semibold text-text leading-[28px] mb-4">
            {t("devices.orders")}
          </h2>
          <div className="bg-surface rounded-[10px] border border-border overflow-hidden">
            <OrdersTable orders={detail.orders} />
          </div>
        </section>
      )}

      {/* Raw expose section */}
      {!!rawExpose && (
        <section className="mb-8">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-2 text-[16px] font-medium text-text-secondary hover:text-text transition-colors duration-150 ease-out mb-3"
          >
            {showRaw ? (
              <ChevronDown size={18} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={18} strokeWidth={1.5} />
            )}
            {t("devices.rawExpose")}
          </button>
          {showRaw && (
            <div className="bg-surface rounded-[10px] border border-border p-4 overflow-x-auto">
              <pre className="font-mono text-[12px] text-text-secondary leading-[18px] whitespace-pre-wrap">
                {JSON.stringify(rawExpose, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const config = {
    online: { color: "bg-success/10 text-success", dot: "bg-success", label: t("status.online") },
    offline: { color: "bg-error/10 text-error", dot: "bg-error", label: t("status.offline") },
    unknown: { color: "bg-border-light text-text-tertiary", dot: "bg-text-tertiary", label: t("status.unknown") },
  }[status] ?? { color: "bg-border-light text-text-tertiary", dot: "bg-text-tertiary", label: status };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${config.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function InfoItem({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[120px]">
      <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
        {label}
      </span>
      <span className={`text-[13px] text-text ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function OrdersTable({ orders }: { orders: DeviceOrder[] }) {
  const { t } = useTranslation();
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border">
          <th className="text-left py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
            {t("devices.col.key")}
          </th>
          <th className="text-left py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
            {t("common.type")}
          </th>
          <th className="text-left py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
            {t("devices.col.range")}
          </th>
          <th className="text-left py-2.5 px-3 text-[12px] font-medium text-text-secondary uppercase tracking-wider">
            {t("devices.col.topic")}
          </th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr
            key={order.id}
            className="border-b border-border-light hover:bg-border-light/50 transition-colors duration-100"
          >
            <td className="py-2.5 px-3">
              <div className="flex items-center gap-1.5">
                <Zap size={14} strokeWidth={1.5} className="text-accent" />
                <span className="font-mono text-[13px] text-text">{order.key}</span>
              </div>
            </td>
            <td className="py-2.5 px-3">
              <span className="text-[12px] text-text-secondary">{order.type}</span>
            </td>
            <td className="py-2.5 px-3">
              <OrderRange order={order} />
            </td>
            <td className="py-2.5 px-3">
              <span className="font-mono text-[11px] text-text-tertiary truncate block max-w-[200px]">
                {(order.dispatchConfig?.topic as string) ?? "—"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrderRange({ order }: { order: DeviceOrder }) {
  if (order.enumValues && order.enumValues.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {order.enumValues.map((v) => (
          <span
            key={v}
            className="px-1.5 py-0.5 rounded bg-border-light text-[11px] font-mono text-text-secondary"
          >
            {v}
          </span>
        ))}
      </div>
    );
  }

  if (order.min !== undefined || order.max !== undefined) {
    return (
      <span className="font-mono text-[12px] text-text-secondary">
        {order.min ?? "—"} … {order.max ?? "—"}
        {order.unit ? ` ${order.unit}` : ""}
      </span>
    );
  }

  return <span className="text-[12px] text-text-tertiary">—</span>;
}
