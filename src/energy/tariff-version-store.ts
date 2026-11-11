import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type {
  TariffConfig,
  TariffPrices,
  TariffVersion,
  TariffVersionInput,
} from "../shared/types.js";
import { localDateStr } from "../shared/local-date.js";
import { versionOn } from "./pricing.js";

// Spec 202 — the dated price versions. The rules live here: one version per
// start date, a single version without one (the first, open backwards), which
// can be edited but never deleted. The read routes call `all()` on every
// request, so the list is cached and dropped on each write.

export type TariffVersionErrorCode =
  "DuplicateStartDate" | "UndatedVersionLocked" | "NotFound" | "Invalid";

export class TariffVersionError extends Error {
  constructor(
    readonly code: TariffVersionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TariffVersionError";
  }
}

/** The highest price accepted, €/kWh: a typo guard, not a market limit. */
export const MAX_PRICE_EUR_KWH = 5;

interface VersionRow {
  id: string;
  start_date: string | null;
  price_hp: number;
  price_hc: number;
  fixed_fee_year: number | null;
  kva: number | null;
  origin: string;
  created_at: string;
  updated_at: string;
}

function toVersion(row: VersionRow): TariffVersion {
  return {
    id: row.id,
    startDate: row.start_date,
    prices: { hp: row.price_hp, hc: row.price_hc },
    fixedFeeYear: row.fixed_fee_year,
    kva: row.kva,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A real calendar day written `YYYY-MM-DD`. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function isPrice(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_EUR_KWH
  );
}

export class TariffVersionStore {
  private db: Database.Database;
  private logger: Logger;
  private now: () => Date;
  private cache: TariffVersion[] | null = null;

  constructor(db: Database.Database, logger: Logger, now: () => Date = () => new Date()) {
    this.db = db;
    this.logger = logger.child({ module: "tariff-version-store" });
    this.now = now;
  }

  /** The versions, oldest first (the one without a date first). */
  all(): TariffVersion[] {
    if (!this.cache) {
      const rows = this.db
        .prepare("SELECT * FROM tariff_versions ORDER BY COALESCE(start_date, '') ASC")
        .all() as VersionRow[];
      this.cache = rows.map(toVersion);
    }
    return this.cache;
  }

  /** The version in force today, null without any. */
  current(): TariffVersion | null {
    return versionOn(this.all(), localDateStr(this.now()));
  }

  /**
   * Create the first version from the legacy setting, when the table is empty
   * and the setting holds a price. Runs at every startup: it also covers the
   * restore of a backup taken before spec 202, which empties the table.
   */
  seedFromSetting(tariff: TariffConfig | null): boolean {
    if (this.all().length > 0) return false;
    const prices = tariff?.prices;
    if (!prices) return false;
    if (!isPrice(prices.hp) || !isPrice(prices.hc)) {
      // Before spec 202 the setting had no upper bound: say why costs read 0.
      this.logger.warn(
        { hp: prices.hp, hc: prices.hc, max: MAX_PRICE_EUR_KWH },
        "energy.tariff prices are out of range: no tariff version created, enter the prices in Settings",
      );
      return false;
    }
    if (prices.hp <= 0 && prices.hc <= 0) return false;
    const version = this.insert({ prices }, null, "migration");
    this.logger.info({ versionId: version.id }, "First tariff version created from energy.tariff");
    return true;
  }

  /** Add a version. The first one ever created has no start date. */
  create(input: TariffVersionInput, origin: string): TariffVersion {
    const first = this.all().length === 0;
    const startDate = first ? null : this.checkedStartDate(input.startDate);
    this.check(input);
    if (!first && this.all().some((v) => v.startDate === startDate)) {
      throw new TariffVersionError("DuplicateStartDate", "A version already starts on this date");
    }
    return this.insert(input, startDate, origin);
  }

  /**
   * Edit a version. The one without a date keeps none. A field left out
   * (start date, fee, power) keeps its stored value; null clears the fee or
   * the power.
   */
  update(id: string, input: TariffVersionInput): TariffVersion {
    const existing = this.all().find((v) => v.id === id);
    if (!existing) throw new TariffVersionError("NotFound", "Tariff version not found");
    this.check(input);
    const startDate =
      existing.startDate === null
        ? null
        : this.checkedStartDate(input.startDate ?? existing.startDate);
    if (this.all().some((v) => v.id !== id && v.startDate === startDate)) {
      throw new TariffVersionError("DuplicateStartDate", "A version already starts on this date");
    }
    const updatedAt = this.now().toISOString();
    this.db
      .prepare(
        `UPDATE tariff_versions
         SET start_date = ?, price_hp = ?, price_hc = ?, fixed_fee_year = ?, kva = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        startDate,
        input.prices.hp,
        input.prices.hc,
        input.fixedFeeYear === undefined ? existing.fixedFeeYear : input.fixedFeeYear,
        input.kva === undefined ? existing.kva : input.kva,
        updatedAt,
        id,
      );
    this.cache = null;
    this.logger.info({ versionId: id, startDate }, "Tariff version updated");
    return this.all().find((v) => v.id === id) as TariffVersion;
  }

  /** Delete a dated version. */
  remove(id: string): void {
    const existing = this.all().find((v) => v.id === id);
    if (!existing) throw new TariffVersionError("NotFound", "Tariff version not found");
    if (existing.startDate === null) {
      throw new TariffVersionError(
        "UndatedVersionLocked",
        "The first version cannot be deleted, only edited",
      );
    }
    this.db.prepare("DELETE FROM tariff_versions WHERE id = ?").run(id);
    this.cache = null;
    this.logger.info({ versionId: id, startDate: existing.startDate }, "Tariff version deleted");
  }

  /**
   * The legacy `PUT /settings/energy/tariff` with prices: edit the version in
   * force today in place, as that route always did, or create the first one.
   */
  upsertCurrentPrices(prices: TariffPrices): TariffVersion {
    const current = this.current();
    if (!current) return this.create({ prices }, "manual");
    if (current.prices.hp === prices.hp && current.prices.hc === prices.hc) return current;
    return this.update(current.id, { prices });
  }

  private insert(
    input: TariffVersionInput,
    startDate: string | null,
    origin: string,
  ): TariffVersion {
    const id = crypto.randomUUID();
    const at = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO tariff_versions
           (id, start_date, price_hp, price_hc, fixed_fee_year, kva, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        startDate,
        input.prices.hp,
        input.prices.hc,
        input.fixedFeeYear ?? null,
        input.kva ?? null,
        origin,
        at,
        at,
      );
    this.cache = null;
    this.logger.info({ versionId: id, startDate, origin }, "Tariff version created");
    return this.all().find((v) => v.id === id) as TariffVersion;
  }

  private checkedStartDate(value: unknown): string {
    if (!isLocalDate(value)) {
      throw new TariffVersionError("Invalid", "startDate must be a date written YYYY-MM-DD");
    }
    return value;
  }

  private check(input: TariffVersionInput): void {
    if (!input.prices || !isPrice(input.prices.hp) || !isPrice(input.prices.hc)) {
      throw new TariffVersionError(
        "Invalid",
        `Prices must be between 0 and ${MAX_PRICE_EUR_KWH} € per kWh`,
      );
    }
    const fee = input.fixedFeeYear;
    if (fee !== undefined && fee !== null && !(Number.isFinite(fee) && fee >= 0)) {
      throw new TariffVersionError("Invalid", "fixedFeeYear must be 0 or more");
    }
    const kva = input.kva;
    if (kva !== undefined && kva !== null && !(Number.isFinite(kva) && kva > 0)) {
      throw new TariffVersionError("Invalid", "kva must be above 0");
    }
  }
}
