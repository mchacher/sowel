import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";
import { parseDuration, formatDuration } from "./engine/duration.js";

// ============================================================
// Presence-Heater Recipe
// ============================================================

export class PresenceHeaterRecipe extends Recipe {
  readonly id = "presence-heater";
  readonly name = "Presence Heater";
  readonly description =
    "Switches electric heaters to comfort on motion, eco after absence timeout. Fil pilote convention: relay OFF = comfort, relay ON = eco.";
  readonly slots: RecipeSlotDef[] = [
    {
      id: "zone",
      name: "Zone",
      description: "Zone to monitor for presence",
      type: "zone",
      required: true,
    },
    {
      id: "heaters",
      name: "Heaters",
      description: "Electric heater equipments (relay-controlled)",
      type: "equipment",
      required: true,
      list: true,
      constraints: { equipmentType: "heater" },
    },
    {
      id: "timeout",
      name: "Timeout",
      description: "Delay with no motion before switching to eco",
      type: "duration",
      required: true,
      defaultValue: "30m",
    },
    {
      id: "nightStart",
      name: "Night Start",
      description: "Start of forced eco window (HH:MM)",
      type: "time",
      required: false,
      group: "night",
    },
    {
      id: "nightEnd",
      name: "Night End",
      description: "End of forced eco window (HH:MM)",
      type: "time",
      required: false,
      group: "night",
    },
    {
      id: "maxOnDuration",
      name: "Max Comfort Duration",
      description: "Force eco after this duration even with continued motion (safety)",
      type: "duration",
      required: false,
    },
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Chauffage présence",
      description:
        "Passe les radiateurs électriques en confort sur mouvement, éco après un délai sans présence. Convention fil pilote : relais OFF = confort, relais ON = éco.",
      slots: {
        zone: { name: "Zone", description: "Zone à surveiller" },
        heaters: {
          name: "Radiateurs",
          description: "Radiateurs électriques (contrôlés par relais)",
        },
        timeout: { name: "Délai", description: "Délai sans mouvement avant passage en éco" },
        nightStart: {
          name: "Début nuit",
          description: "Début de la plage éco forcé (HH:MM)",
        },
        nightEnd: {
          name: "Fin nuit",
          description: "Fin de la plage éco forcé (HH:MM)",
        },
        maxOnDuration: {
          name: "Durée max confort",
          description: "Forcer éco après cette durée même si mouvement continu (sécurité)",
        },
      },
      groups: {
        night: "Nuit",
      },
    },
    en: {
      name: "Presence Heater",
      description:
        "Switches electric heaters to comfort on motion, eco after absence timeout. Fil pilote: relay OFF = comfort, relay ON = eco.",
      groups: {
        night: "Night",
      },
    },
  };

  // ── Instance fields ──────────────────────────────────────
  private ctx!: RecipeContext;
  private zoneId!: string;
  private heaterIds!: string[];
  private timeoutMs!: number;
  private nightStart: string | null = null;
  private nightEnd: string | null = null;
  private maxOnDurationMs: number | null = null;

  // Runtime state
  private currentMode: "comfort" | "eco" = "eco";
  private overrideMode = false;
  private ecoTimer: ReturnType<typeof setTimeout> | null = null;
  private failsafeTimer: ReturnType<typeof setTimeout> | null = null;
  private nightCheckTimer: ReturnType<typeof setInterval> | null = null;
  private stateGraceUntil = 0;
  private unsubs: (() => void)[] = [];

  // ── Validation ───────────────────────────────────────────

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    const { zone, timeout, maxOnDuration } = params;

    // Validate zone
    if (!zone || typeof zone !== "string") {
      throw new Error("Zone parameter is required");
    }
    const zoneObj = ctx.zoneManager.getById(zone);
    if (!zoneObj) {
      throw new Error(`Zone not found: ${zone}`);
    }
    const zoneData = ctx.zoneAggregator.getByZoneId(zone);
    if (zoneData && zoneData.motionSensors === 0) {
      ctx.log("Zone has no motion sensors — recipe will only work with night window", "warn");
    }

    // Validate heaters
    const heaterIds = this.normalizeStringArray(params.heaters);
    if (heaterIds.length === 0) {
      throw new Error("At least one heater is required");
    }
    for (const heaterId of heaterIds) {
      const equipment = ctx.equipmentManager.getByIdWithDetails(heaterId);
      if (!equipment) {
        throw new Error(`Heater equipment not found: ${heaterId}`);
      }
      if (equipment.type !== "heater") {
        throw new Error(`Equipment "${equipment.name}" is not a heater`);
      }
      const hasStateOrder = equipment.orderBindings.some((ob) => ob.alias === "state");
      if (!hasStateOrder) {
        throw new Error(`Heater "${equipment.name}" has no "state" order binding`);
      }
    }

    // Validate timeout
    parseDuration(timeout ?? "30m");

    // Validate night window
    const { nightStart: ns, nightEnd: ne } = params;
    const hasNightStart = ns !== undefined && ns !== null && ns !== "";
    const hasNightEnd = ne !== undefined && ne !== null && ne !== "";
    if (hasNightStart !== hasNightEnd) {
      throw new Error("nightStart and nightEnd must both be provided or both omitted");
    }
    if (hasNightStart && typeof ns === "string" && !/^\d{2}:\d{2}$/.test(ns)) {
      throw new Error("nightStart must be in HH:MM format");
    }
    if (hasNightEnd && typeof ne === "string" && !/^\d{2}:\d{2}$/.test(ne)) {
      throw new Error("nightEnd must be in HH:MM format");
    }

    // Validate maxOnDuration
    if (maxOnDuration !== undefined && maxOnDuration !== null && maxOnDuration !== "") {
      parseDuration(maxOnDuration);
    }
  }

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((id): id is string => typeof id === "string");
    }
    return [];
  }

  // ── Start ────────────────────────────────────────────────

  start(params: Record<string, unknown>, ctx: RecipeContext): void {
    this.ctx = ctx;
    this.zoneId = params.zone as string;
    this.heaterIds = this.normalizeStringArray(params.heaters);
    this.timeoutMs = parseDuration(params.timeout ?? "30m");

    // Night window
    this.nightStart =
      typeof params.nightStart === "string" && params.nightStart ? params.nightStart : null;
    this.nightEnd = typeof params.nightEnd === "string" && params.nightEnd ? params.nightEnd : null;

    // Max on duration
    this.maxOnDurationMs =
      params.maxOnDuration !== undefined &&
      params.maxOnDuration !== null &&
      params.maxOnDuration !== ""
        ? parseDuration(params.maxOnDuration)
        : null;

    // Reset runtime state
    this.currentMode = "eco";
    this.overrideMode = false;
    this.stateGraceUntil = 0;
    ctx.state.delete("overrideMode");
    ctx.notifyStateChanged();

    // Subscribe to zone changes (motion)
    const unsubZone = ctx.eventBus.onType("zone.data.changed", (event) => {
      if (event.zoneId !== this.zoneId) return;
      this.onZoneChanged(event.aggregatedData.motion);
    });
    this.unsubs.push(unsubZone);

    // Subscribe to heater state changes (manual override detection)
    const unsubState = ctx.eventBus.onType("equipment.data.changed", (event) => {
      if (!this.heaterIds.includes(event.equipmentId)) return;
      if (event.alias !== "state") return;
      this.onHeaterStateChanged(event.value);
    });
    this.unsubs.push(unsubState);

    // Night check timer (every 60s)
    if (this.hasNightConfig()) {
      this.nightCheckTimer = setInterval(() => {
        this.checkNightTransition();
      }, 60_000);
    }

    // Sync on start
    this.syncOnStart();
  }

  // ── Stop ─────────────────────────────────────────────────

  stop(): void {
    this.cancelEcoTimer();
    this.cancelFailsafeTimer();
    if (this.nightCheckTimer) {
      clearInterval(this.nightCheckTimer);
      this.nightCheckTimer = null;
    }
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.overrideMode = false;
    this.stateGraceUntil = 0;
    this.ctx.state.delete("overrideMode");
    this.ctx.state.delete("timerExpiresAt");
    this.ctx.state.delete("failsafeExpiresAt");
    this.ctx.state.delete("currentMode");
    this.ctx.notifyStateChanged();
  }

  // ── Initial sync ─────────────────────────────────────────

  private syncOnStart(): void {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    const motion = zoneData?.motion ?? false;

    if (this.isInNightWindow()) {
      this.setEco("Recipe activated — night window active");
    } else if (motion) {
      this.setComfort("Recipe activated — motion detected");
    } else {
      this.setEco("Recipe activated — no motion");
    }
  }

  // ── Event handlers ───────────────────────────────────────

  private onZoneChanged(motion: boolean): void {
    // Override mode: recipe is suspended, only track room vacancy
    if (this.overrideMode) {
      if (motion) {
        this.cancelEcoTimer();
        this.clearTimerState();
      } else {
        this.startEcoTimerForOverrideClear();
      }
      return;
    }

    // Night window: force eco regardless of motion
    if (this.isInNightWindow()) {
      if (this.currentMode === "comfort") {
        this.cancelEcoTimer();
        this.clearTimerState();
        this.cancelFailsafeTimer();
        this.setEco("Night window — forced eco");
      }
      return;
    }

    if (motion) {
      this.cancelEcoTimer();
      this.clearTimerState();
      if (this.currentMode === "eco") {
        this.setComfort("Motion detected");
      }
    } else {
      if (this.currentMode === "comfort") {
        this.startEcoTimer();
      }
    }
  }

  private onHeaterStateChanged(value: unknown): void {
    if (this.overrideMode) return;
    if (Date.now() < this.stateGraceUntil) return;

    // Detect if the state change was unexpected (manual override)
    const isComfortState = this.isComfortState(value);
    if (
      (this.currentMode === "comfort" && !isComfortState) ||
      (this.currentMode === "eco" && isComfortState)
    ) {
      this.overrideMode = true;
      this.ctx.state.set("overrideMode", true);
      this.ctx.notifyStateChanged();
      this.ctx.log("Manual relay change detected — entering override mode");
    }
  }

  // ── Night window ─────────────────────────────────────────

  private hasNightConfig(): boolean {
    return this.nightStart !== null && this.nightEnd !== null;
  }

  private isInNightWindow(): boolean {
    if (!this.hasNightConfig()) return false;
    return isInTimeWindow(new Date(), this.nightStart!, this.nightEnd!);
  }

  private checkNightTransition(): void {
    if (this.overrideMode) return;

    const inNight = this.isInNightWindow();

    // Entering night window → force eco
    if (inNight && this.currentMode === "comfort") {
      this.cancelEcoTimer();
      this.clearTimerState();
      this.cancelFailsafeTimer();
      this.setEco("Night window started — forced eco");
    }

    // Leaving night window → resume based on motion
    if (!inNight && this.currentMode === "eco") {
      if (this.hasMotion()) {
        this.setComfort("Night window ended — motion present");
      }
    }
  }

  // ── Relay state helpers ──────────────────────────────────

  // Fil pilote: relay OFF = comfort, relay ON = eco
  private isComfortState(value: unknown): boolean {
    const isOn = value === true || String(value).toUpperCase() === "ON";
    return !isOn; // comfort = relay OFF
  }

  private resolveEnumValue(heaterId: string, target: "on" | "off"): string {
    const equipment = this.ctx.equipmentManager.getByIdWithDetails(heaterId);
    const stateOrder = equipment?.orderBindings.find((ob) => ob.alias === "state");
    const match = stateOrder?.enumValues?.find((v) => v.toLowerCase() === target);
    return match ?? target.toUpperCase();
  }

  // ── Motion helper ────────────────────────────────────────

  private hasMotion(): boolean {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    return zoneData?.motion ?? false;
  }

  // ── Actions ──────────────────────────────────────────────

  // Fil pilote: comfort = relay OFF
  private setComfort(reason: string): void {
    this.stateGraceUntil = Date.now() + 5000;
    const comfortValue = "off" as const;
    for (const heaterId of this.heaterIds) {
      try {
        this.ctx.equipmentManager.executeOrder(
          heaterId,
          "state",
          this.resolveEnumValue(heaterId, comfortValue),
        );
      } catch (err) {
        this.ctx.log(`Error setting heater to comfort: ${String(err)}`, "error");
      }
    }
    this.currentMode = "comfort";
    this.ctx.state.set("currentMode", "comfort");
    this.ctx.notifyStateChanged();
    this.ctx.log(`${reason} — heaters set to comfort`);
    this.startFailsafeTimer();
  }

  // Fil pilote: eco = relay ON
  private setEco(reason: string): void {
    this.stateGraceUntil = Date.now() + 5000;
    const ecoValue = "on" as const;
    for (const heaterId of this.heaterIds) {
      try {
        this.ctx.equipmentManager.executeOrder(
          heaterId,
          "state",
          this.resolveEnumValue(heaterId, ecoValue),
        );
      } catch (err) {
        this.ctx.log(`Error setting heater to eco: ${String(err)}`, "error");
      }
    }
    this.currentMode = "eco";
    this.clearOverrideMode();
    this.cancelFailsafeTimer();
    this.ctx.state.set("currentMode", "eco");
    this.ctx.notifyStateChanged();
    this.ctx.log(`${reason} — heaters set to eco`);
  }

  // ── Override management ──────────────────────────────────

  private clearOverrideMode(): void {
    if (!this.overrideMode) return;
    this.overrideMode = false;
    this.ctx.state.delete("overrideMode");
    this.ctx.notifyStateChanged();
  }

  private startEcoTimerForOverrideClear(): void {
    this.cancelEcoTimer();
    this.ecoTimer = setTimeout(() => {
      this.ecoTimer = null;
      this.clearTimerState();
      this.setEco(`No motion for ${formatDuration(this.timeoutMs)} — override cleared`);
    }, this.timeoutMs);
    this.persistTimerState();
  }

  // ── Eco timer management ─────────────────────────────────

  private startEcoTimer(): void {
    this.cancelEcoTimer();
    this.ecoTimer = setTimeout(() => {
      this.ecoTimer = null;
      this.clearTimerState();
      this.setEco(`No motion for ${formatDuration(this.timeoutMs)}`);
    }, this.timeoutMs);
    this.persistTimerState();
  }

  private cancelEcoTimer(): void {
    if (this.ecoTimer) {
      clearTimeout(this.ecoTimer);
      this.ecoTimer = null;
    }
  }

  private persistTimerState(): void {
    const expiresAt = new Date(Date.now() + this.timeoutMs).toISOString();
    this.ctx.state.set("timerExpiresAt", expiresAt);
    this.ctx.notifyStateChanged();
  }

  private clearTimerState(): void {
    this.ctx.state.delete("timerExpiresAt");
    this.ctx.notifyStateChanged();
  }

  // ── Failsafe timer management ────────────────────────────

  private startFailsafeTimer(): void {
    if (this.maxOnDurationMs === null) return;
    this.cancelFailsafeTimer();
    this.failsafeTimer = setTimeout(() => {
      this.failsafeTimer = null;
      this.ctx.state.delete("failsafeExpiresAt");
      this.cancelEcoTimer();
      this.clearTimerState();
      this.setEco(
        `Failsafe: forced eco after ${formatDuration(this.maxOnDurationMs!)} max comfort duration`,
      );
    }, this.maxOnDurationMs);
    const expiresAt = new Date(Date.now() + this.maxOnDurationMs).toISOString();
    this.ctx.state.set("failsafeExpiresAt", expiresAt);
    this.ctx.notifyStateChanged();
  }

  private cancelFailsafeTimer(): void {
    if (this.failsafeTimer) {
      clearTimeout(this.failsafeTimer);
      this.failsafeTimer = null;
      this.ctx.state.delete("failsafeExpiresAt");
      this.ctx.notifyStateChanged();
    }
  }
}

// ── Time window helper ──────────────────────────────────────

function isInTimeWindow(now: Date, startTime: string, endTime: string): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same-day range (e.g., 06:00 to 08:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Overnight range (e.g., 22:00 to 06:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}
