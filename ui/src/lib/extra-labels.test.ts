import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import { extraLabel, extraTextValue } from "./extra-labels";

// Spec 196, slice 2b — the Tuya charger's extra readings showed in English
// (« Max current », « sleep ») on a French page.

const t = i18n.t.bind(i18n);
const NS = "equipments.evCharger";

describe("extra labels", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the charger's readings in French, camelCase or snake_case alike", async () => {
    await i18n.changeLanguage("fr");
    expect(extraLabel(NS, "maxCurrent", t)).toBe("Courant maximal");
    expect(extraLabel(NS, "max_current", t)).toBe("Courant maximal");
    expect(extraLabel(NS, "charger_temperature", t)).toBe("Température de la borne");
    expect(extraTextValue(NS, "status", "sleep", t)).toBe("En veille");
    expect(extraTextValue(NS, "plugInAction", "prompt", t)).toBe("Demander");
  });

  it("falls back to the humanised alias and the raw value", async () => {
    await i18n.changeLanguage("fr");
    expect(extraLabel(NS, "boostLevel", t)).toBe("Boost level");
    expect(extraTextValue(NS, "status", "warming_up", t)).toBe("warming_up");
  });
});
