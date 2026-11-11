import type { PriceFileStatus, TariffContract } from "../types";

// Spec 203 (FR3, FR6) — what the contract block says under « Mettre à jour les
// prix automatiquement », apart from how it is worded and drawn.

/** The one sentence of the status line. Dates are as the server gave them. */
export type PriceFileStatusLine =
  /** The option is on and no power is chosen: nothing can be matched in the file. */
  | { kind: "noPower" }
  /** The file was never read. */
  | { kind: "neverChecked" }
  /**
   * The last read succeeded. `latestStartDate` is null until the file is read
   * again after a restart: the server keeps the time of the read, not the file.
   */
  | { kind: "checked"; lastCheckAt: string; latestStartDate: string | null }
  /** The file was read and has no price for this contract type and power. */
  | { kind: "noPrice" }
  /** The last read failed; `lastSuccessAt` is null when none ever succeeded. */
  | { kind: "failed"; lastSuccessAt: string | null };

/** Sowel follows the file: a supplier of the file, the option on, a power set (FR3). */
export function followsPriceFile(
  contract: Pick<TariffContract, "supplier" | "autoUpdate" | "kva">,
): boolean {
  return contract.supplier !== "other" && contract.autoUpdate && contract.kva != null;
}

/**
 * The status line of a contract, or null when there is none to show: the
 * supplier is not in the file, the option is off, or the status is not read yet.
 *
 * The contract decides whether there is a line (it changes at once when the
 * user changes it); the status says where the read stands.
 */
export function priceFileStatusLine(
  contract: Pick<TariffContract, "supplier" | "autoUpdate" | "kva">,
  status: PriceFileStatus | null,
): PriceFileStatusLine | null {
  if (contract.supplier === "other" || !contract.autoUpdate) return null;
  if (contract.kva == null) return { kind: "noPower" };
  if (status === null) return null;
  if (status.error !== null) return { kind: "failed", lastSuccessAt: status.lastSuccessAt };
  if (status.lastCheckAt === null) return { kind: "neverChecked" };
  if (status.noPriceForContract) return { kind: "noPrice" };
  return {
    kind: "checked",
    lastCheckAt: status.lastCheckAt,
    latestStartDate: status.latestStartDate,
  };
}

/** A read of the file can bring something: the line exists and a power is set. */
export function canCheckPriceFile(line: PriceFileStatusLine | null): boolean {
  return line !== null && line.kind !== "noPower";
}
