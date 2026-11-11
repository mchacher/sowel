import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, within } from "../../test-utils";
import i18n from "../../i18n";
import { TariffPriceHistory } from "./TariffPriceHistory";
import * as api from "../../api";
import { ApiError } from "../../api/client";
import type { TariffVersion } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getTariffVersions: vi.fn(),
  createTariffVersion: vi.fn(async () => ({})),
  updateTariffVersion: vi.fn(async () => ({})),
  deleteTariffVersion: vi.fn(async () => {}),
}));

const mockedList = vi.mocked(api.getTariffVersions);
const mockedCreate = vi.mocked(api.createTariffVersion);
const mockedUpdate = vi.mocked(api.updateTariffVersion);
const mockedDelete = vi.mocked(api.deleteTariffVersion);

function version(over: Partial<TariffVersion>): TariffVersion {
  return {
    id: "v",
    startDate: null,
    prices: { hp: 0.246, hc: 0.1828 },
    fixedFeeYear: 155.97,
    kva: 6,
    origin: "manual",
    createdAt: "2026-11-11T10:00:00.000Z",
    updatedAt: "2026-11-11T10:00:00.000Z",
    ...over,
  };
}

// As the server answers: oldest first, the version without a date first.
const THREE = [
  version({ id: "origin", origin: "migration" }),
  version({
    id: "y2000",
    startDate: "2000-02-01",
    prices: { hp: 0.2065, hc: 0.1578 },
    fixedFeeYear: 188.24,
  }),
  version({
    id: "y2001",
    startDate: "2001-03-01",
    prices: { hp: 0.2142, hc: 0.1589 },
    fixedFeeYear: 190.81,
  }),
];

// A household on a single rate: each version stores its one price in both.
const SINGLE_RATE = THREE.map((v) => ({ ...v, prices: { hp: v.prices.hp, hc: v.prices.hp } }));

/** The text of each cell of a table row, left to right. */
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((c) => c.textContent);

function renderHistory(contractType: "hphc" | "base" = "hphc", contractKva: number | null = 9) {
  return render(<TariffPriceHistory contractType={contractType} contractKva={contractKva} />);
}

describe("TariffPriceHistory (spec 202)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockedList.mockReset();
    mockedCreate.mockClear();
    mockedUpdate.mockClear();
    mockedDelete.mockClear();
  });

  it("lists the versions newest first, each ending the day before the next", async () => {
    mockedList.mockResolvedValue(THREE);
    renderHistory();
    const rows = await screen.findAllByTestId("tariff-version-row");
    expect(rows).toHaveLength(3);
    expect(cells(rows[0]).slice(0, 6)).toEqual([
      "Mar 1, 2001",
      "Current",
      "0.2142",
      "0.1589",
      "€190.81/year",
      "6\u00A0kVA",
    ]);
    expect(cells(rows[1]).slice(0, 2)).toEqual(["Feb 1, 2000", "Feb 28, 2001"]);
    expect(cells(rows[2]).slice(0, 2)).toEqual(["Origin", "Jan 31, 2000"]);
    // The phone list reads the same rows, the period on one line.
    const items = screen.getAllByTestId("tariff-version-item");
    expect(within(items[0]).getByText("Since Mar 1, 2001")).toBeTruthy();
    expect(within(items[1]).getByText("From Feb 1, 2000 to Feb 28, 2001")).toBeTruthy();
    expect(within(items[2]).getByText("Until Jan 31, 2000")).toBeTruthy();
  });

  it("offers no delete on the version without a date", async () => {
    mockedList.mockResolvedValue(THREE);
    renderHistory();
    const rows = await screen.findAllByTestId("tariff-version-row");
    expect(within(rows[0]).getByRole("button", { name: /^Delete the price/ })).toBeTruthy();
    expect(within(rows[2]).queryByRole("button", { name: /^Delete the price/ })).toBeNull();
    expect(
      within(rows[2]).getByRole("button", { name: "Edit the price before Feb 1, 2000" }),
    ).toBeTruthy();
  });

  it("keeps both prices of past off-peak versions under a Base contract", async () => {
    // The household moved from off-peak hours to a single rate: its past
    // versions hold two prices, which must stay visible and survive an edit.
    mockedList.mockResolvedValue(THREE);
    renderHistory("base");
    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Start", "End", "Peak", "Off-peak", "Fixed fee", "Power", "Actions"]);

    const rows = within(table).getAllByTestId("tariff-version-row");
    await userEvent.click(
      within(rows[1]).getByRole("button", { name: "Edit the price from Feb 1, 2000" }),
    );
    // Only the fee is corrected: the off-peak price is sent back untouched.
    const fee = screen.getByLabelText("Fixed fee (€/year)");
    await userEvent.clear(fee);
    await userEvent.type(fee, "189");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockedUpdate).toHaveBeenCalledWith(
      "y2000",
      expect.objectContaining({ prices: { hp: 0.2065, hc: 0.1578 }, fixedFeeYear: 189 }),
    );

    // A new change under a Base contract still asks for one price.
    await userEvent.click(await screen.findByRole("button", { name: "Add a price change" }));
    expect(screen.queryByLabelText("Off-peak price (€/kWh)")).toBeNull();
  });

  it("says in its own words that a start date is already used, without calling the server", async () => {
    mockedList.mockResolvedValue(THREE);
    renderHistory();
    await userEvent.click(await screen.findByRole("button", { name: "Add a price change" }));
    await userEvent.type(screen.getByLabelText("Start date"), "2001-03-01");
    await userEvent.type(screen.getByLabelText("Peak price (€/kWh)"), "0.2");
    await userEvent.type(screen.getByLabelText("Off-peak price (€/kWh)"), "0.1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      screen.getByText("A price already starts on this date. Edit it, or pick another date."),
    ).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("shows one price column with a Base contract, and asks for one price", async () => {
    mockedList.mockResolvedValue(SINGLE_RATE);
    renderHistory("base");
    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Start", "End", "Price", "Fixed fee", "Power", "Actions"]);
    const rows = within(table).getAllByTestId("tariff-version-row");
    expect(cells(rows[0]).slice(2, 4)).toEqual(["0.2142", "€190.81/year"]);

    await userEvent.click(screen.getByRole("button", { name: "Add a price change" }));
    expect(screen.queryByLabelText("Off-peak price (€/kWh)")).toBeNull();
    await userEvent.type(screen.getByLabelText("Start date"), "2001-08-01");
    await userEvent.type(screen.getByLabelText("Price (€/kWh)"), "0,25");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    // One price, stored as both; the fee of the latest version, the contract's power.
    expect(mockedCreate).toHaveBeenCalledWith({
      startDate: "2001-08-01",
      prices: { hp: 0.25, hc: 0.25 },
      fixedFeeYear: 190.81,
      kva: 9,
    });
  });

  it("shows the form directly, without a date, when there is no version yet", async () => {
    mockedList.mockResolvedValue([]);
    renderHistory("hphc", null);
    await userEvent.type(await screen.findByLabelText("Peak price (€/kWh)"), "0.2142");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByLabelText("Start date")).toBeNull();
    await userEvent.type(screen.getByLabelText("Off-peak price (€/kWh)"), "0.1589");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockedCreate).toHaveBeenCalledWith({
      prices: { hp: 0.2142, hc: 0.1589 },
      fixedFeeYear: null,
      kva: null,
    });
    // The list is read again after a save.
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("edits the version without a date in the same form, with no date field", async () => {
    mockedList.mockResolvedValue(THREE);
    renderHistory();
    const rows = await screen.findAllByTestId("tariff-version-row");
    await userEvent.click(within(rows[2]).getByRole("button", { name: /^Edit the price/ }));
    expect(screen.queryByLabelText("Start date")).toBeNull();
    const peak = screen.getByLabelText("Peak price (€/kWh)");
    expect((peak as HTMLInputElement).value).toBe("0.246");
    await userEvent.clear(peak);
    await userEvent.type(peak, "0.25");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockedUpdate).toHaveBeenCalledWith("origin", {
      prices: { hp: 0.25, hc: 0.1828 },
      fixedFeeYear: 155.97,
      kva: 6,
    });
  });

  it("shows the server's refusal in the form and keeps it open", async () => {
    mockedList.mockResolvedValue(THREE);
    // A refusal the form cannot foresee: another session took the date meanwhile.
    mockedCreate.mockRejectedValueOnce(new ApiError(409, "A version already starts on this date"));
    renderHistory();
    await userEvent.click(await screen.findByRole("button", { name: "Add a price change" }));
    await userEvent.type(screen.getByLabelText("Start date"), "2001-08-01");
    await userEvent.type(screen.getByLabelText("Peak price (€/kWh)"), "0.2");
    await userEvent.type(screen.getByLabelText("Off-peak price (€/kWh)"), "0.1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("A version already starts on this date")).toBeTruthy();
    expect(screen.getByLabelText("Start date")).toBeTruthy();
  });

  it("refuses a price outside 0 to 5 before asking the server", async () => {
    mockedList.mockResolvedValue(THREE);
    renderHistory();
    await userEvent.click(await screen.findByRole("button", { name: "Add a price change" }));
    await userEvent.type(screen.getByLabelText("Start date"), "2001-08-01");
    await userEvent.type(screen.getByLabelText("Peak price (€/kWh)"), "21");
    await userEvent.type(screen.getByLabelText("Off-peak price (€/kWh)"), "0.1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a price between €0 and €5 per kWh.");
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("asks before deleting a version, then deletes it by id and reloads", async () => {
    mockedList.mockResolvedValue(THREE);
    renderHistory();
    const rows = await screen.findAllByTestId("tariff-version-row");
    await userEvent.click(
      within(rows[1]).getByRole("button", { name: "Delete the price from Feb 1, 2000" }),
    );
    expect(mockedDelete).not.toHaveBeenCalled();
    await userEvent.click(
      within(rows[1]).getByRole("button", {
        name: "Confirm deleting the price from Feb 1, 2000",
      }),
    );
    expect(mockedDelete).toHaveBeenCalledWith("y2000");
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("gives up an armed delete when the user presses elsewhere", async () => {
    mockedList.mockResolvedValue(THREE);
    renderHistory();
    const rows = await screen.findAllByTestId("tariff-version-row");
    await userEvent.click(within(rows[1]).getByRole("button", { name: /^Delete the price/ }));
    await userEvent.click(screen.getByText("Prices"));
    expect(within(rows[1]).queryByRole("button", { name: /^Confirm deleting/ })).toBeNull();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("marks a last version that has not started as upcoming", async () => {
    mockedList.mockResolvedValue([...THREE, version({ id: "far", startDate: "2999-02-01" })]);
    renderHistory();
    const rows = await screen.findAllByTestId("tariff-version-row");
    expect(cells(rows[0]).slice(0, 2)).toEqual(["Feb 1, 2999", "Upcoming"]);
    expect(cells(rows[1]).slice(0, 2)).toEqual(["Mar 1, 2001", "Jan 31, 2999"]);
  });
});
