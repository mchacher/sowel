/**
 * The daily read of the electricity price file — spec 203.
 *
 * The only part of the price file with I/O. Once a day, and when the user
 * asks, it downloads `tariffs/electricity-prices.json` from the Sowel
 * repository and, for the configured contract, turns the prices no version
 * holds yet into tariff versions: a period published since the last read is
 * added by itself, everything else (the prices the file already held when it
 * was first read, a late row, a jump of 30 % or more) waits for the user.
 *
 * It never modifies or deletes a version, and a read that fails changes
 * nothing. Every entry point here catches: a broken download must never reach
 * the rest of the engine.
 */

import type { EventBus } from "../../core/event-bus.js";
import type { Logger } from "../../core/logger.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import { isLocalDate } from "../../shared/local-date.js";
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

/** `{ lastCheckAt, lastSuccessAt, error }` of the last read. */
export const PRICE_FILE_STATUS_KEY = "energy.priceFile.status";
/** JSON list of `<supplier>|<type>|<kva>|<startDate>`: the prices set aside. */
export const PRICE_FILE_DISMISSED_KEY = "energy.priceFile.dismissed";
/** JSON map `<supplier>|<type>|<kva>` → the latest start date the file held at the last read. */
export const PRICE_FILE_SEEN_KEY = "energy.priceFile.seen";
/** "1" once the user was told that prices wait, until none does. */
export const PRICE_FILE_NOTIFIED_KEY = "energy.priceFile.pendingNotified";

const FIRST_CHECK_MS = 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** A file far larger than the real one (about 34 000 characters) is not read. */
export const MAX_FILE_CHARS = 2_000_000;
/** The reason of a failed read is stored and sent to the settings page: keep it short. */
const MAX_ERROR_CHARS = 200;

const ALARM_SOURCE = "price-file";

interface StoredStatus {
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

const NO_STATUS: StoredStatus = { lastCheckAt: null, lastSuccessAt: null, error: null };

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

/** Download the price file and parse its JSON. Throws on anything unexpected. */
export async function downloadPriceFile(fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(PRICE_FILE_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new PriceFileError(`The price file answered ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_CHARS) throw new PriceFileError("The price file is too large");
  const text = await res.text();
  if (text.length > MAX_FILE_CHARS) throw new PriceFileError("The price file is too large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PriceFileError("The price file is not valid JSON");
  }
}

/** Does this contract follow the file? */
export function followsPriceFile(contract: TariffContract): boolean {
  return contract.autoUpdate && contract.supplier !== "other" && contract.kva !== null;
}

type ContractKey = Pick<TariffContract, "supplier" | "contractType" | "kva">;

const contractKey = (c: ContractKey) => `${c.supplier}|${c.contractType}|${c.kva}`;
const dismissedKey = (c: ContractKey, startDate: string) => `${contractKey(c)}|${startDate}`;

export class PriceFileSync {
  private readonly deps: PriceFileSyncDeps;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly fetchFile: () => Promise<unknown>;
  /** The last file read successfully, kept for the status and the user's actions. */
  private file: PriceFile | null = null;
  private running: Promise<PriceFileStatus> | null = null;
  private stopped = false;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: PriceFileSyncDeps) {
    this.deps = deps;
    this.logger = deps.logger.child({ module: "price-file-sync" });
    this.now = deps.now ?? (() => new Date());
    this.fetchFile = deps.fetchFile ?? (() => downloadPriceFile());
  }

  /** A first read a minute after startup, then one a day. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.firstTimer = setTimeout(() => void this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.logger.info("Price file sync started");
  }

  /** Stop the timers. A download still running ends without touching anything. */
  stop(): void {
    this.stopped = true;
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
    this.firstTimer = null;
    this.timer = null;
  }

  /**
   * Read the file and act on it. One read at a time: a call made while one
   * runs gets the same answer. NEVER rejects.
   */
  check(): Promise<PriceFileStatus> {
    if (!this.running) {
      this.running = this.run()
        .catch((err: unknown) => {
          this.logger.error({ err }, "Price file check failed");
          return this.status();
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  private async run(): Promise<PriceFileStatus> {
    if (!followsPriceFile(this.deps.contract())) return this.status();
    const at = this.now().toISOString();
    let file: PriceFile;
    try {
      file = parsePriceFile(await this.fetchFile());
    } catch (err) {
      if (this.stopped) return this.status();
      const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS);
      this.logger.warn({ err }, "Price file read failed, keeping the versions as they are");
      this.store({ lastCheckAt: at, lastSuccessAt: this.stored().lastSuccessAt, error: message });
      return this.status();
    }
    // The engine is shutting down: the database may already be closed.
    if (this.stopped) return this.status();
    this.file = file;
    this.store({ lastCheckAt: at, lastSuccessAt: at, error: null });
    // The contract may have changed while the file was downloading: act on
    // the one in force now, never on the one read before the download.
    const contract = this.deps.contract();
    if (followsPriceFile(contract)) {
      this.addAutomatic(contract);
      this.rememberSeen(contract);
    }
    this.notifyPending();
    return this.status();
  }

  /** Create the versions of the prices that need no confirmation, oldest first. */
  private addAutomatic(contract: TariffContract): void {
    const { automatic } = this.split(contract);
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
    this.notifyPending();
    return created;
  }

  /**
   * Set held prices aside: they are not proposed again for this contract.
   * Throws `PriceFileError` on something that is not a `YYYY-MM-DD` day.
   */
  dismiss(startDates: string[]): void {
    for (const date of startDates) {
      if (!isLocalDate(date))
        throw new PriceFileError("startDates must be days written YYYY-MM-DD");
    }
    this.addDismissed(startDates.map((date) => dismissedKey(this.deps.contract(), date)));
    this.logger.info({ count: startDates.length }, "Price file rows set aside");
    this.notifyPending();
  }

  /**
   * A version that came from the file was deleted on purpose: set its date
   * aside, or the next read would propose it again. Keyed on the version's own
   * supplier and power, which may no longer be the contract's.
   */
  dismissVersion(version: TariffVersion): void {
    if (!version.origin.startsWith("file:") || version.startDate === null || version.kva === null) {
      return;
    }
    const supplier = version.origin.slice("file:".length) as TariffContract["supplier"];
    const contractType = version.prices.hp === version.prices.hc ? "base" : "hphc";
    this.addDismissed([
      dismissedKey({ supplier, contractType, kva: version.kva }, version.startDate),
    ]);
    this.notifyPending();
  }

  /** Propose again the prices set aside for the contract in force. */
  restoreDismissed(): void {
    const prefix = dismissedKey(this.deps.contract(), "");
    const keys = this.dismissedKeys().filter((key) => !key.startsWith(prefix));
    this.deps.settings.set(PRICE_FILE_DISMISSED_KEY, JSON.stringify(keys));
    this.notifyPending();
  }

  /** Where the read stands, computed from the last file read. NEVER throws. */
  status(): PriceFileStatus {
    let stored = NO_STATUS;
    try {
      stored = this.stored();
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

  private split(contract: TariffContract): { automatic: PriceFileRow[]; held: PriceFileRow[] } {
    if (!this.file || !followsPriceFile(contract)) return { automatic: [], held: [] };
    return newPrices(
      rowsFor(this.file, contract),
      this.deps.versions.all(),
      this.dismissedDates(contract),
      this.seen()[contractKey(contract)] ?? null,
    );
  }

  /**
   * The prices that wait for the user, oldest first. A price that would be
   * added by itself is added at the next read; until then it is shown with
   * the others rather than hidden.
   */
  private pending(contract: TariffContract): PriceFileRow[] {
    const { automatic, held } = this.split(contract);
    return [...held, ...automatic].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  /**
   * Tell the user once that prices wait: an item in the activity feed and a
   * push. Remembered in a setting, so a restart does not say it again; said
   * again only after the list went back to empty.
   */
  private notifyPending(): void {
    try {
      const count = this.pending(this.deps.contract()).length;
      const notified = this.deps.settings.get(PRICE_FILE_NOTIFIED_KEY) === "1";
      if (count > 0 && !notified) {
        this.deps.settings.set(PRICE_FILE_NOTIFIED_KEY, "1");
        this.deps.eventBus.emit({
          type: "system.alarm.resolved",
          alarmId: "price-file.pending",
          source: ALARM_SOURCE,
          message: `${count} electricity price(s) found for your contract: confirm them in Settings, Energy`,
        });
      } else if (count === 0 && notified) {
        this.deps.settings.set(PRICE_FILE_NOTIFIED_KEY, "");
      }
    } catch (err) {
      this.logger.error({ err }, "Price file notice failed");
    }
  }

  /** Note the latest price the file holds for this contract: what comes later is new. */
  private rememberSeen(contract: TariffContract): void {
    if (!this.file) return;
    const rows = rowsFor(this.file, contract);
    const latest = rows[rows.length - 1]?.startDate;
    if (!latest) return;
    const seen = this.seen();
    if (seen[contractKey(contract)] === latest) return;
    seen[contractKey(contract)] = latest;
    this.deps.settings.set(PRICE_FILE_SEEN_KEY, JSON.stringify(seen));
  }

  private seen(): Record<string, string> {
    const raw = this.deps.settings.get(PRICE_FILE_SEEN_KEY);
    if (!raw) return {};
    try {
      const value = JSON.parse(raw) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }

  private addDismissed(keys: string[]): void {
    const all = new Set([...this.dismissedKeys(), ...keys]);
    this.deps.settings.set(PRICE_FILE_DISMISSED_KEY, JSON.stringify([...all]));
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
    const raw = this.deps.settings.get(PRICE_FILE_STATUS_KEY);
    if (!raw) return NO_STATUS;
    try {
      const value = JSON.parse(raw) as Partial<StoredStatus>;
      const text = (v: unknown) => (typeof v === "string" ? v : null);
      return {
        lastCheckAt: text(value.lastCheckAt),
        lastSuccessAt: text(value.lastSuccessAt),
        error: text(value.error),
      };
    } catch {
      return NO_STATUS;
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
