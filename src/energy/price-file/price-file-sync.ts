/**
 * The daily read of the electricity price file — spec 203.
 *
 * The only part of the price file with I/O. Once a day, and when the user
 * asks, it downloads `tariffs/electricity-prices.json` from the Sowel
 * repository and, for the configured contract, turns the prices no version
 * holds yet into tariff versions: a new period is added by itself, everything
 * else (the past prices of an instance that has none, a late row, a jump of
 * 30 % or more) waits for the user.
 *
 * It never modifies or deletes a version, and a read that fails changes
 * nothing. Every handler here catches: a broken download must never reach the
 * rest of the engine.
 */

import type { EventBus } from "../../core/event-bus.js";
import type { Logger } from "../../core/logger.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type {
  PriceFile,
  PriceFileRow,
  PriceFileStatus,
  TariffContract,
  TariffVersion,
} from "../../shared/types.js";
import type { TariffVersionStore } from "../tariff-version-store.js";
import { PriceFileError, newPrices, parsePriceFile, rowsFor } from "./price-file.js";

/**
 * Where instances read the file. A constant, like the plugin registry's: an
 * instance cannot be pointed at another file.
 */
export const PRICE_FILE_URL =
  "https://raw.githubusercontent.com/mchacher/sowel/main/tariffs/electricity-prices.json";

export const PRICE_FILE_STATUS_KEY = "energy.priceFile.status";
export const PRICE_FILE_DISMISSED_KEY = "energy.priceFile.dismissed";

const FIRST_CHECK_MS = 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** A file far larger than the real one (about 30 kB) is not read. */
const MAX_FILE_BYTES = 2_000_000;

const PENDING_ALARM_ID = "price-file.pending";
const ALARM_SOURCE = "price-file";

interface StoredStatus {
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

export interface PriceFileSyncDeps {
  settings: Pick<SettingsManager, "get" | "set">;
  versions: TariffVersionStore;
  /** The contract in force, read at each use. */
  contract: () => TariffContract;
  eventBus: Pick<EventBus, "emit">;
  logger: Logger;
  /** The file's content, parsed JSON. Replaced in tests. */
  fetchFile?: () => Promise<unknown>;
  now?: () => Date;
}

async function downloadPriceFile(): Promise<unknown> {
  const res = await fetch(PRICE_FILE_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new PriceFileError(`The price file answered ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) throw new PriceFileError("The price file is too large");
  return JSON.parse(text) as unknown;
}

/** Does this contract follow the file? */
export function followsPriceFile(contract: TariffContract): boolean {
  return contract.autoUpdate && contract.supplier !== "other" && contract.kva !== null;
}

const dismissedKey = (contract: TariffContract, startDate: string) =>
  `${contract.supplier}|${contract.contractType}|${contract.kva}|${startDate}`;

export class PriceFileSync {
  private readonly deps: PriceFileSyncDeps;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly fetchFile: () => Promise<unknown>;
  /** The last file read successfully, kept for the status and the user's actions. */
  private file: PriceFile | null = null;
  private running: Promise<PriceFileStatus> | null = null;
  private pendingAlarmRaised = false;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: PriceFileSyncDeps) {
    this.deps = deps;
    this.logger = deps.logger.child({ module: "price-file-sync" });
    this.now = deps.now ?? (() => new Date());
    this.fetchFile = deps.fetchFile ?? downloadPriceFile;
  }

  /** A first read a minute after startup, then one a day. */
  start(): void {
    if (this.timer) return;
    this.firstTimer = setTimeout(() => void this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.logger.info("Price file sync started");
  }

  stop(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
    this.firstTimer = null;
    this.timer = null;
  }

  /**
   * Read the file and act on it. One read at a time: a call made while one
   * runs gets the same answer. NEVER throws.
   */
  check(): Promise<PriceFileStatus> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<PriceFileStatus> {
    try {
      const contract = this.deps.contract();
      if (!followsPriceFile(contract)) {
        this.syncPendingAlarm();
        return this.status();
      }
      const at = this.now().toISOString();
      try {
        this.file = parsePriceFile(await this.fetchFile());
        this.store({ lastCheckAt: at, lastSuccessAt: at, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn({ err }, "Price file read failed, keeping the versions as they are");
        this.store({ lastCheckAt: at, lastSuccessAt: this.stored().lastSuccessAt, error: message });
        return this.status();
      }
      this.addAutomatic(contract);
      this.syncPendingAlarm();
    } catch (err) {
      this.logger.error({ err }, "Price file check failed");
    }
    return this.status();
  }

  /** Create the versions of the prices that need no confirmation, oldest first. */
  private addAutomatic(contract: TariffContract): void {
    if (!this.file) return;
    const { automatic } = newPrices(
      rowsFor(this.file, contract),
      this.deps.versions.all(),
      this.dismissedDates(contract),
    );
    for (const row of automatic) {
      const version = this.create(row, contract);
      if (!version) continue;
      this.logger.info(
        { startDate: row.startDate, supplier: contract.supplier },
        "Tariff version added from the price file",
      );
      // An item in the activity feed and a push, not a standing alarm: the
      // resolved half alone is how the alarm channel carries a done thing.
      this.deps.eventBus.emit({
        type: "system.alarm.resolved",
        alarmId: `price-file.added.${row.startDate}`,
        source: ALARM_SOURCE,
        message: `New electricity prices from ${row.startDate} added: ${describePrices(row)}`,
      });
    }
  }

  private create(row: PriceFileRow, contract: TariffContract): TariffVersion | null {
    try {
      return this.deps.versions.create(
        {
          startDate: row.startDate,
          prices: { hp: row.hp, hc: row.hc },
          fixedFeeYear: row.fixedFeeYear,
          kva: row.kva,
        },
        `file:${contract.supplier}`,
      );
    } catch (err) {
      this.logger.warn({ err, startDate: row.startDate }, "Price file row could not be added");
      return null;
    }
  }

  /**
   * Add held prices, oldest first, so that on an instance without any version
   * the oldest row becomes the version without a date. Throws `PriceFileError`
   * when a date is not one of the held prices: nothing is created then.
   */
  apply(startDates: string[]): TariffVersion[] {
    const contract = this.deps.contract();
    const held = new Map(this.pending(contract).map((row) => [row.startDate, row] as const));
    const rows = [...new Set(startDates)].map((date) => {
      const row = held.get(date);
      if (!row) throw new PriceFileError(`No price waiting for ${date}`);
      return row;
    });
    rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
    const created: TariffVersion[] = [];
    for (const row of rows) {
      const version = this.create(row, contract);
      if (version) created.push(version);
    }
    this.logger.info(
      { count: created.length, supplier: contract.supplier },
      "Held prices added from the price file",
    );
    this.syncPendingAlarm();
    return created;
  }

  /** Set held prices aside: they are not proposed again for this contract. */
  dismiss(startDates: string[]): void {
    const contract = this.deps.contract();
    const keys = new Set(this.dismissedKeys());
    for (const date of startDates) keys.add(dismissedKey(contract, date));
    this.deps.settings.set(PRICE_FILE_DISMISSED_KEY, JSON.stringify([...keys]));
    this.logger.info({ count: startDates.length }, "Price file rows set aside");
    this.syncPendingAlarm();
  }

  /** Propose again the prices set aside for the contract in force. */
  restoreDismissed(): void {
    const contract = this.deps.contract();
    const prefix = dismissedKey(contract, "");
    const keys = this.dismissedKeys().filter((key) => !key.startsWith(prefix));
    this.deps.settings.set(PRICE_FILE_DISMISSED_KEY, JSON.stringify(keys));
    this.syncPendingAlarm();
  }

  /** Where the read stands, computed from the last file read. NEVER throws. */
  status(): PriceFileStatus {
    const stored = this.stored();
    try {
      const contract = this.deps.contract();
      const following = followsPriceFile(contract);
      const rows = following && this.file ? rowsFor(this.file, contract) : [];
      return {
        following,
        ...stored,
        latestStartDate: rows[rows.length - 1]?.startDate ?? null,
        noPriceForContract: following && this.file !== null && rows.length === 0,
        pending: this.pending(contract).reverse(),
        dismissedCount: this.dismissedDates(contract).size,
      };
    } catch (err) {
      this.logger.error({ err }, "Price file status failed");
      return {
        following: false,
        ...stored,
        latestStartDate: null,
        noPriceForContract: false,
        pending: [],
        dismissedCount: 0,
      };
    }
  }

  /** The held prices of the contract, oldest first. */
  private pending(contract: TariffContract): PriceFileRow[] {
    if (!this.file || !followsPriceFile(contract)) return [];
    const { automatic, held } = newPrices(
      rowsFor(this.file, contract),
      this.deps.versions.all(),
      this.dismissedDates(contract),
    );
    // A price that would be added by itself is added at the next read; until
    // then it is shown with the others rather than hidden.
    return [...held, ...automatic].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  /** One standing notice while prices wait, however many; cleared when none do. */
  private syncPendingAlarm(): void {
    try {
      const count = this.pending(this.deps.contract()).length;
      if (count > 0 && !this.pendingAlarmRaised) {
        this.pendingAlarmRaised = true;
        this.deps.eventBus.emit({
          type: "system.alarm.raised",
          alarmId: PENDING_ALARM_ID,
          level: "warning",
          source: ALARM_SOURCE,
          message: `${count} electricity price(s) found for your contract: confirm them in Settings, Energy`,
        });
      } else if (count === 0 && this.pendingAlarmRaised) {
        this.pendingAlarmRaised = false;
        this.deps.eventBus.emit({
          type: "system.alarm.resolved",
          alarmId: PENDING_ALARM_ID,
          source: ALARM_SOURCE,
          message: "No electricity price waits for confirmation",
        });
      }
    } catch (err) {
      this.logger.error({ err }, "Price file notice failed");
    }
  }

  private dismissedKeys(): string[] {
    const raw = this.deps.settings.get(PRICE_FILE_DISMISSED_KEY);
    if (!raw) return [];
    try {
      const value = JSON.parse(raw) as unknown;
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  /** The start dates set aside for this contract. */
  private dismissedDates(contract: TariffContract): Set<string> {
    const prefix = dismissedKey(contract, "");
    return new Set(
      this.dismissedKeys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    );
  }

  private stored(): StoredStatus {
    const empty: StoredStatus = { lastCheckAt: null, lastSuccessAt: null, error: null };
    const raw = this.deps.settings.get(PRICE_FILE_STATUS_KEY);
    if (!raw) return empty;
    try {
      const value = JSON.parse(raw) as Partial<StoredStatus>;
      const text = (v: unknown) => (typeof v === "string" ? v : null);
      return {
        lastCheckAt: text(value.lastCheckAt),
        lastSuccessAt: text(value.lastSuccessAt),
        error: text(value.error),
      };
    } catch {
      return empty;
    }
  }

  private store(status: StoredStatus): void {
    this.deps.settings.set(PRICE_FILE_STATUS_KEY, JSON.stringify(status));
  }
}

function describePrices(row: PriceFileRow): string {
  return row.contractType === "base"
    ? `${row.hp} € per kWh`
    : `peak ${row.hp}, off-peak ${row.hc} € per kWh`;
}
