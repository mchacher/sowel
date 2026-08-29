import { describe, it, expect } from "vitest";
import i18n from "../i18n";
import { alarmText, dayParam, wordingSignature } from "./alarm-message";

// Issue #720 — the banner used to hold pre-composed strings, in whatever
// language happened to be active when the alarm was raised (and, for the
// integration failure, in French whatever the user's language).
const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params ?? {});

describe("alarmText", () => {
  it("translates an alarm that carries a key and its parameters", async () => {
    await i18n.changeLanguage("en");
    const wording = {
      messageKey: "alarms.battery.lowPctOnDevice",
      messageParams: { value: "12", device: "Capteur porte" },
    };
    expect(alarmText(t, wording)).toBe("Low battery: 12% (Capteur porte)");

    await i18n.changeLanguage("fr");
    expect(alarmText(t, wording)).toBe("Batterie faible : 12 % (Capteur porte)");
  });

  it("formats a day parameter in the active locale", async () => {
    const wording = {
      messageKey: "equipments.pvHealth.alarmBanner",
      messageParams: { pct: 25, since: dayParam("2026-08-23") },
    };

    await i18n.changeLanguage("fr");
    expect(alarmText(t, wording)).toContain("23 août");

    await i18n.changeLanguage("en");
    expect(alarmText(t, wording)).toContain("August 23");
  });

  it("falls back to the engine text when there is no key", async () => {
    await i18n.changeLanguage("fr");
    // Order dispatch failures embed a raw driver error and have no structured
    // form to compose from, so the engine's English is all there is.
    expect(alarmText(t, { message: "Order dispatch failed: Volet salon open — ETIMEDOUT" })).toBe(
      "Order dispatch failed: Volet salon open — ETIMEDOUT",
    );
  });

  it("renders an empty string rather than undefined when both are missing", () => {
    expect(alarmText(t, {})).toBe("");
  });
});

describe("wordingSignature", () => {
  it("is language-independent for a keyed alarm", async () => {
    const wording = { messageKey: "alarms.battery.lowPct", messageParams: { value: "12" } };
    await i18n.changeLanguage("en");
    const en = wordingSignature(wording);
    await i18n.changeLanguage("fr");
    expect(wordingSignature(wording)).toBe(en);
  });

  it("changes when a parameter changes, so a worsening battery re-surfaces", () => {
    const at = (value: string) =>
      wordingSignature({ messageKey: "alarms.battery.lowPct", messageParams: { value } });
    expect(at("12")).not.toBe(at("5"));
  });

  it("does not depend on the order the parameters were built in", () => {
    const a = wordingSignature({
      messageKey: "k",
      messageParams: { value: "12", device: "Capteur" },
    });
    const b = wordingSignature({
      messageKey: "k",
      messageParams: { device: "Capteur", value: "12" },
    });
    expect(a).toBe(b);
  });

  it("signs a day parameter on the day itself, not on its rendering", async () => {
    const wording = { messageKey: "k", messageParams: { since: dayParam("2026-08-23") } };
    await i18n.changeLanguage("en");
    const en = wordingSignature(wording);
    await i18n.changeLanguage("fr");
    expect(wordingSignature(wording)).toBe(en);
    expect(en).toContain("2026-08-23");
  });
});
