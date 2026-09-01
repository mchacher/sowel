/**
 * Spec 173 — declaring that a meter is already counted by another one.
 *
 * The panel's real job is the list it offers: a loop is refused by the API with
 * a 400, but an option a user can pick and that always fails is a worse UI than
 * an option that was never there.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { MeteringParentPanel } from "./MeteringParentPanel";
import * as api from "../../api";
import type { EquipmentWithDetails } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  updateEquipment: vi.fn().mockResolvedValue({}),
}));

function meter(over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "m",
    name: "Meter",
    zoneId: "z1",
    type: "energy_meter",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [],
    orderBindings: [],
    ...over,
  } as EquipmentWithDetails;
}

const gite = meter({ id: "gite", name: "ConsommationGite" });
const ce = meter({ id: "ce", name: "ConsommationChauffeEau", meteringParentId: "gite" });
const plaque = meter({ id: "plaque", name: "ConsommationPlaqueGite" });
const edf = meter({ id: "edf", name: "EDF", type: "main_energy_meter" });
const lamp = meter({ id: "lamp", name: "Lampe", type: "light_onoff" });

const ALL = [gite, ce, plaque, edf, lamp];

function options(): string[] {
  return Array.from(screen.getByRole("combobox").querySelectorAll("option")).map(
    (o) => o.textContent ?? "",
  );
}

describe("MeteringParentPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers the other meters, and never one that would close a loop", () => {
    render(<MeteringParentPanel equipment={gite} equipments={ALL} onUpdated={() => {}} />);
    const shown = options();

    expect(shown).toContain("ConsommationPlaqueGite");
    // Not itself, not its own child (that is the loop), not the house total,
    // and not a lamp that measures nothing.
    expect(shown).not.toContain("ConsommationGite");
    expect(shown).not.toContain("ConsommationChauffeEau");
    expect(shown).not.toContain("EDF");
    expect(shown).not.toContain("Lampe");
    // Always a way out.
    expect(shown[0]).toBe("Nothing, counted nowhere else");
  });

  it("shows the current declaration", () => {
    render(<MeteringParentPanel equipment={ce} equipments={ALL} onUpdated={() => {}} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("gite");
  });

  it("keeps showing a declared parent that stopped being a meter", () => {
    // The gîte clamp lost its power binding: it is no longer offered as a new
    // parent, but the declaration on the water heater is still live, and a
    // select matching no option would quietly read "counted nowhere else".
    const gone = meter({ id: "gite", name: "ConsommationGite", type: "light_onoff" });
    render(
      <MeteringParentPanel equipment={ce} equipments={[gone, ce, plaque]} onUpdated={() => {}} />,
    );

    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("gite");
    expect(options()).toContain("ConsommationGite");
  });

  it("saves a chosen parent", async () => {
    const onUpdated = vi.fn();
    render(<MeteringParentPanel equipment={plaque} equipments={ALL} onUpdated={onUpdated} />);

    await userEvent.selectOptions(screen.getByRole("combobox"), "gite");

    expect(api.updateEquipment).toHaveBeenCalledWith("plaque", { meteringParentId: "gite" });
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
  });

  it("sends null when the declaration is withdrawn", async () => {
    render(<MeteringParentPanel equipment={ce} equipments={ALL} onUpdated={() => {}} />);

    await userEvent.selectOptions(screen.getByRole("combobox"), "");

    // null, not "": the API keeps the stored value on undefined and clears it
    // on null.
    expect(api.updateEquipment).toHaveBeenCalledWith("ce", { meteringParentId: null });
  });

  it("surfaces a refusal from the API instead of pretending it saved", async () => {
    vi.mocked(api.updateEquipment).mockRejectedValueOnce(new Error("MeteringParentCycle"));
    render(<MeteringParentPanel equipment={plaque} equipments={ALL} onUpdated={() => {}} />);

    await userEvent.selectOptions(screen.getByRole("combobox"), "gite");

    expect(await screen.findByText("MeteringParentCycle")).toBeTruthy();
  });
});
