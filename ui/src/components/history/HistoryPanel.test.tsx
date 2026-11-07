import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { HistoryPanel } from "./HistoryPanel";
import * as api from "../../api";
import type { HistoryBindingState } from "../../types";

// Spec 196, slice 9 (pr9-graphique) — the page opens its main series over 24 h
// instead of a closed list of series.

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getHistoryStatus: vi.fn(async () => ({ enabled: true, connected: true })),
  getHistoryData: vi.fn(async () => ({ points: [], resolution: "raw", category: "temperature" })),
}));
vi.mock("./TimeSeriesChart", () => ({ TimeSeriesChart: () => <div data-testid="chart" /> }));

const binding = (alias: string, category: string): HistoryBindingState =>
  ({ bindingId: `b-${alias}`, alias, category, deviceName: "Dev", type: "number", historize: null, effectiveOn: true }) as HistoryBindingState;

const bindings = [binding("temperature", "temperature"), binding("power", "power")];

describe("HistoryPanel default series", () => {
  beforeEach(() => vi.mocked(api.getHistoryData).mockClear());

  it("opens the default series on arrival and fetches it over 24 h", async () => {
    render(<HistoryPanel equipmentId="eq-1" bindings={bindings} defaultExpandedAlias="temperature" />);
    expect(await screen.findByTestId("chart")).toBeTruthy();
    expect(api.getHistoryData).toHaveBeenCalledTimes(1);
    expect(api.getHistoryData).toHaveBeenCalledWith("eq-1", "temperature", expect.objectContaining({ from: "-24h" }));
  });

  it("keeps the list closed without a default, and lets the user close the default one", async () => {
    const { unmount } = render(<HistoryPanel equipmentId="eq-1" bindings={bindings} />);
    await screen.findByText("Power");
    expect(screen.queryByTestId("chart")).toBeNull();
    expect(api.getHistoryData).not.toHaveBeenCalled();
    unmount();

    render(<HistoryPanel equipmentId="eq-1" bindings={bindings} defaultExpandedAlias="temperature" />);
    await screen.findByTestId("chart");
    await userEvent.click(screen.getByRole("button", { name: /Temperature/ }));
    await waitFor(() => expect(screen.queryByTestId("chart")).toBeNull());
  });
});
