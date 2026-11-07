import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { ActivityItemRow } from "./ActivityItemRow";
import { displayValue } from "../../lib/activity-log";
import type { ActivityItem } from "../../types";

// Spec 188 O6 — an order-outcome alarm reads in the viewer's language in the
// activity feed too; any other alarm keeps the engine's text.

function alarm(params: Extract<ActivityItem["message"], { template: "alarm.raised" }>["params"]) {
  const item: ActivityItem = {
    id: "a1",
    timestamp: Date.parse("2026-10-26T10:00:00Z"),
    category: "alarm",
    zoneId: null,
    message: { template: "alarm.raised", params },
  };
  return item;
}

describe("ActivityItemRow — alarms", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("words an order-outcome alarm from its key, in French", async () => {
    await i18n.changeLanguage("fr");
    render(
      <ActivityItemRow
        item={alarm({
          source: "order-confirmation",
          message: "Portail: still open after the command — lost or stopped on the way",
          messageKey: "alarms.orderOutcome.unconfirmedStillOpen",
          messageParams: { equipment: "Portail" },
        })}
      />,
    );
    expect(
      screen.getByText(/Portail : toujours ouvert après la commande — perdue ou arrêtée en route/),
    ).toBeTruthy();
  });

  it("keeps the engine's text for a key on any other source", async () => {
    await i18n.changeLanguage("fr");
    render(
      <ActivityItemRow
        item={alarm({
          source: "some-plugin",
          message: "Something the plugin said",
          messageKey: "alarms.orderOutcome.fault",
          messageParams: { equipment: "Portail" },
        })}
      />,
    );
    expect(screen.getByText(/Something the plugin said/)).toBeTruthy();
  });
});

// Spec 196, slice 7c — the log writes an order's value like the rest of the UI.
describe("ActivityItemRow — order values", () => {
  afterEach(async () => {
    await i18n.changeLanguage("fr");
  });

  it("reads ON / OFF as Marche / Arrêt, numbers the French way, setpoints in degrees", async () => {
    await i18n.changeLanguage("fr");
    const t = i18n.t.bind(i18n) as (k: string, o?: Record<string, unknown>) => string;
    expect(displayValue("ON", "state", t)).toBe("Marche");
    expect(displayValue("OFF", "state", t)).toBe("Arrêt");
    expect(displayValue("20.5", "setpoint", t)).toBe("20,5°");
    expect(displayValue("1234.5", "power", t)).toBe("1\u202f234,5");
    expect(displayValue("V2", "speed", t)).toBe("V2");
  });
});
