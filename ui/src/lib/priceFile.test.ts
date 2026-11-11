import { describe, it, expect } from "vitest";
import { canCheckPriceFile, followsPriceFile, priceFileStatusLine } from "./priceFile";
import type { PriceFileStatus, TariffContract } from "../types";

const CONTRACT: TariffContract = {
  supplier: "edf-tarif-bleu",
  contractType: "hphc",
  kva: 9,
  autoUpdate: true,
};

function status(over: Partial<PriceFileStatus> = {}): PriceFileStatus {
  return {
    following: true,
    lastCheckAt: "2026-11-11T03:12:00.000Z",
    lastSuccessAt: "2026-11-11T03:12:00.000Z",
    error: null,
    latestStartDate: "2026-08-01",
    noPriceForContract: false,
    pending: [],
    dismissedCount: 0,
    ...over,
  };
}

describe("followsPriceFile (spec 203)", () => {
  it("needs a supplier of the file, the option on and a power", () => {
    expect(followsPriceFile(CONTRACT)).toBe(true);
    expect(followsPriceFile({ ...CONTRACT, supplier: "other" })).toBe(false);
    expect(followsPriceFile({ ...CONTRACT, autoUpdate: false })).toBe(false);
    expect(followsPriceFile({ ...CONTRACT, kva: null })).toBe(false);
  });
});

describe("priceFileStatusLine (spec 203)", () => {
  it("shows nothing for a supplier that is not in the file", () => {
    const contract = { ...CONTRACT, supplier: "other" as const, autoUpdate: false };
    expect(priceFileStatusLine(contract, status({ following: false }))).toBeNull();
    // Even if the option came back on: the supplier has no file to follow.
    expect(priceFileStatusLine({ ...contract, autoUpdate: true }, status())).toBeNull();
  });

  it("shows nothing when the option is off", () => {
    const line = priceFileStatusLine({ ...CONTRACT, autoUpdate: false }, status());
    expect(line).toBeNull();
    expect(canCheckPriceFile(line)).toBe(false);
  });

  it("asks for the power when none is set, before any status is read", () => {
    const line = priceFileStatusLine({ ...CONTRACT, kva: null }, null);
    expect(line).toEqual({ kind: "noPower" });
    expect(priceFileStatusLine({ ...CONTRACT, kva: null }, status({ following: false }))).toEqual({
      kind: "noPower",
    });
    // Nothing can be matched in the file without a power: no read to ask for.
    expect(canCheckPriceFile(line)).toBe(false);
  });

  it("shows nothing while the status is not read yet", () => {
    expect(priceFileStatusLine(CONTRACT, null)).toBeNull();
  });

  it("says the file was never checked", () => {
    const line = priceFileStatusLine(
      CONTRACT,
      status({ lastCheckAt: null, lastSuccessAt: null, latestStartDate: null }),
    );
    expect(line).toEqual({ kind: "neverChecked" });
    expect(canCheckPriceFile(line)).toBe(true);
  });

  it("gives the last check and the latest price known after a successful read", () => {
    expect(priceFileStatusLine(CONTRACT, status())).toEqual({
      kind: "checked",
      lastCheckAt: "2026-11-11T03:12:00.000Z",
      latestStartDate: "2026-08-01",
    });
  });

  it("keeps the last check without a latest price until the file is read again", () => {
    // After a restart the server knows when it last read, not what the file held.
    expect(priceFileStatusLine(CONTRACT, status({ latestStartDate: null }))).toEqual({
      kind: "checked",
      lastCheckAt: "2026-11-11T03:12:00.000Z",
      latestStartDate: null,
    });
  });

  it("says the file has no price for this contract type and power", () => {
    const line = priceFileStatusLine(
      CONTRACT,
      status({ noPriceForContract: true, latestStartDate: null }),
    );
    expect(line).toEqual({ kind: "noPrice" });
    expect(canCheckPriceFile(line)).toBe(true);
  });

  it("says the last check failed, with the last one that succeeded", () => {
    const line = priceFileStatusLine(
      CONTRACT,
      status({
        lastCheckAt: "2026-11-11T03:12:00.000Z",
        lastSuccessAt: "2026-11-09T03:12:00.000Z",
        error: "HTTP 503",
      }),
    );
    expect(line).toEqual({ kind: "failed", lastSuccessAt: "2026-11-09T03:12:00.000Z" });
    expect(canCheckPriceFile(line)).toBe(true);
  });

  it("says the last check failed and that none has succeeded yet", () => {
    expect(
      priceFileStatusLine(
        CONTRACT,
        status({ lastSuccessAt: null, error: "fetch failed", latestStartDate: null }),
      ),
    ).toEqual({ kind: "failed", lastSuccessAt: null });
  });

  it("lets a failure win over a file read earlier that had no price", () => {
    expect(
      priceFileStatusLine(CONTRACT, status({ error: "HTTP 503", noPriceForContract: true })),
    ).toEqual({ kind: "failed", lastSuccessAt: "2026-11-11T03:12:00.000Z" });
  });
});
