import type { RecipeSlotDef } from "../shared/types.js";
import { Recipe, type RecipeContext } from "./engine/recipe.js";

// ============================================================
// Duration parsing helper
// ============================================================

function parseDuration(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") throw new Error(`Invalid duration: ${value}`);

  const match = value.match(/^(\d+)\s*(s|m|h)$/);
  if (!match) throw new Error(`Invalid duration format: ${value}. Use e.g. "10m", "30s", "1h"`);

  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return num * 1000;
    case "m": return num * 60 * 1000;
    case "h": return num * 60 * 60 * 1000;
    default: throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

function formatDuration(ms: number): string {
  if (ms >= 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  if (ms >= 60 * 1000) return `${Math.round(ms / (60 * 1000))}min`;
  return `${Math.round(ms / 1000)}s`;
}

// ============================================================
// Motion-Light Recipe
// ============================================================

export class MotionLightRecipe extends Recipe {
  readonly id = "motion-light";
  readonly name = "Motion Light";
  readonly description = "Turns on the light when motion is detected, turns off after a timeout with no motion. Also handles manual on/off.";
  readonly slots: RecipeSlotDef[] = [
    {
      id: "zone",
      name: "Zone",
      description: "Zone to monitor",
      type: "zone",
      required: true,
    },
    {
      id: "light",
      name: "Light",
      description: "Light to control",
      type: "equipment",
      required: true,
      constraints: { equipmentType: "light_onoff" },
    },
    {
      id: "timeout",
      name: "Timeout",
      description: "Delay with no motion before turning off",
      type: "duration",
      required: true,
      defaultValue: "10m",
    },
  ];

  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: (() => void)[] = [];
  private ctx!: RecipeContext;
  private zoneId!: string;
  private lightId!: string;
  private timeoutMs!: number;

  validate(params: Record<string, unknown>, ctx: RecipeContext): void {
    const { zone, light, timeout } = params;

    // Validate zone exists (use zoneManager, not aggregator — aggregator cache may be empty at startup)
    if (!zone || typeof zone !== "string") {
      throw new Error("Zone parameter is required");
    }
    const zoneObj = ctx.zoneManager.getById(zone);
    if (!zoneObj) {
      throw new Error(`Zone not found: ${zone}`);
    }
    const zoneData = ctx.zoneAggregator.getByZoneId(zone);
    if (zoneData && zoneData.motionSensors === 0) {
      ctx.log(`Zone has no motion sensors — recipe will never trigger`, "warn");
    }

    // Validate light exists and has state order
    if (!light || typeof light !== "string") {
      throw new Error("Light parameter is required");
    }
    const equipment = ctx.equipmentManager.getByIdWithDetails(light);
    if (!equipment) {
      throw new Error(`Light equipment not found: ${light}`);
    }
    const hasStateOrder = equipment.orderBindings.some((ob) => ob.alias === "state");
    if (!hasStateOrder) {
      throw new Error(`Light equipment "${equipment.name}" has no "state" order binding`);
    }

    // Validate timeout
    const timeoutValue = timeout ?? "10m";
    parseDuration(timeoutValue);
  }

  start(params: Record<string, unknown>, ctx: RecipeContext): void {
    this.ctx = ctx;
    this.zoneId = params.zone as string;
    this.lightId = params.light as string;
    this.timeoutMs = parseDuration(params.timeout ?? "10m");

    // Listen to zone aggregation changes (for motion)
    const unsubZone = ctx.eventBus.onType("zone.data.changed", (event) => {
      if (event.zoneId !== this.zoneId) return;
      this.onZoneChanged(event.aggregatedData.motion);
    });
    this.unsubs.push(unsubZone);

    // Listen to light state changes (for manual on/off)
    const unsubLight = ctx.eventBus.onType("equipment.data.changed", (event) => {
      if (event.equipmentId !== this.lightId) return;
      if (event.alias !== "state") return;
      this.onLightChanged(event.value);
    });
    this.unsubs.push(unsubLight);

  }

  stop(): void {
    this.cancelTimer();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }

  // ============================================================
  // Event handlers
  // ============================================================

  private onZoneChanged(motion: boolean): void {
    const lightOn = this.isLightOn();

    if (motion && !lightOn) {
      this.turnOn();
    } else if (motion && lightOn) {
      this.resetTimer();
    } else if (!motion && lightOn) {
      this.startTimer();
    }
    // !motion && !lightOn → nothing to do
  }

  private onLightChanged(value: unknown): void {
    const lightOn = value === true || value === "ON";
    const motion = this.hasMotion();

    if (lightOn && !motion) {
      this.startTimer();
      this.ctx.log(`Light turned on externally — turning off in ${formatDuration(this.timeoutMs)}`);
    } else if (lightOn && motion) {
      this.resetTimer();
    } else if (!lightOn) {
      this.cancelTimer();
      this.ctx.log("Light turned off externally — timer cancelled");
    }
  }

  // ============================================================
  // Light state helpers
  // ============================================================

  private isLightOn(): boolean {
    const bindings = this.ctx.equipmentManager.getDataBindingsWithValues(this.lightId);
    const stateBinding = bindings.find((b) => b.alias === "state" || b.category === "light_state");
    if (!stateBinding) return false;
    return stateBinding.value === true || stateBinding.value === "ON";
  }

  private hasMotion(): boolean {
    const zoneData = this.ctx.zoneAggregator.getByZoneId(this.zoneId);
    return zoneData?.motion ?? false;
  }

  // ============================================================
  // Actions
  // ============================================================

  private turnOn(): void {
    try {
      this.ctx.equipmentManager.executeOrder(this.lightId, "state", "ON");
      this.ctx.log("Motion detected — light turned on");
    } catch (err) {
      this.ctx.log(`Error turning on light: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  private turnOff(): void {
    try {
      this.ctx.equipmentManager.executeOrder(this.lightId, "state", "OFF");
      this.ctx.log(`No motion for ${formatDuration(this.timeoutMs)} — light turned off`);
    } catch (err) {
      this.ctx.log(`Error turning off light: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  // ============================================================
  // Timer management
  // ============================================================

  private startTimer(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.clearTimerState();
      this.turnOff();
    }, this.timeoutMs);
    this.persistTimerState();
  }

  private resetTimer(): void {
    if (this.timer) {
      this.cancelTimer();
    }
    // No new timer — motion is active, wait for it to stop
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.clearTimerState();
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
