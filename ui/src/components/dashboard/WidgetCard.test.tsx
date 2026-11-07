import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, userEvent } from "../../test-utils";
import { WidgetCard } from "./WidgetCard";
import { EquipmentDetailSheet } from "./WidgetDetailSheet";
import { TileEquipmentContext } from "../equipments/order-outcome";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";

// Spec 196, slice 9 (pr9-dashboard) — the dashboard links to the equipment page:
// the tile title on desktop, the foot of the sheet on a phone.

const sensor: EquipmentWithDetails = {
  id: "eq-1",
  name: "Capteur salon",
  type: "sensor",
  zoneId: "z-1",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "online",
  dataBindings: [],
  orderBindings: [],
};

describe("dashboard link to the equipment page", () => {
  it("makes an equipment tile's title a link, which does not fire the tile action", async () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <TileEquipmentContext.Provider value="eq-1">
          <WidgetCard label="Capteur salon" onClick={onClick}>
            <p>body</p>
          </WidgetCard>
        </TileEquipmentContext.Provider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Capteur salon" });
    expect(link.getAttribute("href")).toBe("/equipments/eq-1");
    await userEvent.click(link);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps a plain title on a phone, where the whole tile is the tap action", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 639px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const onClick = vi.fn();
      render(
        <MemoryRouter>
          <TileEquipmentContext.Provider value="eq-1">
            <WidgetCard label="Capteur salon" onClick={onClick}>
              <p>body</p>
            </WidgetCard>
          </TileEquipmentContext.Provider>
        </MemoryRouter>,
      );
      expect(screen.queryByRole("link")).toBeNull();
      await userEvent.click(screen.getByText("Capteur salon"));
      expect(onClick).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = original;
    }
  });

  it("keeps a plain title on a tile that is not an equipment", () => {
    render(
      <MemoryRouter>
        <WidgetCard label="Salon">
          <p>body</p>
        </WidgetCard>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Salon")).toBeTruthy();
  });

  it("ends the equipment sheet with « Open the page »", () => {
    const widget = {
      id: "w-1",
      type: "equipment",
      equipmentId: "eq-1",
      label: "",
    } as unknown as DashboardWidget;
    render(
      <MemoryRouter>
        <EquipmentDetailSheet
          widget={widget}
          equipment={sensor}
          equipmentZone="Salon"
          onExecuteOrder={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Open the page/ });
    expect(link.getAttribute("href")).toBe("/equipments/eq-1");
  });
});
