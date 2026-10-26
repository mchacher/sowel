import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { EquipmentWidget } from "../dashboard/EquipmentWidget";
import { MobileWidgetCard } from "../dashboard/MobileWidgetCard";
import { TimedEquipmentWidget } from "../dashboard/TimedEquipmentWidget";
import { TileEquipmentContext } from "./order-outcome";
import {
  CONFIRMED_SHOWN_MS,
  IN_FLIGHT_SHOWN_MS,
  useOrderOutcomes,
} from "../../store/useOrderOutcomes";
import type {
  DashboardWidget,
  EquipmentWithDetails,
  OrderOutcomeExpected,
  OrderOutcomeStatus,
} from "../../types";

// Spec 188 O5 — the status line of an equipment's last tracked order, on the
// tile (desktop, phone, timed) and fed by the WebSocket outcome.

const gate = {
  id: "eq-gate",
  name: "Portail",
  zoneId: "z-1",
  type: "gate",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "online",
  dataBindings: [
    {
      id: "db-1",
      equipmentId: "eq-gate",
      deviceDataId: "dd-1",
      alias: "state",
      deviceId: "dev-1",
      deviceName: "portail",
      key: "state",
      type: "enum",
      category: "gate_state",
      value: "closed",
      lastUpdated: "2026-01-01T00:00:00Z",
      lastChanged: "2026-01-01T00:00:00Z",
      stale: false,
    },
  ],
  orderBindings: [
    {
      id: "ob-1",
      equipmentId: "eq-gate",
      deviceOrderId: "do-1",
      alias: "command",
      deviceId: "dev-1",
      deviceName: "portail",
      key: "command",
      type: "enum",
      category: "gate_trigger",
      enumValues: ["pulse"],
    },
  ],
} as unknown as EquipmentWithDetails;

const widget: DashboardWidget = {
  id: "w-1",
  type: "equipment",
  equipmentId: "eq-gate",
  displayOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
} as DashboardWidget;

const outcome = (
  status: OrderOutcomeStatus,
  opts: { expected?: OrderOutcomeExpected; value?: unknown; detail?: string } = {},
) =>
  act(() =>
    useOrderOutcomes.getState().handleOutcome({
      equipmentId: "eq-gate",
      orderAlias: "command",
      value: opts.value ?? "pulse",
      status,
      expected: opts.expected ?? "open",
      ...(opts.detail ? { detail: opts.detail } : {}),
    }),
  );

const executed = () =>
  act(() => useOrderOutcomes.getState().handleOrderExecuted("eq-gate", "command"));

afterEach(async () => {
  vi.useRealTimers();
  useOrderOutcomes.setState({ byEquipment: {} });
  await i18n.changeLanguage("en");
});

const tile = () =>
  render(<EquipmentWidget widget={widget} equipment={gate} onExecuteOrder={vi.fn()} />);

describe("order outcome status line", () => {
  it("shows nothing for an order the engine does not track", async () => {
    await i18n.changeLanguage("en");
    tile();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["pending", "open", "pulse", undefined, "Sent…"],
    ["moving", "close", "CLOSE", undefined, "Moving…"],
    ["confirmed", "open", "pulse", undefined, "Opening confirmed"],
    ["confirmed", "close", "CLOSE", undefined, "Closing confirmed"],
    ["fault", "close", "CLOSE", undefined, "Fault"],
    ["fault", "close", "CLOSE", "BOTTOM", "Fault: bottom contact"],
    ["fault", "close", "CLOSE", "JAMMED", "Fault: JAMMED"],
    ["unconfirmed", "open", "OPEN", undefined, "No confirmation"],
    ["unconfirmed", "open", "pulse", undefined, "No movement: command lost or gate blocked"],
    [
      "unconfirmed",
      "close",
      "pulse",
      undefined,
      "Still open: command lost or gate stopped on the way",
    ],
  ] as const)(
    "reads %s (%s, %s, %s) as « %s » on the tile",
    async (status, expected, value, detail, text) => {
      await i18n.changeLanguage("en");
      tile();
      outcome(status, { expected, value, ...(detail ? { detail } : {}) });
      expect(screen.getByRole("status").textContent).toBe(text);
    },
  );

  it.each([
    ["pending", "open", "pulse", undefined, "Envoyée…"],
    ["moving", "close", "CLOSE", undefined, "En mouvement…"],
    ["confirmed", "open", "pulse", undefined, "Ouverture confirmée"],
    ["confirmed", "close", "pulse", undefined, "Fermeture confirmée"],
    ["fault", "close", "CLOSE", "WIRING", "Défaut : câblage"],
    ["fault", "close", "CLOSE", "BOTTOM", "Défaut : contact bas"],
    ["unconfirmed", "close", "CLOSE", undefined, "Sans confirmation"],
    [
      "unconfirmed",
      "open",
      "pulse",
      undefined,
      "Pas de mouvement : commande perdue ou portail bloqué",
    ],
    [
      "unconfirmed",
      "close",
      "pulse",
      undefined,
      "Toujours ouvert : commande perdue ou portail arrêté en route",
    ],
  ] as const)(
    "reads %s (%s, %s, %s) as « %s » in French on the phone card",
    async (status, expected, value, detail, text) => {
      await i18n.changeLanguage("fr");
      render(<MobileWidgetCard widget={widget} equipment={gate} />);
      outcome(status, { expected, value, ...(detail ? { detail } : {}) });
      expect(screen.getByRole("status").textContent).toBe(text);
    },
  );

  it("clears « Opening confirmed » after 4 s, and keeps an unconfirmed until the next order", async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    tile();
    outcome("pending");
    outcome("confirmed");
    act(() => vi.advanceTimersByTime(CONFIRMED_SHOWN_MS - 1));
    expect(screen.getByRole("status").textContent).toBe("Opening confirmed");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();

    outcome("pending");
    outcome("unconfirmed");
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(screen.getByRole("status").textContent).toBe(
      "No movement: command lost or gate blocked",
    );
    // The next order, even one the engine does not track, ends it.
    executed();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a new order's spinner when its executed event arrives after it", async () => {
    await i18n.changeLanguage("en");
    tile();
    outcome("unconfirmed");
    outcome("pending");
    executed();
    expect(screen.getByRole("status").textContent).toBe("Sent…");
  });

  it("does not let an old confirmation's timer clear a newer order's line", async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    tile();
    outcome("confirmed");
    act(() => vi.advanceTimersByTime(2000));
    outcome("pending");
    act(() => vi.advanceTimersByTime(CONFIRMED_SHOWN_MS));
    expect(screen.getByRole("status").textContent).toBe("Sent…");
  });

  it("keeps the gate's state on the phone card beside the outcome line", async () => {
    await i18n.changeLanguage("en");
    render(<MobileWidgetCard widget={widget} equipment={gate} />);
    const closed = screen.getByText(/closed/i).textContent;
    outcome("pending");
    expect(screen.getByRole("status").textContent).toBe("Sent…");
    expect(screen.getByText(/closed/i).textContent).toBe(closed);
  });

  it("draws the line on a timed tile too", async () => {
    await i18n.changeLanguage("en");
    const timed = {
      ...gate,
      timedCommand: { alias: "command", value: null, revertValue: null, durationMs: 900_000 },
    } as unknown as EquipmentWithDetails;
    render(
      <TileEquipmentContext.Provider value="eq-gate">
        <TimedEquipmentWidget label="Portail" equipment={timed} />
      </TileEquipmentContext.Provider>,
    );
    outcome("unconfirmed", { value: "CLOSE" });
    expect(screen.getByRole("status").textContent).toBe("No confirmation");
  });

  it("drops a spinner 70 s after the order, moving included, and every spinner on a reconnect", async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    tile();
    outcome("pending", { value: "CLOSE", expected: "close" });
    act(() => vi.advanceTimersByTime(30_000));
    outcome("moving", { value: "CLOSE", expected: "close" });
    act(() => vi.advanceTimersByTime(IN_FLIGHT_SHOWN_MS - 30_000 - 1));
    expect(screen.getByRole("status").textContent).toBe("Moving…");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();

    outcome("pending");
    act(() => useOrderOutcomes.getState().expireInFlight());
    expect(screen.queryByRole("status")).toBeNull();
    // A final status survives the reconnect.
    outcome("fault", { value: "CLOSE", detail: "BOTTOM" });
    act(() => useOrderOutcomes.getState().expireInFlight());
    expect(screen.getByRole("status").textContent).toBe("Fault: bottom contact");
  });
});
