import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { TariffContractBlock } from "./TariffContractBlock";
import * as api from "../../api";
import type { PriceFileStatus, TariffContract } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getTariffContract: vi.fn(),
  saveTariffContract: vi.fn(),
  getPriceFileStatus: vi.fn(),
  checkPriceFile: vi.fn(),
}));

const mockedContract = vi.mocked(api.getTariffContract);
const mockedSave = vi.mocked(api.saveTariffContract);
const mockedStatus = vi.mocked(api.getPriceFileStatus);
const mockedCheck = vi.mocked(api.checkPriceFile);

const EDF: TariffContract = {
  supplier: "edf-tarif-bleu",
  contractType: "hphc",
  kva: 9,
  autoUpdate: true,
};
const OTHER: TariffContract = { ...EDF, supplier: "other", autoUpdate: false };

// Local noon, so the day reads the same in any timezone the tests run in.
const CHECKED_AT = new Date(2026, 10, 11, 12).toISOString();

function status(over: Partial<PriceFileStatus> = {}): PriceFileStatus {
  return {
    following: true,
    lastCheckAt: CHECKED_AT,
    lastSuccessAt: CHECKED_AT,
    error: null,
    latestStartDate: "2026-08-01",
    noPriceForContract: false,
    pending: [],
    dismissedCount: 0,
    ...over,
  };
}

/** The block with the status held by the test, as `TariffSettings` holds it. */
function renderBlock(initial: PriceFileStatus | null = null) {
  const onContract = vi.fn();
  const onStatus = vi.fn();
  const onFileRead = vi.fn();
  const props = { onContract, onStatus, onFileRead };
  const view = render(<TariffContractBlock {...props} status={initial} />);
  const show = (s: PriceFileStatus) => view.rerender(<TariffContractBlock {...props} status={s} />);
  return { onContract, onStatus, onFileRead, show };
}

const option = () =>
  screen.findByRole("checkbox", {
    name: "Update prices automatically",
  }) as Promise<HTMLInputElement>;

describe("TariffContractBlock (spec 203)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockedContract.mockReset();
    mockedSave.mockReset();
    mockedStatus.mockReset();
    mockedCheck.mockReset();
    mockedSave.mockImplementation(async (c) => ({ autoUpdate: c.supplier !== "other", ...c }));
    mockedStatus.mockResolvedValue(status());
    mockedCheck.mockResolvedValue(status());
  });

  it("reads the status with the contract and says when the file was last checked", async () => {
    mockedContract.mockResolvedValue(EDF);
    const { onStatus, show } = renderBlock();
    expect((await option()).checked).toBe(true);
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(status()));
    show(status());
    expect(screen.getByTestId("price-file-status").textContent).toBe(
      "Regulated prices published by the CRE. Last checked on Nov 11, 2026, latest known price: Aug 1, 2026.",
    );
    expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy();
  });

  it("words the status line in French as the mockup does", async () => {
    await i18n.changeLanguage("fr");
    mockedContract.mockResolvedValue(EDF);
    renderBlock(status());
    await screen.findByRole("checkbox", { name: "Mettre à jour les prix automatiquement" });
    expect(screen.getByTestId("price-file-status").textContent).toBe(
      "Prix réglementés publiés par la CRE. Dernière vérification le 11/11/2026, dernier prix connu\u202f: 01/08/2026.",
    );
    expect(screen.getByRole("button", { name: "Vérifier maintenant" })).toBeTruthy();
  });

  it("hides the option and its status for another supplier", async () => {
    mockedContract.mockResolvedValue(OTHER);
    const { onContract } = renderBlock(status({ following: false }));
    await vi.waitFor(() => expect(onContract).toHaveBeenCalledWith(OTHER));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByTestId("price-file-status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });

  it("asks for the power, and offers no check, while none is set", async () => {
    mockedContract.mockResolvedValue({ ...EDF, kva: null });
    renderBlock(status({ following: false }));
    await option();
    expect(screen.getByTestId("price-file-status").textContent).toBe(
      "Choose your subscribed power to receive the prices.",
    );
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });

  it("says the last check failed, with the last one that succeeded", async () => {
    mockedContract.mockResolvedValue(EDF);
    renderBlock(status({ error: "HTTP 503" }));
    await option();
    expect(screen.getByTestId("price-file-status").textContent).toBe(
      "The last check failed. Last successful check on Nov 11, 2026.",
    );
  });

  it("saves the option with the contract, and drops the status line when it is off", async () => {
    mockedContract.mockResolvedValue(EDF);
    const { onContract, onStatus } = renderBlock(status());
    await userEvent.click(await option());
    expect(mockedSave).toHaveBeenCalledWith({ ...EDF, autoUpdate: false });
    await vi.waitFor(() =>
      expect(onContract).toHaveBeenLastCalledWith({ ...EDF, autoUpdate: false }),
    );
    expect(screen.queryByTestId("price-file-status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
    // The status is read again for the new contract; nothing to read in the file.
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledTimes(2));
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("lets the server decide the option when the supplier changes", async () => {
    mockedContract.mockResolvedValue(OTHER);
    const { onContract, onFileRead } = renderBlock(status({ following: false }));
    await vi.waitFor(() => expect(onContract).toHaveBeenCalledWith(OTHER));
    await userEvent.selectOptions(screen.getByLabelText("Supplier"), "edf-tarif-bleu");
    // No `autoUpdate` sent: the server turns it on for a supplier of the file.
    expect(mockedSave).toHaveBeenCalledWith({
      supplier: "edf-tarif-bleu",
      contractType: "hphc",
      kva: 9,
    });
    expect((await option()).checked).toBe(true);
    // The read the server starts on a contract change is waited for.
    await vi.waitFor(() => expect(mockedCheck).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onFileRead).toHaveBeenCalledTimes(1));
  });

  it("reads the file on demand, then hands the new status and reloads the prices", async () => {
    mockedContract.mockResolvedValue(EDF);
    const fresh = status({ latestStartDate: "2027-02-01" });
    mockedCheck.mockResolvedValue(fresh);
    const { onStatus, onFileRead } = renderBlock(status());
    await option();
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(fresh));
    expect(onFileRead).toHaveBeenCalledTimes(1);
  });
});
