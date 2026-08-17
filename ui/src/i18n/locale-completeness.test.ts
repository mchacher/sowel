import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import type { ArbiterDecisionKind, ArbiterQuarterState, EnergyLoadClass } from "../types";

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
};

const ALL_QUARTER_STATES: Record<ArbiterQuarterState, true> = {
  granted: true,
  pending: true,
  revoked: true,
  unmanaged: true,
  idle: true,
};

const ALL_LOAD_CLASSES: Record<EnergyLoadClass, true> = {
  comfort: true,
  deferrable: true,
};

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

  it("every arbiter timeline quarter state has an arbiter.timeline.state.* label", () => {
    for (const state of Object.keys(ALL_QUARTER_STATES)) {
      expect(en_, `missing arbiter.timeline.state.${state}`).toHaveProperty(
        `arbiter.timeline.state.${state}`,
      );
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
