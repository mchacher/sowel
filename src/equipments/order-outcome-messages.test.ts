import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ORDER_OUTCOME_ALARM_MESSAGES,
  wordOrderOutcomeAlarm,
  type MessageLanguage,
} from "./order-outcome-messages.js";

// Spec 188 O6 — the push is worded server side from the same strings the UI
// words the banner from. The two copies must never drift.

function uiAlarmStrings(language: MessageLanguage): Record<string, string> {
  const path = fileURLToPath(
    new URL(`../../ui/src/i18n/locales/${language}.json`, import.meta.url),
  );
  const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(all).filter(([key]) => key.startsWith("alarms.orderOutcome.")),
  );
}

describe("order outcome alarm messages", () => {
  for (const language of ["en", "fr"] as const) {
    it(`the server's ${language} copy is the UI's, key for key and word for word`, () => {
      expect(ORDER_OUTCOME_ALARM_MESSAGES[language]).toEqual(uiAlarmStrings(language));
    });
  }

  it("fills the parameters", () => {
    expect(
      wordOrderOutcomeAlarm(
        "alarms.orderOutcome.faultDetail",
        { equipment: "Porte du poulailler", detail: "TIMEOUT" },
        "fr",
      ),
    ).toBe("Porte du poulailler : défaut (TIMEOUT)");
  });

  it("returns null for a key it does not hold", () => {
    expect(wordOrderOutcomeAlarm("alarms.battery.low", {}, "fr")).toBeNull();
  });
});
