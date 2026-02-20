import { useState, useEffect } from "react";
import { X, Radio, Loader2, ChevronRight } from "lucide-react";
import { getDevices, getDevice, type DeviceWithData } from "../../api";
import type { DeviceWithDetails, DeviceData, DeviceOrder } from "../../types";

type BindingMode = "data" | "order";

interface AddBindingModalProps {
  mode: BindingMode;
  onAdd: (params: { id: string; alias: string }) => Promise<void>;
  onClose: () => void;
  /** Aliases already used — prevents duplicates. */
  existingAliases: string[];
}

export function AddBindingModal({
  mode,
  onAdd,
  onClose,
  existingAliases,
}: AddBindingModalProps) {
  const [devices, setDevices] = useState<DeviceWithData[]>([]);
  const [loading, setLoading] = useState(true);

  // Step 1: pick a device — Step 2: pick a data/order item
  const [selectedDevice, setSelectedDevice] = useState<DeviceWithDetails | null>(null);
  const [loadingDevice, setLoadingDevice] = useState(false);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDevices()
      .then((all) => {
        setDevices(all);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSelectDevice = async (deviceId: string) => {
    setLoadingDevice(true);
    setError(null);
    try {
      const detail = await getDevice(deviceId);
      setSelectedDevice(detail);
      setSelectedItemId(null);
      setAlias("");
    } catch {
      setError("Failed to load device details");
    } finally {
      setLoadingDevice(false);
    }
  };

  const handleSelectItem = (item: DeviceData | DeviceOrder) => {
    setSelectedItemId(item.id);
    setAlias(item.key);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!selectedItemId || !alias.trim()) return;

    if (existingAliases.includes(alias.trim())) {
      setError(`Alias "${alias.trim()}" is already used.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ id: selectedItemId, alias: alias.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add binding");
      setSubmitting(false);
    }
  };

  const items: (DeviceData | DeviceOrder)[] = selectedDevice
    ? mode === "data"
      ? selectedDevice.data
      : selectedDevice.orders
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-[14px] border border-border shadow-xl w-full max-w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h2 className="text-[16px] font-semibold text-text">
            Add {mode === "data" ? "data" : "order"} binding
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[4px] hover:bg-border-light"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : !selectedDevice ? (
            /* Step 1: Pick a device */
            <>
              <p className="text-[13px] text-text-secondary">
                Select a device to bind {mode === "data" ? "data from" : "an order to"}.
              </p>
              {devices.length === 0 ? (
                <p className="text-[13px] text-text-tertiary py-4">No devices available.</p>
              ) : (
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {devices.map((device) => (
                    <button
                      key={device.id}
                      onClick={() => handleSelectDevice(device.id)}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-[6px] bg-border-light/50 hover:bg-border-light transition-colors duration-150 text-left"
                    >
                      <Radio size={16} strokeWidth={1.5} className="text-text-tertiary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium text-text">{device.name}</span>
                        {device.manufacturer && (
                          <span className="text-[11px] text-text-tertiary ml-2">
                            {device.manufacturer} {device.model ?? ""}
                          </span>
                        )}
                      </div>
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          device.status === "online"
                            ? "bg-success"
                            : device.status === "offline"
                              ? "bg-error"
                              : "bg-text-tertiary"
                        }`}
                      />
                      <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : loadingDevice ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : (
            /* Step 2: Pick an item + alias */
            <>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedDevice(null)}
                  className="text-[13px] text-primary hover:underline"
                >
                  Devices
                </button>
                <ChevronRight size={12} className="text-text-tertiary" />
                <span className="text-[13px] font-medium text-text">{selectedDevice.name}</span>
              </div>

              {items.length === 0 ? (
                <p className="text-[13px] text-text-tertiary py-4">
                  No {mode === "data" ? "data properties" : "orders"} available on this device.
                </p>
              ) : (
                <div className="space-y-1 max-h-[250px] overflow-y-auto">
                  {items.map((item) => {
                    const isSelected = selectedItemId === item.id;
                    const isData = mode === "data";
                    const dataItem = isData ? (item as DeviceData) : null;
                    const orderItem = !isData ? (item as DeviceOrder) : null;

                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelectItem(item)}
                        className={`
                          flex items-center gap-3 w-full px-3 py-2.5 rounded-[6px]
                          transition-colors duration-150 text-left
                          ${isSelected
                            ? "bg-primary-light border border-primary/30"
                            : "bg-border-light/50 hover:bg-border-light border border-transparent"
                          }
                        `}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-mono font-medium text-text">
                            {item.key}
                          </span>
                          <span className="text-[11px] text-text-tertiary ml-2">
                            ({item.type})
                          </span>
                          {dataItem && (
                            <span className="text-[11px] text-text-tertiary ml-1">
                              · {dataItem.category}
                            </span>
                          )}
                          {orderItem?.min !== undefined && orderItem?.max !== undefined && (
                            <span className="text-[11px] text-text-tertiary ml-1">
                              · [{orderItem.min}–{orderItem.max}]
                            </span>
                          )}
                        </div>
                        {dataItem && (
                          <span className="text-[12px] font-mono text-text-secondary">
                            {dataItem.value !== null && dataItem.value !== undefined
                              ? String(dataItem.value)
                              : "—"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Alias input */}
              {selectedItemId && (
                <div>
                  <label className="block text-[12px] font-medium text-text-secondary mb-1">
                    Alias
                  </label>
                  <input
                    type="text"
                    value={alias}
                    onChange={(e) => {
                      setAlias(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. state, brightness"
                    className="w-full px-3 py-2 text-[13px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
                  />
                </div>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <p className="text-[12px] text-error">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-light">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedItemId || !alias.trim() || submitting}
            className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Adding..." : "Add binding"}
          </button>
        </div>
      </div>
    </div>
  );
}
