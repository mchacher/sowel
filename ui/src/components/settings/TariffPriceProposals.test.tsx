import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, within } from "../../test-utils";
import i18n from "../../i18n";
import { TariffPriceProposals } from "./TariffPriceProposals";
import * as api from "../../api";
import { ApiError } from "../../api/client";
import type { PriceFileRow, PriceFileStatus } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  applyPriceFilePrices: vi.fn(),
  dismissPriceFilePrices: vi.fn(),
  restoreDismissedPriceFilePrices: vi.fn(),
}));

const mockedApply = vi.mocked(api.applyPriceFilePrices);
const mockedDismiss = vi.mocked(api.dismissPriceFilePrices);
const mockedRestore = vi.mocked(api.restoreDismissedPriceFilePrices);

function row(over: Partial<PriceFileRow>): PriceFileRow {
  return {
    contractType: "hphc",
    kva: 9,
    startDate: "2026-08-01",
    hp: 0.2142,
    hc: 0.1589,
    fixedFeeYear: 239.84,
    ...over,
  };
}

// As the server answers: newest first.
const THREE = [
  row({}),
  row({ startDate: "2026-02-01", hp: 0.2065, hc: 0.1578, fixedFeeYear: 235.92 }),
  row({ startDate: "2012-07-23", hp: 0.1391, hc: 0.0964, fixedFeeYear: 119.73 }),
];

function status(over: Partial<PriceFileStatus> = {}): PriceFileStatus {
  return {
    following: true,
    lastCheckAt: "2026-11-11T03:12:00.000Z",
    lastSuccessAt: "2026-11-11T03:12:00.000Z",
    error: null,
    latestStartDate: "2026-08-01",
    noPriceForContract: false,
    pending: THREE,
    dismissedCount: 0,
    ...over,
  };
}

const NONE = status({ pending: [] });

/** The text of each cell of a table row, left to right. */
const cells = (r: HTMLElement) =>
  within(r)
    .getAllByRole("cell")
    .map((c) => c.textContent);

/** Each column header as read from `sm`: the wide label is the last one. */
const headers = () =>
  screen.getAllByRole("columnheader").map((h) => (h.lastElementChild ?? h).textContent);

function renderProposals(s: PriceFileStatus) {
  const onStatus = vi.fn();
  const onApplied = vi.fn();
  render(
    <TariffPriceProposals
      supplier="edf-tarif-bleu"
      status={s}
      onStatus={onStatus}
      onApplied={onApplied}
    />,
  );
  return { onStatus, onApplied };
}

describe("TariffPriceProposals (spec 203)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockedApply.mockReset();
    mockedDismiss.mockReset();
    mockedRestore.mockReset();
  });

  it("lists the prices to confirm newest first, under the contract they are for", () => {
    renderProposals(status());
    expect(screen.getByRole("heading", { name: "3 prices found for your contract" })).toBeTruthy();
    expect(screen.getByTestId("price-proposals-contract").textContent).toBe(
      "EDF, Tarif Bleu, off-peak hours, 9\u00A0kVA, since Jul 23, 2012. The power sets the fixed fee: check it before adding.",
    );
    expect(headers()).toEqual(["Start", "Peak", "Off-peak", "Fixed fee"]);
    const rows = screen.getAllByTestId("price-proposal-row");
    expect(rows.map((r) => cells(r)[0])).toEqual(["Aug 1, 2026", "Feb 1, 2026", "Jul 23, 2012"]);
    expect(cells(rows[0])).toEqual(["Aug 1, 2026", "0.2142", "0.1589", "€239.84/year"]);
  });

  it("words the panel in French as the mockup does", async () => {
    await i18n.changeLanguage("fr");
    renderProposals(status());
    expect(screen.getByRole("heading", { name: "3 prix trouvés pour votre contrat" })).toBeTruthy();
    expect(screen.getByTestId("price-proposals-contract").textContent).toBe(
      "EDF, Tarif Bleu, heures creuses, 9\u202fkVA, depuis le 23/07/2012. La puissance fixe l'abonnement\u202f: vérifiez-la avant d'ajouter.",
    );
    expect(screen.getByRole("button", { name: "Ajouter ces 3 prix" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ignorer" })).toBeTruthy();
  });

  it("says one price in the singular", () => {
    renderProposals(status({ pending: [THREE[0]] }));
    expect(screen.getByRole("heading", { name: "1 price found for your contract" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add this price" })).toBeTruthy();
  });

  it("shows one price column for a Base contract", () => {
    const base = THREE.map((r) => row({ ...r, contractType: "base", hc: r.hp }));
    renderProposals(status({ pending: base }));
    expect(headers()).toEqual(["Start", "Price", "Fixed fee"]);
    const rows = screen.getAllByTestId("price-proposal-row");
    expect(cells(rows[0])).toEqual(["Aug 1, 2026", "0.2142", "€239.84/year"]);
    expect(screen.getByTestId("price-proposals-contract").textContent).toMatch(
      /^EDF, Tarif Bleu, single rate, /,
    );
  });

  it("adds every price to confirm, then hands the new status and reloads the price list", async () => {
    mockedApply.mockResolvedValue({ created: [], status: NONE });
    const { onStatus, onApplied } = renderProposals(status());
    await userEvent.click(screen.getByRole("button", { name: "Add these 3 prices" }));
    expect(mockedApply).toHaveBeenCalledWith(["2026-08-01", "2026-02-01", "2012-07-23"]);
    expect(onStatus).toHaveBeenCalledWith(NONE);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(mockedDismiss).not.toHaveBeenCalled();
  });

  it("sets every price to confirm aside, without touching the price list", async () => {
    const after = status({ pending: [], dismissedCount: 3 });
    mockedDismiss.mockResolvedValue(after);
    const { onStatus, onApplied } = renderProposals(status());
    await userEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(mockedDismiss).toHaveBeenCalledWith(["2026-08-01", "2026-02-01", "2012-07-23"]);
    expect(onStatus).toHaveBeenCalledWith(after);
    expect(onApplied).not.toHaveBeenCalled();
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it("shows the server's refusal in the panel and keeps the prices", async () => {
    mockedApply.mockRejectedValue(new ApiError(400, "2026-08-01 is not a pending price"));
    const { onStatus, onApplied } = renderProposals(status());
    await userEvent.click(screen.getByRole("button", { name: "Add these 3 prices" }));
    const panel = screen.getByTestId("price-proposals");
    expect(within(panel).getByRole("alert").textContent).toBe("2026-08-01 is not a pending price");
    expect(onStatus).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("price-proposal-row")).toHaveLength(3);
  });

  it("disables both buttons while one runs", async () => {
    let finish: (s: PriceFileStatus) => void = () => {};
    mockedDismiss.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderProposals(status());
    const add = screen.getByRole("button", { name: "Add these 3 prices" }) as HTMLButtonElement;
    const ignore = screen.getByRole("button", { name: "Ignore" }) as HTMLButtonElement;
    await userEvent.click(ignore);
    expect(add.disabled).toBe(true);
    expect(ignore.disabled).toBe(true);
    finish(NONE);
    await vi.waitFor(() => expect(add.disabled).toBe(false));
  });

  it("offers to propose again the prices set aside, once none waits", async () => {
    const restored = status();
    mockedRestore.mockResolvedValue(restored);
    const { onStatus } = renderProposals(status({ pending: [], dismissedCount: 23 }));
    expect(screen.queryByTestId("price-proposals")).toBeNull();
    expect(screen.getByText("23 prices ignored.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Offer them again" }));
    expect(mockedRestore).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(restored);
  });

  it("shows nothing when no price waits and none was set aside", () => {
    const { container } = render(
      <TariffPriceProposals
        supplier="edf-tarif-bleu"
        status={NONE}
        onStatus={() => {}}
        onApplied={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("does not offer the prices set aside when the contract no longer follows the file", () => {
    renderProposals(status({ following: false, pending: [], dismissedCount: 23 }));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
