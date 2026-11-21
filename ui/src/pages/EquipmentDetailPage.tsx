import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useDevices } from "../store/useDevices";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useAuth } from "../store/useAuth";
import { getHistoryBindings, setHistorize } from "../api";
import { EquipmentForm } from "../components/equipments/EquipmentForm";
import { LightControl } from "../components/equipments/LightControl";
import { SolarControl } from "../components/equipments/SolarControl";
import { findOrderByCategory, findMainOnOffOrder } from "../components/equipments/bindingUtils";
import { ShutterControl } from "../components/equipments/ShutterControl";
import { ThermostatCard } from "../components/equipments/ThermostatCard";
import { WaterValveControl } from "../components/equipments/WaterValveControl";
import { VmcControl } from "../components/equipments/VmcControl";
import { EvChargerControl } from "../components/equipments/EvChargerControl";
import { ElectricVehicleControl } from "../components/equipments/ElectricVehicleControl";
import { PoolHeatPumpControl } from "../components/equipments/PoolHeatPumpControl";
import { SensorDataPanel } from "../components/equipments/SensorDataPanel";
import { SolarPanelDataPanel } from "../components/equipments/SolarPanelDataPanel";
import { WeatherPanel } from "../components/equipments/WeatherPanel";
import { WeatherForecastPanel } from "../components/equipments/WeatherForecastPanel";
import { DisplayPanel } from "../components/equipments/DisplayPanel";
import { CameraPanel } from "../components/equipments/CameraPanel";
import { UpsPanel } from "../components/equipments/UpsPanel";
import { AddBindingModal } from "../components/equipments/AddBindingModal";
import { EquipmentStatusBadge } from "../components/equipments/EquipmentStatusBadge";
import { OrderOutcomeLine } from "../components/equipments/OrderOutcomeLine";
import { DeviceSelector } from "../components/equipments/DeviceSelector";
import { TYPE_LABELS } from "../components/equipments/equipment-type-meta";
import { useEquipmentState } from "../components/equipments/useEquipmentState";
import { isSubmeterEquipment } from "../lib/metering";
import {
  autoCreateBindings,
  removeAllBindings,
  computeMissingBindings,
  fetchDevices,
} from "../components/equipments/bindingUtils";
import { MissingBindingsModal } from "../components/equipments/MissingBindingsModal";
import { GateControl } from "../components/equipments/GateControl";
import { HeaterControl } from "../components/equipments/HeaterControl";
import { ButtonActionsSection } from "../components/equipments/ButtonActionsSection";
import { EnergyDataPanel } from "../components/equipments/EnergyDataPanel";
import { ElectricalMeteringPanel } from "../components/equipments/ElectricalMeteringPanel";
import { MeteringParentPanel } from "../components/equipments/MeteringParentPanel";
import { EvHomeChargingSection } from "../components/equipments/ev-sessions/EvHomeChargingSection";
import { EvChargerSessionsSection } from "../components/equipments/ev-sessions/EvChargerSessionsSection";
import { EnergyManagementPanel } from "../components/equipments/EnergyManagementPanel";
import { GateConfirmationPanel } from "../components/equipments/GateConfirmationPanel";
import { OrderOutcomePanel } from "../components/equipments/OrderOutcomePanel";
import { ORDER_OUTCOME_TYPES } from "../../../src/shared/order-outcome-tracking";
import { SharedAccessPanel } from "../components/equipments/SharedAccessPanel";
import { TimedCommandPanel } from "../components/equipments/TimedCommandPanel";
import { TimedCommandControl } from "../components/equipments/TimedCommandControl";
import { hasTimedCommandCandidate } from "../../../src/shared/timed-command";
import { InvertDirectionPanel } from "../components/equipments/InvertDirectionPanel";
import { FamilyPanel } from "../components/equipments/FamilyPanel";
import { MediaPlayerPanel } from "../components/equipments/MediaPlayerPanel";
import { AppliancePanel } from "../components/equipments/AppliancePanel";
import {
  ArrowLeft,
  Loader2,
  Box,
  Pencil,
  Trash2,
  Link2,
  Unlink,
  Zap,
  Plus,
  Cpu,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  X,
  Database,
  Settings,
  Activity,
  Sparkles,
} from "lucide-react";
import { RelativeTime } from "../components/RelativeTime";
import type { EquipmentWithDetails, HistoryBindingState } from "../types";
import { useWsSubscription } from "../hooks/useWsSubscription";
import { HistoryPanel } from "../components/history/HistoryPanel";
import { useEquipmentDetail } from "../hooks/useEquipmentDetail";
import { apiErrorMessage, apiErrorText } from "../lib/api-error";
import { formatNumber } from "../lib/format";
import { readEquipmentOrigin, type EquipmentOrigin } from "../lib/equipment-origin";
import { flattenZonesWithPath } from "../lib/zone-path";
import { mainHistoryAlias } from "../components/history/main-series";

export function EquipmentDetailPage() {
  useWsSubscription(["equipments", "devices", "energy"]);
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const origin = readEquipmentOrigin(location.state);
  const equipments = useEquipments((s) => s.equipments);
  const updateEquipment = useEquipments((s) => s.updateEquipment);
  const deleteEquipment = useEquipments((s) => s.deleteEquipment);
  const executeOrder = useEquipments((s) => s.executeOrder);
  const addDataBinding = useEquipments((s) => s.addDataBinding);
  const removeDataBinding = useEquipments((s) => s.removeDataBinding);
  const addOrderBinding = useEquipments((s) => s.addOrderBinding);
  const removeOrderBinding = useEquipments((s) => s.removeOrderBinding);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);
  const isAdmin = useAuth((s) => s.user?.role === "admin");

  const { equipment, fromStore, notFound, error: loadError, retry } = useEquipmentDetail(id);
  // The equipment's room: the subtitle names it, and the back link goes there
  // when the page was not opened from a link that says where it came from.
  const zoneId = equipment?.zoneId;
  const room = useMemo(() => {
    const zone = zoneId ? flattenZonesWithPath(tree).find((z) => z.id === zoneId) : undefined;
    return zone ? { id: zone.id, name: zone.name } : null;
  }, [tree, zoneId]);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showAddDataBinding, setShowAddDataBinding] = useState(false);
  const [showAddOrderBinding, setShowAddOrderBinding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showBindings, setShowBindings] = useState(false);
  // Issue #707 — data points a plugin started publishing after this equipment
  // was bound. Counted only once the section is opened: it needs one fetch per
  // backing device, and the page should not pay for that on every visit.
  const [showMissingBindings, setShowMissingBindings] = useState(false);
  const [missingBindingCount, setMissingBindingCount] = useState<number | null>(null);
  const [showChangeDevice, setShowChangeDevice] = useState(false);
  const [historyBindings, setHistoryBindings] = useState<HistoryBindingState[]>([]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  // Issue #707 — count what the auto-binder would add that is not bound yet.
  //
  // Gated on the section being open: it costs one GET per backing device, and
  // it is only ever read from inside that section. Keyed on the BINDINGS, not
  // on `equipment`: that object is replaced each time a reading arrives (the
  // store patches it in place, see useEquipmentDetail), so depending on it would
  // re-fetch every device each time a sensor reports. Tracking the bindings
  // means a plugin publishing a new point while the page sits open is picked
  // up on the next binding change or revisit, not live — which is the right
  // trade for a count read only inside an expanded section.
  const bindingSignature = useMemo(() => {
    if (!equipment) return "";
    return JSON.stringify({
      type: equipment.type,
      data: equipment.dataBindings.map((b) => [b.id, b.deviceId, b.deviceDataId, b.alias]),
      orders: equipment.orderBindings.map((b) => [b.id, b.deviceId, b.deviceOrderId, b.alias]),
    });
  }, [equipment]);

  useEffect(() => {
    if (!showBindings || !equipment) return;
    let cancelled = false;
    const { type, dataBindings, orderBindings } = equipment;
    const deviceIds = [
      ...new Set([...dataBindings.map((b) => b.deviceId), ...orderBindings.map((b) => b.deviceId)]),
    ];
    if (deviceIds.length === 0) {
      setMissingBindingCount(0);
      return;
    }
    fetchDevices(deviceIds)
      .then((devices) => {
        if (cancelled) return;
        setMissingBindingCount(
          computeMissingBindings(devices, type, dataBindings, orderBindings).length,
        );
      })
      .catch(() => {
        if (!cancelled) setMissingBindingCount(null);
      });
    return () => {
      cancelled = true;
    };
    // `equipment` is read for its bindings only, and bindingSignature is
    // exactly the part of it this effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBindings, bindingSignature]);

  // Must call hooks before any early returns
  const EMPTY: EquipmentWithDetails = {
    id: "",
    name: "",
    type: "sensor",
    zoneId: "",
    enabled: true,
    createdAt: "",
    updatedAt: "",
    dataBindings: [],
    orderBindings: [],
    status: "online",
  };
  const equipmentState = useEquipmentState(equipment ?? EMPTY);

  // Eagerly load history bindings so HistoryPanel can render immediately
  const loadHistoryBindings = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getHistoryBindings(id);
      setHistoryBindings(data);
    } catch {
      // Silently ignore — history may not be configured
    }
  }, [id]);

  useEffect(() => {
    loadHistoryBindings();
  }, [loadHistoryBindings]);

  if (!equipment && !notFound && !loadError) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  // A 404 is the only « introuvable ». Any other failure says what it was (a busy
  // server, no connection) and offers a retry, and only when there is nothing on
  // screen: a failed refresh of a loaded page keeps it (notice below).
  const failure = loadError ? apiErrorMessage(loadError, t) : null;
  if (notFound || !equipment) {
    return (
      <div className="p-4 sm:p-6">
        <BackLink origin={origin} room={null} />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
            <Box size={28} strokeWidth={1.5} className="text-error" />
          </div>
          <h3 className="text-lead font-medium text-text mb-1">
            {notFound || !failure ? t("equipments.notFound.title") : failure.title}
          </h3>
          <p className="text-small text-text-secondary">
            {notFound || !failure ? t("equipments.notFound.message") : failure.message}
          </p>
          {!notFound && failure && (
            <button
              type="button"
              onClick={retry}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-small font-medium text-text-secondary border border-border rounded-sm hover:bg-border-light transition-colors duration-150 cursor-pointer"
            >
              <RefreshCw size={14} strokeWidth={1.5} />
              {t("common.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm(t("equipments.deleteConfirm", { name: equipment.name }))) return;
    setDeleting(true);
    try {
      await deleteEquipment(equipment.id);
      navigate("/equipments");
    } catch (err) {
      alert(apiErrorText(err, t));
      setDeleting(false);
    }
  };

  const {
    isLight,
    isSwitch,
    isShutterFamily,
    isSensor,
    isThermostat,
    isHeater,
    isGate,
    actionBinding,
  } = equipmentState;

  return (
    <div className="p-4 sm:p-6">
      {/* Back: to where the page was opened from, else to the equipment's room
          (spec 196, pr9-retour). */}
      <BackLink origin={origin} room={room} />

      {/* A refresh failed: the last good data stays, with what went wrong and a retry.
          Not when the store holds the equipment: that copy is live, nothing is missing. */}
      {failure && !fromStore && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4 px-3 py-2 rounded-md border border-warning/30 bg-warning/10 text-small"
        >
          <span className="font-medium text-text">{failure.title}</span>
          <span className="text-text-secondary">{t("equipments.keptData")}</span>
          <button
            type="button"
            onClick={retry}
            className="ml-auto inline-flex items-center gap-1.5 font-medium text-primary hover:underline cursor-pointer"
          >
            <RefreshCw size={14} strokeWidth={1.5} />
            {t("common.retry")}
          </button>
        </div>
      )}

      {/* Header */}
      {/* min-w-0 down the chain + wrap-anywhere: a long name with no spaces
          (issue #950) wraps instead of widening the page on a phone. */}
      <div className="flex items-start justify-between gap-3 mb-4 sm:mb-8">
        <div className="flex items-center gap-3 min-w-0">
          {/* Spec 208 — the tile of its family, as in the Maison rows. */}
          <div
            className={`w-10 h-10 shrink-0 rounded-md flex items-center justify-center ${equipmentState.iconColor}`}
          >
            {equipmentState.iconElement}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="min-w-0 wrap-anywhere">{equipment.name}</h1>
              {/* Spec 116: availability badge next to the equipment name */}
              <EquipmentStatusBadge
                status={equipment.status}
                reason={equipment.statusReason}
                size="md"
              />
            </div>
            <p className="text-small text-text-secondary wrap-anywhere">
              {t(TYPE_LABELS[equipment.type])}
              {room && ` · ${room.name}`}
              {equipment.description && ` · ${equipment.description}`}
              {!equipment.enabled && (
                <span className="text-warning-ink ml-2">{t("common.disabled")}</span>
              )}
            </p>
            {/* Spec 188 — what became of the last tracked order (gate, cover). */}
            <OrderOutcomeLine equipmentId={equipment.id} className="mt-1" />
            {actionBinding && actionBinding.value != null && (
              <div className="flex items-center gap-1.5 mt-1 text-caption text-text-tertiary">
                <Clock size={12} strokeWidth={1.5} />
                <span className="font-mono font-medium text-text-secondary min-w-0 wrap-anywhere">
                  {String(actionBinding.value)}
                </span>
                {actionBinding.lastUpdated && (
                  <span>
                    · <RelativeTime iso={actionBinding.lastUpdated} />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowEditForm(true)}
              className="flex items-center gap-1.5 p-2 sm:px-3 sm:py-2 text-small font-medium text-text-secondary border border-border rounded-sm hover:bg-border-light transition-colors duration-150 cursor-pointer"
              title={t("common.edit")}
            >
              <Pencil size={14} strokeWidth={1.5} />
              <span className="hidden sm:inline">{t("common.edit")}</span>
            </button>
          </div>
        )}
      </div>

      {/* Spec 196 — use first: the controls, the timed action, the sessions and
          the 24 h chart; then energy; then, for an admin, the configuration. */}
      {/* Controls — light, switch (smart plug) and water heater share the ON/OFF
          toggle surface. Spec 152: a water heater can additionally (or only, on
          permanent mains) carry a dedicated "solar" on/off. Each toggle renders
          iff its channel is bound. */}
      {(isLight || isSwitch || equipment.type === "water_heater") &&
        equipment.enabled &&
        (!!findMainOnOffOrder(equipment.orderBindings) ||
          !!findOrderByCategory(equipment.orderBindings, ["solar_toggle"], ["solar"])) && (
          <div className="card p-4 mb-6">
            <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
            <div className="flex flex-wrap items-center gap-3">
              {!!findMainOnOffOrder(equipment.orderBindings) && (
                <LightControl
                  equipment={equipment}
                  onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
                />
              )}
              <SolarControl
                equipment={equipment}
                onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
              />
            </div>
          </div>
        )}

      {/* Shutter / Awning controls (also used for pool_cover). isShutterFamily
          covers both shutters and awnings — ShutterControl handles the
          vocabulary swap (extend/retract) when type === "awning". */}
      {(isShutterFamily || equipment.type === "pool_cover") && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <ShutterControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Pool pump controls — ON/OFF toggle via LightControl */}
      {equipment.type === "pool_pump" && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <LightControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Pool heat pump controls — water temp + setpoint slider */}
      {equipment.type === "pool_heat_pump" && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <PoolHeatPumpControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Thermostat controls */}
      {isThermostat && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <ThermostatCard
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Gate controls */}
      {isGate && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <GateControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Water valve controls */}
      {equipment.type === "water_valve" && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <WaterValveControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Heater controls */}
      {isHeater && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <HeaterControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Electric vehicle (spec 183): battery, range, state, wake, charge limit. */}
      {equipment.type === "electric_vehicle" && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <ElectricVehicleControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* EV charger (spec 182): start/stop, vehicle, power, session, current. */}
      {equipment.type === "ev_charger" && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <EvChargerControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* VMC speed controls (spec 153) */}
      {equipment.type === "vmc" && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <VmcControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Media player controls */}
      {equipment.type === "media_player" && equipment.enabled && (
        <MediaPlayerPanel
          equipment={equipment}
          onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
        />
      )}

      {/* Appliance status */}
      {equipment.type === "appliance" && <AppliancePanel equipment={equipment} />}

      {/* Sensor / Weather / Display data */}
      {equipment.type === "weather_forecast" ? (
        <WeatherForecastPanel bindings={equipment.dataBindings} />
      ) : equipment.type === "weather" ? (
        <WeatherPanel
          bindings={equipment.dataBindings}
          equipmentId={equipment.id}
          computedData={equipment.computedData}
        />
      ) : equipment.type === "display" ? (
        <DisplayPanel
          dataBindings={equipment.dataBindings}
          orderBindings={equipment.orderBindings}
          equipmentId={equipment.id}
          onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
        />
      ) : equipment.type === "camera" ? (
        <CameraPanel
          dataBindings={equipment.dataBindings}
          orderBindings={equipment.orderBindings}
          equipmentId={equipment.id}
          onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
        />
      ) : equipment.type === "ups" ? (
        <UpsPanel dataBindings={equipment.dataBindings} />
      ) : equipment.type === "solar_panel" ? (
        <SolarPanelDataPanel
          bindings={equipment.dataBindings}
          status={equipment.status}
          statusReason={equipment.statusReason}
        />
      ) : isSensor ? (
        <SensorDataPanel bindings={equipment.dataBindings} equipmentId={equipment.id} />
      ) : null}

      {/* Timed command — the ACTION, next to the ordinary controls above and
          available to every user (spec 174 phase 2). Its own card, labelled, so
          "actuate" and "actuate for fifteen minutes" are two named buttons
          rather than two icons to guess between. The admin panel further down
          configures it; this one fires it. */}
      {equipment.timedCommand && equipment.enabled && (
        <div className="card p-4 mb-6">
          <h3 className="text-body font-semibold text-text mb-3">{t("equipments.timed.title")}</h3>
          <TimedCommandControl equipment={equipment} labelled />
        </div>
      )}

      {/* Spec 191 — home charging of this vehicle: cost, split, per 100 km. */}
      {equipment.type === "electric_vehicle" && (
        <EvHomeChargingSection
          equipment={equipment}
          isAdmin={isAdmin}
          onUpdated={() => void fetchEquipments()}
        />
      )}

      {/* Spec 191 — the charge sessions of this charger and their vehicle. */}
      {equipment.type === "ev_charger" && (
        <EvChargerSessionsSection
          chargerId={equipment.id}
          usualVehicleId={equipment.usualVehicleId}
          isAdmin={isAdmin}
          onUpdated={() => void fetchEquipments()}
        />
      )}

      {/* History — the main series over 24 h, open on arrival (spec 196, pr9-graphique) */}
      <HistoryPanel
        key={equipment.id}
        equipmentId={equipment.id}
        bindings={historyBindings}
        defaultExpandedAlias={mainHistoryAlias(equipment.type, historyBindings)}
      />

      {/* PV forecast and health moved to Energy -> Production, their
          configuration to Settings -> Energy (spec 163). This page keeps what
          describes the meter as a device. */}

      {/* Energy — meters and metering relays (switch/water_heater, #521): the
          cumuls and the live electrical measures, one card (spec 196). The card
          hides itself when neither section has anything to show. A charger's
          control block already shows power, current and voltage (spec 182). */}
      {(equipment.type === "main_energy_meter" ||
        equipment.type === "energy_production_meter" ||
        isSubmeterEquipment(equipment)) && (
        <div className="card p-4 mb-6 hidden has-[[data-energy-section]]:block">
          <h3 className="text-body font-semibold text-text flex items-center gap-2 mb-3">
            <Zap size={16} strokeWidth={1.5} className="text-text-tertiary" />
            {t("equipments.energy")}
          </h3>
          <div className="space-y-4">
            {equipment.computedData && (
              <EnergyDataPanel
                section
                computedData={equipment.computedData}
                status={equipment.status}
                statusReason={equipment.statusReason}
                isProduction={equipment.type === "energy_production_meter"}
              />
            )}
            {equipment.type !== "ev_charger" && (
              <ElectricalMeteringPanel section equipment={equipment} />
            )}
          </div>
        </div>
      )}

      {/* Configuration — admin only. Spec 196 (pr9-config): every setting is a
          collapsed row here with a one-line summary, below what the page is used
          for; nothing configures above the chart any more. */}
      {isAdmin && (
        <div className="card mb-6 divide-y divide-border-light">
          <div className="flex items-center gap-2 p-4">
            <Settings size={16} strokeWidth={1.5} className="text-text-tertiary" />
            <h3 className="text-body font-semibold text-text">{t("equipments.configuration")}</h3>
          </div>

          {/* Gate — confirmation before action (spec 146) */}
          {isGate && (
            <GateConfirmationPanel equipment={equipment} onUpdated={() => void fetchEquipments()} />
          )}

          {/* Gate, door, shutter, awning — follow orders to their outcome (spec 188 O10) */}
          {ORDER_OUTCOME_TYPES.includes(equipment.type) && (
            <OrderOutcomePanel equipment={equipment} onUpdated={() => void fetchEquipments()} />
          )}

          {/* Gate — shared access (spec 181 R8), hidden while the feature is off */}
          {isGate && <SharedAccessPanel equipmentId={equipment.id} />}

          {/* Timed command — act now, revert after N (spec 174 phase 2). Offered
            only where a hand-revert could end the window early: the equipment
            must carry the order AND a state reading tied to it. */}
          {hasTimedCommandCandidate(equipment) && (
            <TimedCommandPanel equipment={equipment} onUpdated={() => void fetchEquipments()} />
          )}

          {/* Shutter-family / gate — invert command direction (spec 154, extended
            to boolean gate triggers per issue #627) */}
          {(isShutterFamily || equipment.type === "pool_cover" || isGate) && (
            <InvertDirectionPanel equipment={equipment} onUpdated={() => void fetchEquipments()} />
          )}

          {/* A plug or relay — the family it belongs to (spec 208) */}
          {equipment.type === "switch" && (
            <FamilyPanel equipment={equipment} onUpdated={() => void fetchEquipments()} />
          )}

          {/* Nested submeters — "already counted by that meter" (spec 173) */}
          {isSubmeterEquipment(equipment) && (
            <MeteringParentPanel
              equipment={equipment}
              equipments={equipments}
              onUpdated={() => void fetchEquipments()}
            />
          )}

          {/* Energy management — flexible-load declaration (spec 140). A vehicle is
            never a flexible load, the charger is (spec 183); a type with no
            energy semantics renders nothing (spec 196). */}
          {equipment.orderBindings.length > 0 && equipment.type !== "electric_vehicle" && (
            <EnergyManagementPanel equipment={equipment} onUpdated={() => void fetchEquipments()} />
          )}

          {/* Button actions */}
          {equipment.type === "button" && <ButtonActionsSection equipmentId={equipment.id} />}

          <DevicesSection equipment={equipment} onChangeDevice={() => setShowChangeDevice(true)} />

          {historyBindings.length > 0 && (
            <HistorySection
              equipmentId={equipment.id}
              bindings={historyBindings}
              onBindingsChanged={loadHistoryBindings}
            />
          )}

          {/* Bindings */}
          <div>
            <button
              type="button"
              onClick={() => setShowBindings(!showBindings)}
              className="flex items-center gap-2 w-full p-4 text-left cursor-pointer"
            >
              {showBindings ? (
                <ChevronDown size={14} strokeWidth={1.5} className="text-text-tertiary" />
              ) : (
                <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary" />
              )}
              <Link2 size={14} strokeWidth={1.5} className="text-text-tertiary" />
              <span className="text-small font-medium text-text-secondary">
                {t("equipments.bindings")}
              </span>
              <span className="text-micro text-text-tertiary">
                {t("equipments.bindingCount", {
                  count: equipment.dataBindings.length + equipment.orderBindings.length,
                })}
              </span>
            </button>

            {showBindings && (
              <div className="px-4 pb-4 space-y-4">
                {/* Issue #707 — a plugin can start publishing data points long
                  after the equipment was bound, and nothing revisits the
                  bindings on its own. Rebuilding through the device selector
                  would wipe custom aliases and historization, so this offers
                  the missing ones additively. */}
                {missingBindingCount !== null && missingBindingCount > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-sm bg-primary-light border border-primary/20">
                    <Sparkles size={14} strokeWidth={1.5} className="text-primary flex-shrink-0" />
                    <span className="flex-1 text-caption text-text-secondary">
                      {t("binding.missingAvailable", { count: missingBindingCount })}
                    </span>
                    <button
                      onClick={() => setShowMissingBindings(true)}
                      className="px-2 py-1 text-micro font-medium text-white bg-primary-fill hover:bg-primary-fill-hover rounded-sm transition-colors duration-150 flex-shrink-0"
                    >
                      {t("binding.missingReview")}
                    </button>
                  </div>
                )}

                {/* Data Bindings */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-caption font-medium text-text-tertiary flex items-center gap-1.5">
                      <Link2 size={13} strokeWidth={1.5} />
                      {t("equipments.dataBindings")}
                    </h4>
                    <button
                      onClick={() => setShowAddDataBinding(true)}
                      className="flex items-center gap-1 px-2 py-1 text-micro font-medium text-primary border border-primary/30 rounded-sm hover:bg-primary-light transition-colors duration-150"
                    >
                      <Plus size={11} strokeWidth={1.5} />
                      {t("common.add")}
                    </button>
                  </div>
                  {equipment.dataBindings.length === 0 ? (
                    <p className="text-caption text-text-tertiary">{t("common.none")}</p>
                  ) : (
                    <div className="space-y-1">
                      {equipment.dataBindings.map((binding) => (
                        <div
                          key={binding.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-border-light/50 text-caption group"
                        >
                          <span className="font-mono font-medium text-primary">
                            {binding.alias}
                          </span>
                          <span className="text-text-tertiary">({binding.category})</span>
                          <span className="text-text-tertiary">
                            · {binding.deviceName} · {binding.key}
                          </span>
                          <span className="ml-auto tabular-nums text-text">
                            {binding.value !== null && binding.value !== undefined
                              ? String(binding.value)
                              : "—"}
                            {binding.unit && (
                              <span className="text-text-tertiary ml-0.5">{binding.unit}</span>
                            )}
                          </span>
                          <button
                            onClick={() => removeDataBinding(equipment.id, binding.id)}
                            className="p-1 text-text-tertiary hover:text-error rounded-sm hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t("common.remove")}
                          >
                            <Unlink size={11} strokeWidth={1.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Computed Data (e.g. energy cumuls) */}
                {equipment.computedData && equipment.computedData.length > 0 && (
                  <div>
                    <h4 className="text-caption font-medium text-text-tertiary flex items-center gap-1.5 mb-2">
                      <Activity size={13} strokeWidth={1.5} />
                      {t("equipments.computedData", "Computed Data")}
                    </h4>
                    <div className="space-y-1">
                      {equipment.computedData.map((cd) => (
                        <div
                          key={cd.alias}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-border-light border border-border text-caption"
                        >
                          <span className="font-mono font-medium text-text-secondary">
                            {cd.alias}
                          </span>
                          {cd.category && (
                            <span className="text-text-tertiary">({cd.category})</span>
                          )}
                          <span className="ml-auto tabular-nums text-text">
                            {cd.value !== null && cd.value !== undefined
                              ? typeof cd.value === "number"
                                ? formatNumber(cd.value, { maxDecimals: 1 })
                                : String(cd.value)
                              : "—"}
                            {cd.unit && (
                              <span className="text-text-tertiary ml-0.5">{cd.unit}</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Order Bindings */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-caption font-medium text-text-tertiary flex items-center gap-1.5">
                      <Zap size={13} strokeWidth={1.5} />
                      {t("equipments.orderBindings")}
                    </h4>
                    <button
                      onClick={() => setShowAddOrderBinding(true)}
                      className="flex items-center gap-1 px-2 py-1 text-micro font-medium text-primary border border-primary/30 rounded-sm hover:bg-primary-light transition-colors duration-150"
                    >
                      <Plus size={11} strokeWidth={1.5} />
                      {t("common.add")}
                    </button>
                  </div>
                  {equipment.orderBindings.length === 0 ? (
                    <p className="text-caption text-text-tertiary">{t("common.none")}</p>
                  ) : (
                    <div className="space-y-1">
                      {equipment.orderBindings.map((binding) => (
                        <div
                          key={binding.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-border-light/50 text-caption group"
                        >
                          <span className="font-mono font-medium text-text-secondary">
                            {binding.alias}
                          </span>
                          <span className="text-text-tertiary">({binding.type})</span>
                          <span className="text-text-tertiary">
                            · {binding.deviceName} · {binding.key}
                          </span>
                          <button
                            onClick={() => removeOrderBinding(equipment.id, binding.id)}
                            className="ml-auto p-1 text-text-tertiary hover:text-error rounded-sm hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t("common.remove")}
                          >
                            <Unlink size={11} strokeWidth={1.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Spec 196 — delete left the header, where it sat next to « Modifier ». */}
          <div className="p-4">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 text-small font-medium text-error hover:underline disabled:opacity-50 cursor-pointer"
            >
              <Trash2 size={14} strokeWidth={1.5} />
              {deleting ? t("common.deleting") : t("equipments.deleteEquipment")}
            </button>
          </div>
        </div>
      )}

      {/* Edit equipment modal */}
      {showEditForm && (
        <EquipmentForm
          title={t("equipments.editEquipment")}
          initial={{
            name: equipment.name,
            type: equipment.type,
            zoneId: equipment.zoneId,
          }}
          zones={tree}
          onSubmit={async (data) => {
            await updateEquipment(equipment.id, {
              name: data.name,
              type: data.type,
              zoneId: data.zoneId,
            });
          }}
          onClose={() => setShowEditForm(false)}
        />
      )}

      {/* Missing bindings modal (issue #707) */}
      {showMissingBindings && equipment && (
        <MissingBindingsModal
          equipmentId={equipment.id}
          equipmentType={equipment.type}
          dataBindings={equipment.dataBindings}
          orderBindings={equipment.orderBindings}
          onClose={() => setShowMissingBindings(false)}
          onAdded={() => {
            setShowMissingBindings(false);
            setMissingBindingCount(null);
            void fetchEquipments();
          }}
        />
      )}

      {/* Add data binding modal */}
      {showAddDataBinding && (
        <AddBindingModal
          mode="data"
          existingAliases={equipment.dataBindings.map((b) => b.alias)}
          equipmentType={equipment.type}
          onAdd={async ({ id: deviceDataId, alias }) => {
            await addDataBinding(equipment.id, deviceDataId, alias);
          }}
          onClose={() => setShowAddDataBinding(false)}
        />
      )}

      {/* Add order binding modal */}
      {showAddOrderBinding && (
        <AddBindingModal
          mode="order"
          existingAliases={equipment.orderBindings.map((b) => b.alias)}
          equipmentType={equipment.type}
          onAdd={async ({ id: deviceOrderId, alias }) => {
            await addOrderBinding(equipment.id, deviceOrderId, alias);
          }}
          onClose={() => setShowAddOrderBinding(false)}
        />
      )}

      {/* Change device modal */}
      {showChangeDevice && (
        <ChangeDeviceModal
          equipment={equipment}
          onDone={() => {
            setShowChangeDevice(false);
            fetchEquipments();
          }}
          onClose={() => setShowChangeDevice(false)}
        />
      )}
    </div>
  );
}

/**
 * Back from the equipment page (spec 196, pr9-retour): to the page it was
 * opened from when the link said so, else to the equipment's room — a page of
 * usage, which a room is and the equipment list is not.
 */
function BackLink({
  origin,
  room,
}: {
  origin: EquipmentOrigin | null;
  room: { id: string; name: string } | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cls =
    "inline-flex items-center gap-1.5 text-small text-text-secondary hover:text-text mb-4";
  if (origin) {
    return (
      <button type="button" onClick={() => navigate(-1)} className={`${cls} cursor-pointer`}>
        <ArrowLeft size={14} strokeWidth={1.5} />
        {origin.to === "/equipments"
          ? t("equipments.backToEquipments")
          : t("equipments.backToZone", { name: origin.label })}
      </button>
    );
  }
  return (
    <Link to={room ? `/home/${room.id}` : "/home"} className={cls}>
      <ArrowLeft size={14} strokeWidth={1.5} />
      {t("equipments.backToZone", { name: room ? room.name : t("nav.maison") })}
    </Link>
  );
}

// ============================================================
// History section (per-binding ON/OFF toggles)
// ============================================================

function HistorySection({
  equipmentId,
  bindings,
  onBindingsChanged,
}: {
  equipmentId: string;
  bindings: HistoryBindingState[];
  onBindingsChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleToggle = async (binding: HistoryBindingState) => {
    let next: number | null;
    if (binding.historize === null) {
      next = binding.effectiveOn ? 0 : 1;
    } else if (binding.historize === 1) {
      next = 0;
    } else {
      next = null;
    }
    await setHistorize(equipmentId, binding.bindingId, next);
    onBindingsChanged();
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full p-4 text-left cursor-pointer"
      >
        {open ? (
          <ChevronDown size={14} strokeWidth={1.5} className="text-text-tertiary" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary" />
        )}
        <Database size={14} strokeWidth={1.5} className="text-text-tertiary" />
        <span className="text-small font-medium text-text-secondary">{t("history.title")}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <div className="space-y-1">
            {bindings.map((b) => (
              <div
                key={b.bindingId}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-sm bg-border-light/50 text-caption"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-primary">{b.alias}</span>
                  <span className="text-text-tertiary">({b.category})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-micro text-text-tertiary">
                    {b.historize === null
                      ? `(${t("history.default")})`
                      : `(${t("history.override")})`}
                  </span>
                  <button
                    onClick={() => handleToggle(b)}
                    className={`px-2 py-0.5 rounded-sm text-micro font-medium cursor-pointer transition-colors ${
                      b.effectiveOn
                        ? "bg-success/10 text-success hover:bg-success/20"
                        : "bg-border-light text-text-tertiary hover:bg-border"
                    }`}
                  >
                    {b.effectiveOn ? t("history.on") : t("history.off")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Collapsible devices sub-section inside the Configuration card. */
function DevicesSection({
  equipment,
  onChangeDevice,
}: {
  equipment: EquipmentWithDetails;
  onChangeDevice: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const devicesStore = useDevices((s) => s.devices);

  const deviceMap = new Map<
    string,
    { deviceId: string; deviceName: string; dataKeys: string[]; orderKeys: string[] }
  >();
  for (const db of equipment.dataBindings) {
    let entry = deviceMap.get(db.deviceId);
    if (!entry) {
      entry = { deviceId: db.deviceId, deviceName: db.deviceName, dataKeys: [], orderKeys: [] };
      deviceMap.set(db.deviceId, entry);
    }
    entry.dataKeys.push(db.alias);
  }
  for (const ob of equipment.orderBindings) {
    let entry = deviceMap.get(ob.deviceId);
    if (!entry) {
      entry = { deviceId: ob.deviceId, deviceName: ob.deviceName, dataKeys: [], orderKeys: [] };
      deviceMap.set(ob.deviceId, entry);
    }
    entry.orderKeys.push(ob.alias);
  }
  const devices = [...deviceMap.values()];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full p-4 text-left cursor-pointer"
      >
        {open ? (
          <ChevronDown size={14} strokeWidth={1.5} className="text-text-tertiary" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary" />
        )}
        <Cpu size={14} strokeWidth={1.5} className="text-text-tertiary" />
        <span className="text-small font-medium text-text-secondary">
          {t("equipments.devices")}
        </span>
        <span className="text-micro text-text-tertiary">{devices.length}</span>
        {open && (
          <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onChangeDevice}
              className="flex items-center gap-1 px-2 py-1 text-micro font-medium text-primary border border-primary/30 rounded-sm hover:bg-primary-light transition-colors duration-150"
            >
              {devices.length > 0 ? (
                <>
                  <RefreshCw size={11} strokeWidth={1.5} /> {t("equipments.changeDevice")}
                </>
              ) : (
                <>
                  <Plus size={11} strokeWidth={1.5} /> {t("common.add")}
                </>
              )}
            </button>
          </div>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {devices.length === 0 ? (
            <p className="text-small text-text-tertiary">{t("equipments.noDevice")}</p>
          ) : (
            <div className="space-y-2">
              {devices.map((dev) => {
                const storeDevice = devicesStore[dev.deviceId];
                const lastSeen = storeDevice?.lastSeen ?? null;
                return (
                  <div
                    key={dev.deviceId}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-sm bg-border-light/50"
                  >
                    <Cpu size={14} strokeWidth={1.5} className="text-text-tertiary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-small font-medium text-text">{dev.deviceName}</div>
                      <div className="flex items-center gap-1 text-micro text-text-tertiary mt-0.5">
                        <Clock size={10} strokeWidth={1.5} />
                        <span>
                          <RelativeTime iso={lastSeen} />
                        </span>
                      </div>
                    </div>
                    <span className="text-micro text-text-tertiary flex-shrink-0">
                      {dev.dataKeys.length > 0 &&
                        t("equipments.dataCount", { count: dev.dataKeys.length })}
                      {dev.dataKeys.length > 0 && dev.orderKeys.length > 0 && " · "}
                      {dev.orderKeys.length > 0 &&
                        t("equipments.orderCount", { count: dev.orderKeys.length })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Modal to select new devices and replace all bindings. */
function ChangeDeviceModal({
  equipment,
  onDone,
  onClose,
}: {
  equipment: EquipmentWithDetails;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [candidateByDevice, setCandidateByDevice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (selectedDeviceIds.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Remove all existing bindings
      await removeAllBindings(equipment.id, equipment.dataBindings, equipment.orderBindings);
      // Create new bindings from selected devices
      await autoCreateBindings(equipment.id, selectedDeviceIds, equipment.type, candidateByDevice);
      onDone();
    } catch (err) {
      setError(apiErrorText(err, t));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg w-full max-w-[520px] mx-4 max-h-[90vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light flex-shrink-0">
          <h2 className="text-lead font-semibold text-text">{t("equipments.changeDevice")}</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-small text-text-secondary mb-4">
            {t("equipments.changeDeviceDescription")}
          </p>
          <DeviceSelector
            equipmentType={equipment.type}
            selectedDeviceIds={selectedDeviceIds}
            onSelectionChange={setSelectedDeviceIds}
            onCandidateChange={setCandidateByDevice}
          />
          {error && <p className="text-small text-error mt-3">{error}</p>}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border-light flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-small font-medium text-text-secondary hover:text-text border border-border rounded-sm hover:bg-border-light transition-colors duration-150"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedDeviceIds.length === 0 || saving}
            className="px-4 py-2 text-small font-medium text-white bg-primary-fill rounded-sm hover:bg-primary-fill-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
