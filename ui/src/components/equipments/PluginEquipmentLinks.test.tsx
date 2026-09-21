import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "../../test-utils";
import { PluginEquipmentLinks } from "./PluginEquipmentLinks";
import type { EquipmentWithDetails, PluginPageInfo } from "../../types";

const pages: PluginPageInfo[] = [
  {
    pluginId: "guest-access",
    label: "Accès partagés",
    icon: "DoorOpen",
    placement: "main",
    equipmentTypes: ["gate"],
    entryUrl: "/plugin-ui/guest-access/panel.js?v=1.4.0",
  },
  {
    pluginId: "other",
    label: "Autre",
    icon: "Puzzle",
    placement: "admin",
    equipmentTypes: [],
    entryUrl: "/plugin-ui/other/panel.js?v=1.0.0",
  },
];

vi.mock("../layout/usePluginPages", () => ({ usePluginPages: () => pages }));

const gate = { id: "eq-7", name: "Portail", type: "gate" } as EquipmentWithDetails;

function answer(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

afterEach(() => vi.restoreAllMocks());

// Spec 180 R1.6.ter — the core draws the card; the words are the plugin's.
describe("PluginEquipmentLinks", () => {
  it("draws a card for the page that asked for this type, with the plugin's sentence and link", async () => {
    const fetchMock = answer({ text: "3 personnes peuvent ouvrir ce portail avec un code.", action: "Gérer les accès" });
    render(<MemoryRouter><PluginEquipmentLinks equipment={gate} /></MemoryRouter>);

    expect(await screen.findByText("3 personnes peuvent ouvrir ce portail avec un code.")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Gérer les accès/ });
    expect(link.getAttribute("href")).toBe("/plugins/guest-access/page?equipment=eq-7");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/v1\/plugins\/guest-access\/page\/equipment-link\?equipmentId=eq-7&lang=/);
    // Only the page that asked — not every plugin page.
    expect(screen.queryByText("Autre")).toBeNull();
  });

  it("still links when the plugin does not answer", async () => {
    answer({ error: "not_found" }, 404);
    render(<MemoryRouter><PluginEquipmentLinks equipment={gate} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("link").getAttribute("href")).toBe("/plugins/guest-access/page?equipment=eq-7"));
    expect(screen.getByText("Accès partagés")).toBeTruthy();
  });

  it("draws nothing on an equipment type nobody asked for", () => {
    answer({});
    const { container } = render(
      <MemoryRouter><PluginEquipmentLinks equipment={{ ...gate, type: "light_onoff" } as EquipmentWithDetails} /></MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});
