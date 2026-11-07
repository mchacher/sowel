import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import type {
  ArbiterDecisionKind,
  ArbiterQuarterState,
  DataCategory,
  EnergyLoadClass,
} from "../types";

// Guards against untranslated i18n keys reaching the UI (issue #575: the
// `waiting` arbiter kind was added to the type but never to the locale files,
// so the decision journal rendered the raw key `arbiter.kind.waiting`).

const en_ = en as Record<string, string>;

// Exhaustive maps: adding a new union member without extending these arrays is
// a compile error, which forces a matching locale entry via the tests below.
const ALL_DECISION_KINDS: Record<ArbiterDecisionKind, true> = {
  granted: true,
  revoked: true,
  denied: true,
  released: true,
  suspended: true,
  resumed: true,
  "revoke-not-honored": true,
  "comfort-off-after-revoke": true,
  "watts-divergence": true,
  "unclaimed-run": true,
  "unclaimed-run-ended": true,
  waiting: true,
  "draw-stopped": true,
  "draw-started": true,
  reset: true,
};

// Spec 165 — one exhaustive map for both surfaces: the roster pill and the
// ribbon read the same `arbiter.loadState.*` root, so a state added to the
// union without a translation fails here once, not twice or never.
const ALL_LOAD_STATES: Record<ArbiterQuarterState, true> = {
  granted: true,
  "granted-idle": true,
  pending: true,
  revoked: true,
  unmanaged: true,
  suspended: true,
  idle: true,
};

const ALL_LOAD_CLASSES: Record<EnergyLoadClass, true> = {
  comfort: true,
  deferrable: true,
};

// Spec 196, slice 2a — 30 categories had no `category.*` label, so a chart
// picker showed the raw key `category.setpoint`. Every category gets a label in
// both languages; a category added to the union without one fails to compile here.
const ALL_DATA_CATEGORIES: Record<DataCategory, true> = {
  motion: true,
  temperature: true,
  humidity: true,
  pressure: true,
  luminosity: true,
  contact_door: true,
  contact_window: true,
  light_state: true,
  light_brightness: true,
  light_color_temp: true,
  light_color: true,
  shutter_position: true,
  lock_state: true,
  battery: true,
  power: true,
  energy: true,
  voltage: true,
  current: true,
  water_leak: true,
  smoke: true,
  co2: true,
  voc: true,
  noise: true,
  rain: true,
  wind: true,
  action: true,
  gate_state: true,
  cover_state: true,
  runtime_daily: true,
  weather_condition: true,
  uv: true,
  solar_radiation: true,
  setpoint: true,
  temperature_outdoor: true,
  temperature_device: true,
  humidity_outdoor: true,
  media_volume: true,
  media_mute: true,
  media_input: true,
  appliance_state: true,
  solar_state: true,
  pool_water_temperature: true,
  pool_temperature_setpoint: true,
  firmware_version: true,
  uptime: true,
  rssi: true,
  language: true,
  display_brightness: true,
  camera_snapshot_url: true,
  camera_stream_url: true,
  camera_monitoring: true,
  camera_light_mode: true,
  camera_detection: true,
  ups_status: true,
  battery_runtime: true,
  ups_load: true,
  operation_mode: true,
  ev_vehicle_state: true,
  ev_charge_current: true,
  ev_session_energy: true,
  ev_battery_level: true,
  ev_range: true,
  ev_plugged: true,
  ev_charging_state: true,
  ev_reported_at: true,
  ev_at_home: true,
  ev_mileage: true,
  ev_charge_limit: true,
  ev_charge_power: true,
  generic: true,
};

const fr_ = fr as Record<string, string>;

describe("locale completeness", () => {
  it("en and fr expose exactly the same set of keys", () => {
    const enKeys = Object.keys(en).sort();
    const frKeys = Object.keys(fr).sort();
    const onlyInEn = enKeys.filter((k) => !(k in fr));
    const onlyInFr = frKeys.filter((k) => !(k in en));
    expect(onlyInEn, "keys present in en but missing in fr").toEqual([]);
    expect(onlyInFr, "keys present in fr but missing in en").toEqual([]);
  });

  it("every arbiter decision kind has an arbiter.kind.* label (#575)", () => {
    for (const kind of Object.keys(ALL_DECISION_KINDS)) {
      expect(en_, `missing arbiter.kind.${kind}`).toHaveProperty(`arbiter.kind.${kind}`);
    }
  });

  it("every arbiter load state has an arbiter.loadState.* label (spec 165)", () => {
    for (const state of Object.keys(ALL_LOAD_STATES)) {
      expect(en_, `missing arbiter.loadState.${state}`).toHaveProperty(
        `arbiter.loadState.${state}`,
      );
    }
  });

  it("no per-state key survives outside the arbiter.loadState.* root (spec 165)", () => {
    const strays = Object.keys(en_).filter(
      (k) => k.startsWith("arbiter.rosterState.") || k.startsWith("arbiter.timeline.state."),
    );
    expect(strays, "pre-165 per-state keys must be gone").toEqual([]);
  });

  it("every data category has a category.* label in fr and en (spec 196)", () => {
    for (const category of Object.keys(ALL_DATA_CATEGORIES)) {
      expect(en_, `missing en category.${category}`).toHaveProperty([`category.${category}`]);
      expect(fr_, `missing fr category.${category}`).toHaveProperty([`category.${category}`]);
    }
  });

  it("every energy load class has an energyProfile.* label", () => {
    for (const cls of Object.keys(ALL_LOAD_CLASSES)) {
      expect(en_, `missing energyProfile.${cls}`).toHaveProperty(`energyProfile.${cls}`);
    }
  });

  it("has the keys previously rendered raw or via a hardcoded fallback", () => {
    const keys = [
      "binding.dataProperties",
      "binding.orders",
      "equipments.editEquipment",
      "plugins.incompatible",
      "nav.more",
      "recipes.overrideActive",
      "zones.commands.toolbarLabel",
      "zones.openTree",
      "category.value.water_leak.leak",
      "category.value.smoke.alert",
    ];
    for (const key of keys) {
      expect(en_, `missing ${key}`).toHaveProperty(key);
    }
  });
});
