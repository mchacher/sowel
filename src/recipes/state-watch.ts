import type { RecipeSlotDef, RecipeLangPack } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";
import { parseDuration, formatDuration } from "./engine/duration.js";

// ============================================================
// StateWatch Recipe
// ============================================================

export class StateWatchRecipe extends Recipe {
  readonly id = "state-watch";
  readonly name = "State Watch";
  readonly description =
    "Monitor an equipment data key and raise an alarm when the value stays in a watched state. Supports delayed alarm, periodic repeat, and daily scheduled check.";
  readonly slots: RecipeSlotDef[] = [
    {
      id: "zone",
      name: "Zone",
      description: "Zone of the equipment to monitor",
      type: "zone",
      required: true,
    },
    {
      id: "equipment",
      name: "Equipment",
      description: "Equipment to monitor",
      type: "equipment",
      required: true,
    },
    {
      id: "dataKey",
      name: "Data Key",
      description: "Data binding alias to watch (e.g., contact, state)",
      type: "data-key",
      required: true,
    },
    {
      id: "watchValue",
      name: "Watch Value",
      description: "Value that triggers the alarm (e.g., open, true)",
      type: "text",
      required: true,
    },
    {
      id: "delay",
      name: "Delay",
      description: "Time in watched state before first alarm (e.g., 10m)",
      type: "duration",
      required: false,
    },
    {
      id: "repeatInterval",
      name: "Repeat Interval",
      description: "Re-alarm interval while still in watched state (e.g., 1h)",
      type: "duration",
      required: false,
    },
    {
      id: "checkTime",
      name: "Check Time",
      description: "Daily check time — alarm if still in watched state (e.g., 23:00)",
      type: "time",
      required: false,
    },
  ];

  override readonly i18n: Record<string, RecipeLangPack> = {
    fr: {
      name: "Surveillance d'état",
      description:
        "Surveille une donnée d'équipement et déclenche une alarme si la valeur reste dans un état donné. Supporte un délai, une répétition périodique et un check quotidien à heure fixe.",
      slots: {
        zone: { name: "Zone", description: "Zone de l'équipement à surveiller" },
        equipment: { name: "Équipement", description: "Équipement à surveiller" },
        dataKey: {
          name: "Clé de donnée",
          description: "Alias de la donnée à surveiller (ex: contact, state)",
        },
        watchValue: {
          name: "Valeur surveillée",
          description: "Valeur qui déclenche la surveillance (ex: open, true)",
        },
        delay: {
          name: "Délai",
          description: "Durée avant la première alarme (ex: 10m)",
        },
        repeatInterval: {
          name: "Intervalle de répétition",
          description: "Intervalle de rappel tant que l'état persiste (ex: 1h)",
        },
        checkTime: {
          name: "Heure de vérification",
          description: "Heure de check quotidien — alarme si encore dans l'état (ex: 23:00)",
        },
      },
    },
  };

  private ctx!: RecipeContext;
  private equipmentId!: string;
  private dataKey!: string;
  private watchValue!: string;
  private delayMs: number | null = null;
  private repeatIntervalMs: number | null = null;
  private checkTimeStr: string | null = null;

  private unsubs: (() => void)[] = [];
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private repeatTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;

  // ============================================================
  // Validation
  // ============================================================

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    const { zone, equipment, dataKey, watchValue, delay, repeatInterval, checkTime } = params;

    // Validate zone
    if (!zone || typeof zone !== "string") {
      throw new Error("Zone parameter is required");
    }
    if (!ctx.zoneManager.getById(zone)) {
      throw new Error(`Zone not found: ${zone}`);
    }

    // Validate equipment
    if (!equipment || typeof equipment !== "string") {
      throw new Error("Equipment parameter is required");
    }
    const eq = ctx.equipmentManager.getByIdWithDetails(equipment);
    if (!eq) {
      throw new Error(`Equipment not found: ${equipment}`);
    }
    if (eq.zoneId !== zone) {
      throw new Error(`Equipment "${eq.name}" does not belong to the selected zone`);
    }

    // Validate dataKey
    if (!dataKey || typeof dataKey !== "string") {
      throw new Error("Data key parameter is required");
    }
    const hasBinding = eq.dataBindings.some((b) => b.alias === dataKey);
    if (!hasBinding) {
      throw new Error(`Equipment "${eq.name}" has no data binding with alias "${dataKey}"`);
    }

    // Validate watchValue
    if (watchValue === undefined || watchValue === null || watchValue === "") {
      throw new Error("Watch value parameter is required");
    }

    // Validate at least one trigger mode
    const hasDelay = delay !== undefined && delay !== null && delay !== "";
    const hasRepeat =
      repeatInterval !== undefined && repeatInterval !== null && repeatInterval !== "";
    const hasCheck = checkTime !== undefined && checkTime !== null && checkTime !== "";

    if (!hasDelay && !hasRepeat && !hasCheck) {
      throw new Error("At least one trigger mode is required: delay, repeatInterval, or checkTime");
    }

    // Validate duration formats
    if (hasDelay) parseDuration(delay);
    if (hasRepeat) parseDuration(repeatInterval);

    // Validate time format
    if (hasCheck) {
      const timeStr = String(checkTime);
      if (!/^\d{1,2}:\d{2}$/.test(timeStr)) {
        throw new Error(`Invalid time format: ${timeStr}. Use HH:MM (e.g., "23:00")`);
      }
    }
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  start(params: Record<string, unknown>, ctx: RecipeContext): void {
    this.ctx = ctx;
    this.equipmentId = params.equipment as string;
    this.dataKey = params.dataKey as string;
    this.watchValue = String(params.watchValue);

    this.delayMs =
      params.delay !== undefined && params.delay !== null && params.delay !== ""
        ? parseDuration(params.delay)
        : null;

    this.repeatIntervalMs =
      params.repeatInterval !== undefined &&
      params.repeatInterval !== null &&
      params.repeatInterval !== ""
        ? parseDuration(params.repeatInterval)
        : null;

    this.checkTimeStr =
      params.checkTime !== undefined && params.checkTime !== null && params.checkTime !== ""
        ? String(params.checkTime)
        : null;

    // Ensure all state keys exist in DB so they appear in notification publisher dropdowns.
    // Only write defaults for keys not yet set (alarm=false/true distinguishes from null=missing).
    const defaults: Record<string, unknown> = {
      alarm: false,
      alarmSince: null,
      alarmCount: 0,
      currentValue: null,
    };
    for (const [key, defaultVal] of Object.entries(defaults)) {
      const current = ctx.state.get(key);
      // state.get() returns null both for missing keys and for keys set to null.
      // For "alarm", check specifically — false/true means it was already set.
      if (key === "alarm" && (current === true || current === false)) continue;
      // For others, always write to ensure the row exists in recipe_state table.
      if (key !== "alarm") {
        ctx.state.set(key, current ?? defaultVal);
      } else {
        ctx.state.set(key, defaultVal);
      }
    }

    // Subscribe to equipment data changes
    const unsub = ctx.eventBus.onType("equipment.data.changed", (event) => {
      if (event.equipmentId !== this.equipmentId) return;
      if (event.alias !== this.dataKey) return;
      this.onValueChanged(event.value);
    });
    this.unsubs.push(unsub);

    // Start daily check timer if configured
    if (this.checkTimeStr) {
      this.scheduleNextCheck();
    }

    // Restore state from persistence
    this.restoreState();
  }

  stop(): void {
    this.clearDelayTimer();
    this.clearRepeatTimer();
    this.clearCheckTimer();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    // Clear persisted state
    this.ctx.state.delete("alarm");
    this.ctx.state.delete("alarmSince");
    this.ctx.state.delete("alarmCount");
    this.ctx.state.delete("currentValue");
    this.ctx.state.delete("watchStartedAt");
    this.ctx.notifyStateChanged();
  }

  // ============================================================
  // State restoration (after app restart)
  // ============================================================

  private restoreState(): void {
    const currentValue = this.readCurrentValue();
    this.ctx.state.set("currentValue", currentValue);

    const isInWatchedState = this.matchesWatchValue(currentValue);
    const wasInAlarm = this.ctx.state.get("alarm") === true;
    const watchStartedAt = this.ctx.state.get("watchStartedAt") as string | undefined;

    this.ctx.log(`Current: ${this.dataKey}=${String(currentValue)}`);

    if (!isInWatchedState) {
      if (wasInAlarm) {
        this.ctx.state.set("alarm", false);
        this.ctx.state.set("alarmSince", null);
        this.ctx.state.set("alarmCount", 0);
        this.ctx.state.delete("watchStartedAt");
        this.ctx.notifyStateChanged();
        this.ctx.log("Alarm cleared on restart");
      }
      return;
    }

    if (wasInAlarm) {
      if (this.repeatIntervalMs) {
        this.startRepeatTimer();
      }
      this.ctx.log("Alarm still active after restart");
    } else if (watchStartedAt && this.delayMs !== null) {
      // Was waiting for delay — recalculate
      const elapsed = Date.now() - new Date(watchStartedAt).getTime();
      const remaining = this.delayMs - elapsed;
      if (remaining <= 0) {
        // Delay already expired during downtime
        this.raiseAlarm();
      } else {
        this.delayTimer = setTimeout(() => {
          this.delayTimer = null;
          this.raiseAlarm();
        }, remaining);
      }
    } else if (!watchStartedAt) {
      // No watchStartedAt but value is in watched state — treat as fresh entry
      this.onValueEntersWatchedState();
    }
  }

  // ============================================================
  // Event handlers
  // ============================================================

  private onValueChanged(value: unknown): void {
    const previousValue = this.ctx.state.get("currentValue");
    this.ctx.state.set("currentValue", value);

    // Skip processing if value hasn't actually changed
    if (String(value) === String(previousValue)) return;

    if (this.matchesWatchValue(value)) {
      if (!this.ctx.state.get("watchStartedAt")) {
        this.onValueEntersWatchedState();
      }
    } else {
      this.onValueLeavesWatchedState(value);
    }
  }

  private onValueEntersWatchedState(): void {
    const now = new Date().toISOString();
    this.ctx.state.set("watchStartedAt", now);

    if (this.delayMs !== null && this.delayMs > 0) {
      this.delayTimer = setTimeout(() => {
        this.delayTimer = null;
        this.raiseAlarm();
      }, this.delayMs);
      this.ctx.log(`${this.dataKey}=${this.watchValue} — alarm in ${formatDuration(this.delayMs)}`);
    } else if (this.delayMs === 0 || (this.delayMs === null && this.repeatIntervalMs !== null)) {
      this.raiseAlarm();
    } else if (this.checkTimeStr) {
      this.ctx.log(`${this.dataKey}=${this.watchValue} — check at ${this.checkTimeStr}`);
    }
  }

  private onValueLeavesWatchedState(newValue: unknown): void {
    this.clearDelayTimer();
    this.clearRepeatTimer();

    const wasInAlarm = this.ctx.state.get("alarm") === true;
    this.ctx.state.delete("watchStartedAt");

    if (wasInAlarm) {
      this.ctx.state.set("alarm", false);
      this.ctx.state.set("alarmSince", null);
      this.ctx.state.set("alarmCount", 0);
      this.ctx.notifyStateChanged();
      this.ctx.log(`${this.dataKey}=${String(newValue)} — alarm cleared`);
    } else {
      this.ctx.log(`${this.dataKey}=${String(newValue)}`);
    }
  }

  // ============================================================
  // Alarm management
  // ============================================================

  private raiseAlarm(): void {
    const wasInAlarm = this.ctx.state.get("alarm") === true;
    const alarmCount = ((this.ctx.state.get("alarmCount") as number) ?? 0) + 1;

    if (!wasInAlarm) {
      this.ctx.state.set("alarm", true);
      this.ctx.state.set("alarmSince", new Date().toISOString());
    }
    this.ctx.state.set("alarmCount", alarmCount);
    this.ctx.notifyStateChanged();

    if (!wasInAlarm) {
      this.ctx.log(`ALARM: ${this.dataKey}=${this.watchValue}`);
    } else {
      this.ctx.log(`ALARM repeat #${alarmCount}`);
    }

    // Start repeat timer if configured
    if (this.repeatIntervalMs) {
      this.startRepeatTimer();
    }
  }

  private startRepeatTimer(): void {
    this.clearRepeatTimer();
    this.repeatTimer = setTimeout(() => {
      this.repeatTimer = null;
      // Only repeat if still in watched state
      const currentValue = this.readCurrentValue();
      if (this.matchesWatchValue(currentValue)) {
        this.raiseAlarm();
      }
    }, this.repeatIntervalMs!);
  }

  // ============================================================
  // Scheduled check (checkTime)
  // ============================================================

  private scheduleNextCheck(): void {
    this.clearCheckTimer();
    const ms = msUntilNextOccurrence(this.checkTimeStr!);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      this.onScheduledCheck();
      // Reschedule for next day
      this.scheduleNextCheck();
    }, ms);
  }

  private onScheduledCheck(): void {
    const currentValue = this.readCurrentValue();
    this.ctx.state.set("currentValue", currentValue);

    if (!this.matchesWatchValue(currentValue)) return;

    const wasInAlarm = this.ctx.state.get("alarm") === true;
    const alarmCount = ((this.ctx.state.get("alarmCount") as number) ?? 0) + 1;

    if (!wasInAlarm) {
      this.ctx.state.set("alarm", true);
      this.ctx.state.set("alarmSince", new Date().toISOString());
    }
    this.ctx.state.set("alarmCount", alarmCount);
    this.ctx.notifyStateChanged();
    this.ctx.log(
      `Check ${this.checkTimeStr}: ${this.dataKey}=${this.watchValue} — ALARM #${alarmCount}`,
    );
  }

  // ============================================================
  // Value comparison
  // ============================================================

  private matchesWatchValue(value: unknown): boolean {
    return String(value) === this.watchValue;
  }

  private readCurrentValue(): unknown {
    const eq = this.ctx.equipmentManager.getByIdWithDetails(this.equipmentId);
    if (!eq) return undefined;
    const binding = eq.dataBindings.find((b) => b.alias === this.dataKey);
    return binding?.value;
  }

  // ============================================================
  // Timer cleanup
  // ============================================================

  private clearDelayTimer(): void {
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
  }

  private clearRepeatTimer(): void {
    if (this.repeatTimer) {
      clearTimeout(this.repeatTimer);
      this.repeatTimer = null;
    }
  }

  private clearCheckTimer(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
  }
}

// ============================================================
// Helper: compute ms until next occurrence of HH:MM today/tomorrow
// ============================================================

function msUntilNextOccurrence(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}
