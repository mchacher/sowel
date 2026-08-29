import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "../../test-utils";
import i18n from "../../i18n";
import { AlarmsSheet } from "./AlarmsSheet";
import { useWebSocket, type SystemAlarm } from "../../store/useWebSocket";
import { useAckedIssues } from "../../store/useAckedIssues";

// Issue #720 — the banner used to mix hardcoded English (battery) and hardcoded
// French (integration failure), and to show a failing integration twice.

function seed(alarms: SystemAlarm[], integrationStatuses: Record<string, string> = {}) {
  useWebSocket.setState({
    alarms: new Map(alarms.map((a) => [a.alarmId, a])),
    integrationStatuses,
  });
}

const batteryAlarm: SystemAlarm = {
  alarmId: "battery-low:dd-1",
  level: "warning",
  source: "Détecteur salon",
  messageKey: "alarms.battery.lowPctOnDevice",
  messageParams: { value: "12", device: "Capteur porte" },
};

beforeEach(() => {
  seed([]);
  useAckedIssues.setState({ acked: new Set<string>() });
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("AlarmsSheet wording (#720)", () => {
  it("words a battery alarm in English", async () => {
    await i18n.changeLanguage("en");
    seed([batteryAlarm]);
    render(<AlarmsSheet open onClose={() => {}} />);

    expect(screen.getByText("Low battery: 12% (Capteur porte)")).toBeTruthy();
  });

  it("words the same alarm in French", async () => {
    await i18n.changeLanguage("fr");
    seed([batteryAlarm]);
    render(<AlarmsSheet open onClose={() => {}} />);

    expect(screen.getByText("Batterie faible : 12 % (Capteur porte)")).toBeTruthy();
    expect(screen.queryByText(/Low battery/)).toBeNull();
  });

  it("re-words the standing alarms on a language switch, without a reload", async () => {
    await i18n.changeLanguage("en");
    seed([batteryAlarm]);
    render(<AlarmsSheet open onClose={() => {}} />);
    expect(screen.getByText("Low battery: 12% (Capteur porte)")).toBeTruthy();

    // The wording is composed at render from the key, not frozen at raise time.
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    expect(screen.getByText("Batterie faible : 12 % (Capteur porte)")).toBeTruthy();
    expect(screen.queryByText(/Low battery/)).toBeNull();
  });

  it("shows a failing integration once when its alarm and its status coexist", async () => {
    await i18n.changeLanguage("fr");
    // The plugin's own `poll-fail:` alarm and the integration status describe
    // the same failure. They used to dedup under two different sources, the
    // display label against the plugin id, so the sheet listed it twice; the
    // store normalises the alarm's source to the plugin id now.
    seed(
      [
        {
          alarmId: "poll-fail:panasonic_cc",
          level: "error",
          source: "panasonic_cc",
          messageKey: "alarms.integration.error",
        },
      ],
      { panasonic_cc: "error" },
    );
    render(<AlarmsSheet open onClose={() => {}} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getAllByText("Panasonic CC")).toHaveLength(1);
    expect(screen.getAllByText(i18n.t("alarms.integration.error"))).toHaveLength(1);
    expect(screen.queryByText("Communication en échec")).toBeNull();
  });

  it("renders an engine message that has no key as it is", async () => {
    await i18n.changeLanguage("fr");
    // Order dispatch failures embed a raw driver error: nothing to compose from.
    seed([
      {
        alarmId: "order-fail:zigbee2mqtt",
        level: "error",
        source: "zigbee2mqtt",
        message: "Order dispatch failed: Volet salon open — ETIMEDOUT",
      },
    ]);
    render(<AlarmsSheet open onClose={() => {}} />);

    expect(screen.getByText("Order dispatch failed: Volet salon open — ETIMEDOUT")).toBeTruthy();
  });
});
