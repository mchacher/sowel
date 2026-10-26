import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { EquipmentWidget } from "../dashboard/EquipmentWidget";
import { MobileWidgetCard } from "../dashboard/MobileWidgetCard";
import { DELIVERED_SHOWN_MS, useOrderReceipts } from "../../store/useOrderReceipts";
import type { DashboardWidget, EquipmentWithDetails, OrderReceiptStatus } from "../../types";

// Spec 188 R4 — the status line of an equipment's last order, on the tile
// (desktop and phone), fed by the WebSocket receipt.

const gate = {
  id: "eq-gate",
  name: "Portail",
  zoneId: "z-1",
  type: "gate",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "online",
  dataBindings: [],
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

const receive = (status: OrderReceiptStatus) =>
  act(() => useOrderReceipts.getState().handleReceipt("eq-gate", "command", status));

afterEach(async () => {
  vi.useRealTimers();
  useOrderReceipts.setState({ byEquipment: {} });
  await i18n.changeLanguage("en");
});

describe("order receipt status line", () => {
  it("shows nothing until the device answers", async () => {
    await i18n.changeLanguage("en");
    render(<EquipmentWidget widget={widget} equipment={gate} onExecuteOrder={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["pending", "Sent…"],
    ["received", "Received…"],
    ["delivered", "Confirmed"],
    ["refused", "Refused by the device"],
    ["not_received", "Not received"],
    ["unconfirmed", "No confirmation"],
  ] as const)("reads %s as « %s » on the tile", async (status, text) => {
    await i18n.changeLanguage("en");
    render(<EquipmentWidget widget={widget} equipment={gate} onExecuteOrder={vi.fn()} />);
    receive(status);
    expect(screen.getByRole("status").textContent).toBe(text);
  });

  it.each([
    ["pending", "Envoyée…"],
    ["received", "Reçue…"],
    ["delivered", "Confirmée"],
    ["refused", "Refusée par l'appareil"],
    ["not_received", "Non reçue"],
    ["unconfirmed", "Sans confirmation"],
  ] as const)("reads %s as « %s » in French on the phone card", async (status, text) => {
    await i18n.changeLanguage("fr");
    render(<MobileWidgetCard widget={widget} equipment={gate} />);
    receive(status);
    expect(screen.getByRole("status").textContent).toBe(text);
  });

  it("clears « Confirmed » after 4 s, and keeps a failure until the next order", async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    render(<EquipmentWidget widget={widget} equipment={gate} onExecuteOrder={vi.fn()} />);
    receive("pending");
    receive("delivered");
    act(() => vi.advanceTimersByTime(DELIVERED_SHOWN_MS - 1));
    expect(screen.getByRole("status").textContent).toBe("Confirmed");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();

    receive("pending");
    receive("unconfirmed");
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("status").textContent).toBe("No confirmation");
    receive("pending");
    expect(screen.getByRole("status").textContent).toBe("Sent…");
  });

  it("does not let an old confirmation's timer clear a newer order's line", async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    render(<EquipmentWidget widget={widget} equipment={gate} onExecuteOrder={vi.fn()} />);
    receive("delivered");
    act(() => vi.advanceTimersByTime(2000));
    receive("pending");
    act(() => vi.advanceTimersByTime(DELIVERED_SHOWN_MS));
    expect(screen.getByRole("status").textContent).toBe("Sent…");
  });
});
