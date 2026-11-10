import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

// Spec 196, slice 2a — French typography in fr.json, locked.
//
// - A narrow no-break space (U+202F) before : ; ! ? and inside « », so the
//   mark never starts a line on its own. Not a plain space, not U+00A0.
// - The ellipsis character, not three dots.
// - Straight apostrophe everywhere (decision pr2-apostrophe): one form, so a
//   label never mixes a curly and a straight one.
// - No "(s)" plural: use i18next _one / _other keys.
// - No plain or no-break space before a unit. A value with its unit is passed
//   already formatted (`{{power}}` from lib/format, never `{{watts}} W`); a unit
//   written in the text itself (« 24 h », « {{count}} min ») sits after U+202F.
// - A French value identical to its English one is a leak until proven
//   otherwise: a proper noun, an acronym, or a word both languages share
//   goes in SAME_AS_EN on purpose.

const fr_ = fr as Record<string, string>;
const en_ = en as Record<string, string>;
const NNBSP = "\u202f";

/** A unit, as a whole word: « 4 min » is caught, « 4 minutes » and « 2 mois » are not. */
const UNIT = String.raw`(?:kWh|Wh|kW|W|V|mA|A|%|°C|°|mm|km/h|km|m/s|lx|ppm|hPa|mbar|dBm|dB|€|ms|min|h|j|s|ko|Mo|Go)(?![\p{L}\d])`;

function offenders(test: (value: string) => boolean): string[] {
  return Object.entries(fr_)
    .filter(([, value]) => test(value))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
}

const SAME_AS_EN = new Set<string>([
  "app.name",
  "nav.administration",
  "nav.modes",
  "common.type",
  "updates.sheet.versions",
  "devices.col.source",
  "devices.col.lqi",
  "devices.col.topic",
  "zones.count_one",
  "zones.count_other",
  "zones.form.description",
  "zones.childCount_one",
  "zones.childCount_other",
  "zones.commands.allShuttersStop",
  "zones.commands.allAwningsStop",
  "equipments.configuration",
  "settings.notifications.title",
  "equipments.form.type",
  "equipments.form.zone",
  "equipments.type.thermostat",
  "equipments.type.vmc",
  "equipments.evSessions.how.auto",
  "equipments.vmc.v1",
  "equipments.vmc.v2",
  "equipments.ups.absent",
  "energy.live.grid.import",
  "energy.live.grid.export",
  "equipments.ups.margins.position",
  "equipments.ups.field.beeper",
  "cameras.lightMode.auto",
  "water.minutes",
  "water.status.normal_state",
  "equipments.group.ventilation",
  "binding.alias",
  "controls.stop",
  "controls.position",
  "sensors.sources_one",
  "sensors.sources_other",
  "category.co2",
  "category.action",
  "category.value.water_leak.ok",
  "category.value.smoke.ok",
  "category.shutter_position",
  "category.media_volume",
  "category.media_input",
  "category.rssi",
  "weather.windDirection",
  "time.min",
  "time.hour",
  "time.second",
  "modes.title",
  "modes.actionCount_one",
  "modes.actionCount_other",
  "modes.description",
  "modes.impacts",
  "recipes.actions.set_mode.auto",
  "setup.home.latitude",
  "setup.home.longitude",
  "settings.languageEn",
  "settings.languageFr",
  "settings.latitude",
  "settings.longitude",
  "nav.analyse",
  "nav.logs",
  "integrations.mqttClientId",
  "integrations.actions",
  "integrations.configuration",
  "thermostat.mode",
  "thermostat.modes.auto",
  "thermostat.values.fanSpeed.auto",
  "buttonActions.title",
  "buttonActions.zone",
  "thermostat.values.stoveState.diagnostic",
  "thermostat.values.stoveState.diagnostic_2",
  "thermostat.values.pelletSensor.inactive",
  "thermostat.values.sparkPlug.ok",
  "thermostat.extras.nanoe",
  "thermostat.values.ecoMode.auto",
  "thermostat.values.nanoe.modeG",
  "logs.module",
  "history.influxdb",
  "history.url",
  "history.bucket",
  "history.taskActive",
  "history.taskInactive",
  "analyse.title",
  "analyse.zone",
  "analyse.bool.motion.off",
  "mqttPublishers.source",
  "mqttPublishers.zone",
  "mqttPublishers.broker",
  "mqttPublishers.test",
  "nav.notificationPublishers",
  "notifPublishers.chatId",
  "notifPublishers.message",
  "notifPublishers.zone",
  "notifPublishers.throttle",
  "notifPublishers.repeatMinutes",
  "notifPublishers.test",
  "dashboard.tabZone",
  "dashboard.selectZone",
  "nav.energy.production",
  "energy.live.autoconso",
  "energy.live.label.production",
  "energy.live.phases.phase",
  "energy.total",
  "energy.viewMode.total",
  "energy.unit.wh",
  "energy.unit.eur",
  "energy.bilan.compare.withPercent",
  "energy.bilan.arbiter.load",
  "energy.bilan.usage.usage",
  "energy.bilan.usage.energy",
  "nav.plugins",
  "plugins.title",
  "plugins.incompatible",
  "plugins.personal.modal.version",
  "plugins.sources.placeholder",
  "plugins.version",
  "settings.tabs.admin",
  "settings.version.title",
  "activity.templates.order.executed",
  "activity.templates.order.executed.multi",
  "activity.source.button",
  "activity.source.external",
  "arbiter.budget",
  // Spec 197 — « Surplus » and « import » are French too; the rest is placeholders.
  "arbiter.sticker.surplus",
  "arbiter.timeline.importPeak",
  "arbiter.timeline.cellLabel",
  "equipments.solar.orientation",
  "equipments.solar.cardinal.N",
  "equipments.solar.cardinal.NE",
  "equipments.solar.cardinal.E",
  "equipments.solar.cardinal.SE",
  "equipments.solar.cardinal.S",
  "equipments.pv.accuracyValue",
  "equipments.pv.accuracyValueNoPct",
  "sharedAccess.journal.title",
  "sharedAccess.phones.platform.iphone",
  "sharedAccess.phones.platform.ipad",
  "sharedAccess.phones.platform.android",
  "sharedAccess.phones.platform.mac",
  "sharedAccess.phones.platform.windows",
  "sharedAccess.value.stop",
  "sharedAccess.validity.dates",
  "sharedAccess.picker.minute",
]);

describe("French typography (fr.json)", () => {
  it("puts a narrow no-break space before : ; ! ?", () => {
    // A high mark followed by a space or the end must sit after U+202F.
    const bad = offenders((v) => /[^\u202f][:;!?](?=\s|$)/.test(v) || /^[:;!?]/.test(v));
    expect(bad).toEqual([]);
  });

  it("never puts a plain or no-break space before : ; ! ?", () => {
    expect(offenders((v) => /[ \u00a0][:;!?]/.test(v))).toEqual([]);
  });

  it("puts a narrow no-break space inside guillemets", () => {
    expect(offenders((v) => /«(?!\u202f)|(?<!\u202f)»/.test(v))).toEqual([]);
  });

  it("uses the ellipsis character, not three dots", () => {
    expect(offenders((v) => v.includes("..."))).toEqual([]);
  });

  it("keeps the straight apostrophe only", () => {
    expect(offenders((v) => v.includes("\u2019"))).toEqual([]);
  });

  it("writes no (s) plural", () => {
    // "(s)" glued to a word; "Lissage (s)" is a unit in seconds and stays.
    expect(offenders((v) => /\p{L}\(s\)/u.test(v))).toEqual([]);
  });

  it("passes a quantity formatted, never « {{x}} <unit> » with a plain space", () => {
    expect(offenders((v) => new RegExp(String.raw`\}\}[ \u00a0]${UNIT}`, "u").test(v))).toEqual([]);
  });

  it("puts a narrow no-break space between a figure and its unit", () => {
    expect(offenders((v) => new RegExp(String.raw`\d[ \u00a0]${UNIT}`, "u").test(v))).toEqual([]);
  });

  it("translates every value, except the ones listed as shared with English", () => {
    const leaks = Object.keys(fr_).filter((k) => fr_[k] === en_[k] && !SAME_AS_EN.has(k));
    expect(leaks, "French value equal to the English one: translate it or list it").toEqual([]);
  });

  it("lists no key that no longer exists or now differs", () => {
    const stale = [...SAME_AS_EN].filter((k) => !(k in fr_) || fr_[k] !== en_[k]);
    expect(stale).toEqual([]);
  });

  it("formats the shared colon as narrow space, colon, space", () => {
    expect(fr_["common.colon"]).toBe(`${NNBSP}: `);
  });
});
