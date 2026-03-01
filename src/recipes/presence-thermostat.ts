import type { RecipeSlotDef, RecipeActionDef, RecipeLangPack } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";
import { parseDuration, formatDuration } from "./engine/duration.js";

// ============================================================
// Presence-Thermostat Recipe
// ============================================================

export class PresenceThermostatRecipe extends Recipe {
  readonly id = "presence-thermostat";
  readonly name = "Presence Thermostat";
  readonly description =
    "Adjusts thermostat setpoint based on zone presence. Sends comfort temperature when motion is detected, switches to eco after a timeout with no motion. Supports night setpoint, weekday/weekend preheat windows, cocoon mode (button-triggered boost), and manual override detection.";
  readonly slots: RecipeSlotDef[] = [
    {
      id: "zone",
      name: "Zone",
      description: "Zone to monitor for presence",
      type: "zone",
      required: true,
    },
    {
      id: "thermostat",
      name: "Thermostat",
      description: "Thermostat equipment (must have a 'setpoint' order binding)",
      type: "equipment",
      required: true,
      constraints: { equipmentType: "thermostat" },
    },
    {
      id: "comfortTemp",
      name: "Comfort Temperature",
      description: "Setpoint when presence is detected (°C)",
      type: "number",
      required: true,
    },
    {
      id: "ecoTemp",
      name: "Eco Temperature",
      description: "Setpoint after absence timeout (°C)",
      type: "number",
      required: true,
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
      id: "nightTemp",
      name: "Night Temperature",
      description: "Setpoint during the night window (°C, optional)",
      type: "number",
      required: false,
      group: "night",
    },
    {
      id: "nightStart",
      name: "Night Start",
      description: "Start of night window (HH:MM)",
      type: "time",
      required: false,
      group: "night",
    },
    {
      id: "nightEnd",
      name: "Night End",
      description: "End of night window (HH:MM)",
      type: "time",
      required: false,
      group: "night",
    },
    {
      id: "preheatStart",
      name: "Preheat Start (Weekday)",
      description: "Start of weekday preheat window (HH:MM, Mon-Fri)",
      type: "time",
      required: false,
      group: "preheat",
    },
    {
      id: "preheatEnd",
      name: "Preheat End (Weekday)",
      description: "End of weekday preheat window (HH:MM, Mon-Fri)",
      type: "time",
      required: false,
      group: "preheat",
    },
    {
      id: "weekendPreheatStart",
      name: "Preheat Start (Weekend)",
      description: "Start of weekend preheat window (HH:MM, Sat-Sun)",
      type: "time",
      required: false,
      group: "preheat",
    },
    {
      id: "weekendPreheatEnd",
      name: "Preheat End (Weekend)",
      description: "End of weekend preheat window (HH:MM, Sat-Sun)",
      type: "time",
      required: false,
      group: "preheat",
    },
    {
      id: "buttons",
      name: "Cocoon Buttons",
      description: "Button equipments that toggle cocoon mode (optional)",
      type: "equipment",
      required: false,
      list: true,
      constraints: { equipmentType: "button" },
      group: "cocoon",
    },
    {
      id: "cocoonTemp",
      name: "Cocoon Temperature",
      description: "Boosted setpoint when cocoon is activated by button (°C)",
      type: "number",
      required: false,
      group: "cocoon",
    },
  ];

  override readonly actions: RecipeActionDef[] = [
    {
      id: "set_mode",
      type: "cycle",
      stateKey: "currentMode",
      options: [
        { value: "eco", label: "Eco" },
        { value: "comfort", label: "Comfort" },
        { value: "cocoon", label: "Cocoon" },
      ],
    },
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Thermostat présence",
      description:
        "Ajuste la consigne du thermostat en fonction de la présence dans la zone. Envoie la température confort quand un mouvement est détecté, passe en éco après un délai sans mouvement. Supporte une consigne nuit, des plages de préchauffe semaine/week-end, un mode cocoon (boost par bouton), et la détection de changement manuel.",
      slots: {
        zone: { name: "Zone", description: "Zone à surveiller" },
        thermostat: {
          name: "Thermostat",
          description: "Équipement thermostat (doit avoir un binding d'ordre 'setpoint')",
        },
        comfortTemp: {
          name: "Température confort",
          description: "Consigne quand il y a de la présence (°C)",
        },
        ecoTemp: {
          name: "Température éco",
          description: "Consigne après le délai d'absence (°C)",
        },
        timeout: { name: "Délai", description: "Délai sans mouvement avant passage en éco" },
        nightTemp: {
          name: "Température nuit",
          description: "Consigne pendant la plage nocturne (°C, optionnel)",
        },
        nightStart: { name: "Début nuit", description: "Début de la plage nocturne (HH:MM)" },
        nightEnd: { name: "Fin nuit", description: "Fin de la plage nocturne (HH:MM)" },
        preheatStart: {
          name: "Début préchauffe (semaine)",
          description: "Début de la préchauffe en semaine (HH:MM, lun-ven)",
        },
        preheatEnd: {
          name: "Fin préchauffe (semaine)",
          description: "Fin de la préchauffe en semaine (HH:MM, lun-ven)",
        },
        weekendPreheatStart: {
          name: "Début préchauffe (week-end)",
          description: "Début de la préchauffe le week-end (HH:MM, sam-dim)",
        },
        weekendPreheatEnd: {
          name: "Fin préchauffe (week-end)",
          description: "Fin de la préchauffe le week-end (HH:MM, sam-dim)",
        },
        buttons: {
          name: "Boutons cocoon",
          description: "Boutons qui activent le mode cocoon (optionnel)",
        },
        cocoonTemp: {
          name: "Température cocoon",
          description: "Consigne boostée quand le cocoon est activé par bouton (°C)",
        },
      },
      groups: {
        night: "Nuit",
        preheat: "Préchauffe",
        cocoon: "Cocoon",
      },
    },
    en: {
      name: "Presence Thermostat",
      description:
        "Adjusts thermostat setpoint based on zone presence. Sends comfort temperature when motion is detected, switches to eco after a timeout with no motion.",
      groups: {
        night: "Night",
        preheat: "Preheat",
        cocoon: "Cocoon",
      },
    },
  };

  // ── Instance fields ──────────────────────────────────────
  private ctx!: RecipeContext;
  private zoneId!: string;
  private thermostatId!: string;
  private comfortTemp!: number;
  private ecoTemp!: number;
  private timeoutMs!: number;

  // Night window
  private nightTemp: number | null = null;
  private nightStart: string | null = null;
  private nightEnd: string | null = null;

  // Preheat windows
  private preheatStart: string | null = null;
  private preheatEnd: string | null = null;
  private weekendPreheatStart: string | null = null;
  private weekendPreheatEnd: string | null = null;

  // Cocoon
  private buttonIds: string[] = [];
  private cocoonTemp: number | null = null;

  // Runtime state
  private currentMode: "comfort" | "eco" | "cocoon" = "eco";
  private overrideMode = false;
  private lastSentSetpoint: number | null = null;
  /** Grace period: ignore setpoint echoes for 5s after we send a setpoint command */
  private setpointGraceUntil = 0;
  private ecoTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicCheckTimer: ReturnType<typeof setInterval> | null = null;
  private wasInPreheat = false;
  private unsubs: (() => void)[] = [];

  // ── Validation ───────────────────────────────────────────

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    const { zone, thermostat, comfortTemp, ecoTemp, timeout } = params;

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
      ctx.log("Zone has no motion sensors — recipe will only work with preheat windows", "warn");
    }

    // Validate thermostat
    if (!thermostat || typeof thermostat !== "string") {
      throw new Error("Thermostat parameter is required");
    }
    const equipment = ctx.equipmentManager.getByIdWithDetails(thermostat);
    if (!equipment) {
      throw new Error(`Thermostat equipment not found: ${thermostat}`);
    }
    if (equipment.zoneId !== zone) {
      throw new Error(`Thermostat "${equipment.name}" does not belong to the selected zone`);
    }
    const hasSetpointOrder = equipment.orderBindings.some((ob) => ob.alias === "setpoint");
    if (!hasSetpointOrder) {
      throw new Error(`Thermostat "${equipment.name}" has no "setpoint" order binding`);
    }

    // Validate temperatures
    if (comfortTemp === undefined || comfortTemp === null) {
      throw new Error("comfortTemp is required");
    }
    if (isNaN(Number(comfortTemp))) {
      throw new Error("comfortTemp must be a number");
    }
    if (ecoTemp === undefined || ecoTemp === null) {
      throw new Error("ecoTemp is required");
    }
    if (isNaN(Number(ecoTemp))) {
      throw new Error("ecoTemp must be a number");
    }

    // Validate timeout
    parseDuration(timeout ?? "30m");

    // Validate night window
    const { nightTemp: nt, nightStart: ns, nightEnd: ne } = params;
    const hasNightTemp = nt !== undefined && nt !== null && nt !== "";
    const hasNightStart = ns !== undefined && ns !== null && ns !== "";
    const hasNightEnd = ne !== undefined && ne !== null && ne !== "";

    if (hasNightTemp && (!hasNightStart || !hasNightEnd)) {
      throw new Error("nightTemp requires nightStart and nightEnd");
    }
    if ((hasNightStart || hasNightEnd) && !hasNightTemp) {
      throw new Error("nightStart/nightEnd require nightTemp");
    }
    if (hasNightStart && hasNightEnd) {
      if (typeof ns === "string" && !/^\d{2}:\d{2}$/.test(ns)) {
        throw new Error("nightStart must be in HH:MM format");
      }
      if (typeof ne === "string" && !/^\d{2}:\d{2}$/.test(ne)) {
        throw new Error("nightEnd must be in HH:MM format");
      }
    }
    if (hasNightTemp && isNaN(Number(nt))) {
      throw new Error("nightTemp must be a number");
    }

    // Validate preheat weekday
    this.validateTimePair(params, "preheatStart", "preheatEnd");

    // Validate preheat weekend
    this.validateTimePair(params, "weekendPreheatStart", "weekendPreheatEnd");

    // Validate cocoon (buttons + cocoonTemp must be provided together)
    const buttonIds = this.normalizeStringArray(params.buttons);
    const hasCocoonTemp =
      params.cocoonTemp !== undefined && params.cocoonTemp !== null && params.cocoonTemp !== "";

    if (buttonIds.length > 0 && !hasCocoonTemp) {
      throw new Error("cocoonTemp is required when buttons are configured");
    }
    if (hasCocoonTemp && buttonIds.length === 0) {
      throw new Error("buttons are required when cocoonTemp is configured");
    }
    if (hasCocoonTemp && isNaN(Number(params.cocoonTemp))) {
      throw new Error("cocoonTemp must be a number");
    }

    // Validate each button has an "action" data binding
    for (const buttonId of buttonIds) {
      const btn = ctx.equipmentManager.getByIdWithDetails(buttonId);
      if (!btn) {
        throw new Error(`Button equipment not found: ${buttonId}`);
      }
      const hasActionData = btn.dataBindings.some((db) => db.alias === "action");
      if (!hasActionData) {
        throw new Error(`Button "${btn.name}" has no "action" data binding`);
      }
    }
  }

  private validateTimePair(
    params: Record<string, unknown>,
    startKey: string,
    endKey: string,
  ): void {
    const start = params[startKey];
    const end = params[endKey];
    const hasStart = start !== undefined && start !== null && start !== "";
    const hasEnd = end !== undefined && end !== null && end !== "";

    if (hasStart !== hasEnd) {
      throw new Error(`${startKey} and ${endKey} must both be provided or both omitted`);
    }
    if (hasStart && typeof start === "string" && !/^\d{2}:\d{2}$/.test(start)) {
      throw new Error(`${startKey} must be in HH:MM format`);
    }
    if (hasEnd && typeof end === "string" && !/^\d{2}:\d{2}$/.test(end)) {
      throw new Error(`${endKey} must be in HH:MM format`);
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
    this.thermostatId = params.thermostat as string;
    this.comfortTemp = Number(params.comfortTemp);
    this.ecoTemp = Number(params.ecoTemp);
    this.timeoutMs = parseDuration(params.timeout ?? "30m");

    // Night window
    this.nightTemp =
      params.nightTemp !== undefined && params.nightTemp !== null && params.nightTemp !== ""
        ? Number(params.nightTemp)
        : null;
    this.nightStart =
      typeof params.nightStart === "string" && params.nightStart ? params.nightStart : null;
    this.nightEnd = typeof params.nightEnd === "string" && params.nightEnd ? params.nightEnd : null;

    // Preheat windows
    this.preheatStart =
      typeof params.preheatStart === "string" && params.preheatStart ? params.preheatStart : null;
    this.preheatEnd =
      typeof params.preheatEnd === "string" && params.preheatEnd ? params.preheatEnd : null;
    this.weekendPreheatStart =
      typeof params.weekendPreheatStart === "string" && params.weekendPreheatStart
        ? params.weekendPreheatStart
        : null;
    this.weekendPreheatEnd =
      typeof params.weekendPreheatEnd === "string" && params.weekendPreheatEnd
        ? params.weekendPreheatEnd
        : null;

    // Cocoon
    this.buttonIds = this.normalizeStringArray(params.buttons);
    this.cocoonTemp =
      params.cocoonTemp !== undefined && params.cocoonTemp !== null && params.cocoonTemp !== ""
        ? Number(params.cocoonTemp)
        : null;

    // Reset runtime state (clear any stale state from previous run)
    this.currentMode = "eco";
    this.overrideMode = false;
    this.lastSentSetpoint = null;
    this.wasInPreheat = false;
    ctx.state.delete("overrideMode");
    ctx.state.delete("cocoonMode");
    ctx.state.set("currentMode", "eco");
    ctx.notifyStateChanged();

    // Subscribe to zone changes (motion)
    const unsubZone = ctx.eventBus.onType("zone.data.changed", (event) => {
      if (event.zoneId !== this.zoneId) return;
      this.onZoneChanged(event.aggregatedData.motion);
    });
    this.unsubs.push(unsubZone);

    // Subscribe to thermostat setpoint changes (manual override detection)
    const unsubSetpoint = ctx.eventBus.onType("equipment.data.changed", (event) => {
      if (event.equipmentId !== this.thermostatId) return;
      if (event.alias !== "setpoint") return;
      this.onSetpointChanged(event.value);
    });
    this.unsubs.push(unsubSetpoint);

    // Subscribe to button actions (cocoon toggle)
    if (this.buttonIds.length > 0) {
      const unsubButton = ctx.eventBus.onType("equipment.data.changed", (event) => {
        if (!this.buttonIds.includes(event.equipmentId)) return;
        if (event.alias !== "action") return;
        this.onButtonAction();
      });
      this.unsubs.push(unsubButton);
    }

    // Periodic check (preheat transitions + cocoon night exit)
    if (this.needsPeriodicCheck()) {
      this.wasInPreheat = this.isInPreheatWindow();
      this.periodicCheckTimer = setInterval(() => {
        this.checkPeriodicTransitions();
      }, 60_000);
    }

    // Force consistent setpoint on activation
    this.syncOnStart();
  }

  // ── Stop ─────────────────────────────────────────────────

  stop(): void {
    this.cancelEcoTimer();
    if (this.periodicCheckTimer) {
      clearInterval(this.periodicCheckTimer);
      this.periodicCheckTimer = null;
    }
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.overrideMode = false;
    this.lastSentSetpoint = null;
    this.setpointGraceUntil = 0;
    this.ctx.state.delete("overrideMode");
    this.ctx.state.delete("cocoonMode");
    this.ctx.state.delete("timerExpiresAt");
    this.ctx.state.delete("currentMode");
    this.ctx.notifyStateChanged();
  }

  // ── Initial sync — force setpoint on activation ─────────

  private syncOnStart(): void {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    const motion = zoneData?.motion ?? false;

    if (this.isInPreheatWindow()) {
      this.setComfort("Recipe activated — preheat window active");
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

    if (motion) {
      // Presence detected
      this.cancelEcoTimer();
      this.clearTimerState();

      if (this.currentMode === "eco") {
        this.setComfort("Motion detected");
      }
      // If cocoon or comfort → stay in current mode, just cancel eco timer
    } else {
      // No motion — preheat protects comfort but NOT cocoon
      if (this.currentMode === "comfort" && this.isInPreheatWindow()) {
        this.cancelEcoTimer();
        this.clearTimerState();
        return;
      }

      if (this.currentMode === "comfort" || this.currentMode === "cocoon") {
        this.startEcoTimer();
      }
    }
  }

  private onSetpointChanged(value: unknown): void {
    if (this.overrideMode) return;
    if (Date.now() < this.setpointGraceUntil) return;
    // Ignore echo: same value as what the recipe sent
    if (this.lastSentSetpoint !== null && Number(value) === this.lastSentSetpoint) return;

    this.overrideMode = true;
    this.ctx.state.set("overrideMode", true);
    this.ctx.notifyStateChanged();
    this.ctx.log("Manual setpoint change detected — entering override mode");
  }

  private onButtonAction(): void {
    // Ignore during override
    if (this.overrideMode) return;

    if (this.currentMode === "cocoon") {
      // Second press → exit cocoon
      this.cancelEcoTimer();
      this.clearTimerState();
      if (this.hasMotion()) {
        this.setComfort("Cocoon deactivated by button — motion present");
      } else {
        this.setEco("Cocoon deactivated by button — no motion");
      }
    } else {
      // Enter cocoon from any non-override mode
      this.setCocoon("Button pressed");
    }
  }

  // ── Action handler (UI / mode impact) ─────────────────

  override onAction(action: string, payload?: Record<string, unknown>): void {
    if (action !== "set_mode" || !payload?.mode) return;
    const mode = payload.mode as string;

    // Clear override if active — user is explicitly choosing a mode
    if (this.overrideMode) {
      this.clearOverrideMode();
    }

    switch (mode) {
      case "cocoon":
        if (this.cocoonTemp !== null && this.currentMode !== "cocoon") {
          this.setCocoon("Manual activation from UI");
        }
        break;
      case "comfort":
        if (this.currentMode !== "comfort") {
          this.setComfort("Manual activation from UI");
        }
        break;
      case "eco":
        if (this.currentMode !== "eco") {
          this.setEco("Manual activation from UI");
        }
        break;
    }
  }

  // ── Preheat logic ───────────────────────────────────────

  private hasPreheatConfig(): boolean {
    return (
      (this.preheatStart !== null && this.preheatEnd !== null) ||
      (this.weekendPreheatStart !== null && this.weekendPreheatEnd !== null)
    );
  }

  private needsPeriodicCheck(): boolean {
    return this.hasPreheatConfig() || (this.buttonIds.length > 0 && this.hasNightConfig());
  }

  private isInPreheatWindow(): boolean {
    if (!this.hasPreheatConfig()) return false;

    const now = new Date();
    const day = now.getDay(); // 0=Sun, 6=Sat
    const isWeekend = day === 0 || day === 6;

    if (isWeekend && this.weekendPreheatStart !== null && this.weekendPreheatEnd !== null) {
      return isInTimeWindow(now, this.weekendPreheatStart, this.weekendPreheatEnd);
    }
    if (!isWeekend && this.preheatStart !== null && this.preheatEnd !== null) {
      return isInTimeWindow(now, this.preheatStart, this.preheatEnd);
    }

    return false;
  }

  private checkPeriodicTransitions(): void {
    // Cocoon exit on night start
    if (this.currentMode === "cocoon" && this.isInNightWindow()) {
      this.cancelEcoTimer();
      this.clearTimerState();
      this.setEco("Night started — cocoon deactivated");
      this.wasInPreheat = this.isInPreheatWindow();
      return;
    }

    // Preheat transitions
    this.checkPreheatTransition();
  }

  private checkPreheatTransition(): void {
    if (this.overrideMode) {
      // Track preheat state but don't act during override
      this.wasInPreheat = this.isInPreheatWindow();
      return;
    }

    const inPreheat = this.isInPreheatWindow();

    // Entering preheat window
    if (inPreheat && !this.wasInPreheat) {
      this.cancelEcoTimer();
      this.clearTimerState();
      if (this.currentMode === "eco") {
        this.setComfort("Preheat window started");
      }
    }

    // Leaving preheat window
    if (!inPreheat && this.wasInPreheat) {
      if (this.currentMode === "comfort" && !this.hasMotion()) {
        this.startEcoTimer();
      }
    }

    this.wasInPreheat = inPreheat;
  }

  // ── Night window helpers ──────────────────────────────────

  private hasNightConfig(): boolean {
    return this.nightStart !== null && this.nightEnd !== null && this.nightTemp !== null;
  }

  private isInNightWindow(): boolean {
    if (!this.hasNightConfig()) return false;
    return isInTimeWindow(new Date(), this.nightStart!, this.nightEnd!);
  }

  // ── Temperature resolution ──────────────────────────────

  private getTargetComfortTemp(): number {
    if (this.nightTemp !== null && this.nightStart !== null && this.nightEnd !== null) {
      if (isInTimeWindow(new Date(), this.nightStart, this.nightEnd)) {
        return this.nightTemp;
      }
    }
    return this.comfortTemp;
  }

  // ── Motion state helper ─────────────────────────────────

  private hasMotion(): boolean {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    return zoneData?.motion ?? false;
  }

  // ── Actions ──────────────────────────────────────────────

  private setComfort(reason: string): void {
    const target = this.getTargetComfortTemp();
    this.setpointGraceUntil = Date.now() + 5000;
    this.lastSentSetpoint = target;
    try {
      this.ctx.equipmentManager.executeOrder(this.thermostatId, "setpoint", target);
    } catch (err) {
      this.ctx.log(`Error setting comfort setpoint: ${String(err)}`, "error");
    }
    this.currentMode = "comfort";
    this.ctx.state.set("currentMode", "comfort");
    this.clearCocoonState();
    this.ctx.notifyStateChanged();
    this.ctx.log(`${reason} — setpoint → ${target}°C (comfort)`);
  }

  private setEco(reason: string): void {
    this.setpointGraceUntil = Date.now() + 5000;
    this.lastSentSetpoint = this.ecoTemp;
    try {
      this.ctx.equipmentManager.executeOrder(this.thermostatId, "setpoint", this.ecoTemp);
    } catch (err) {
      this.ctx.log(`Error setting eco setpoint: ${String(err)}`, "error");
    }
    this.currentMode = "eco";
    this.ctx.state.set("currentMode", "eco");
    this.clearCocoonState();
    this.clearOverrideMode();
    this.ctx.notifyStateChanged();
    this.ctx.log(`${reason} — setpoint → ${this.ecoTemp}°C (eco)`);
  }

  private setCocoon(reason: string): void {
    this.cancelEcoTimer();
    this.clearTimerState();
    this.setpointGraceUntil = Date.now() + 5000;
    this.lastSentSetpoint = this.cocoonTemp!;
    try {
      this.ctx.equipmentManager.executeOrder(this.thermostatId, "setpoint", this.cocoonTemp!);
    } catch (err) {
      this.ctx.log(`Error setting cocoon setpoint: ${String(err)}`, "error");
    }
    this.currentMode = "cocoon";
    this.ctx.state.set("currentMode", "cocoon");
    this.ctx.state.set("cocoonMode", true);
    this.ctx.notifyStateChanged();
    this.ctx.log(`${reason} — setpoint → ${this.cocoonTemp}°C (cocoon)`);
  }

  // ── Cocoon state management ───────────────────────────────

  private clearCocoonState(): void {
    this.ctx.state.delete("cocoonMode");
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
