import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type {
  Equipment,
  OrderSource,
  SharedAccessGateInput,
  SharedAccessGateSummary,
  SharedAccessGateView,
  SharedAccessJournalEntry,
  SharedAccessPhoneView,
  SharedAccessProfileView,
  SharedAccessRefusal,
  SharedAccessState,
  SharedAccessStatus,
  SharedAccessTimeWindow,
  SharedAccessView,
} from "../shared/types.js";
import {
  deriveLinkToken,
  formatCode,
  generateCode,
  generateLinkSecret,
  generatePhoneToken,
  normalizeCode,
  sha256,
} from "./codes.js";
import {
  SharedAccessError,
  accessStatus,
  checkPeriod,
  decide,
  hasEnded,
  nextWindowOpening,
  parseInstant,
  validateTimeWindows,
  type ValidityFacts,
} from "./validity.js";
import { GuessingBudget } from "./guessing.js";
import { phonePlatform, phoneTag } from "./phones.js";
import { GateQueue, GateQueueClosedError } from "./gate-queue.js";
import {
  SharedAccessStore,
  type AccessRow,
  type GateLinkRow,
  type JournalRow,
  type ProfileRow,
} from "./shared-access-store.js";
import type Database from "better-sqlite3";

// ============================================================
// Spec 181 — shared access: every rule, once.
//
// Three callers — the owner's routes, the public page and plugins — and one
// manager. None of them touches the store, which is what keeps « a suspended
// access cannot open » true for all three at once.
// ============================================================

export const SETTING_ENABLED = "sharedAccess.enabled";
export const SETTING_BASE_URL = "sharedAccess.publicBaseUrl";
export const SETTING_PATH = "sharedAccess.publicPath";
export const SETTING_LINK_SECRET = "sharedAccess.linkSecret";
export const DEFAULT_PUBLIC_PATH = "/access/";

/** R4.13 */
export const OPENS_PER_HOUR_PER_ACCESS = 12;
export const OPENS_PER_HOUR_PER_GATE = 30;
/** R5.19 — past this, an alarm; never a block. */
export const PHONES_BEFORE_ALARM = 6;
/**
 * A hard ceiling, far above any household: past it a leaked link could only
 * be used to fill the phones table and the journal, one enrolment at a time.
 */
export const MAX_PHONES_PER_ACCESS = 50;
/**
 * A refusal identical to this phone's previous one within this window is
 * answered but not journalled again: a phone left on a revoked page, or a
 * script replaying a press, must not be able to flood the journal and push the
 * genuine openings out of its 50 000 lines.
 */
export const REFUSAL_REPEAT_MS = 60_000;
/** R10 */
export const CODE_KEPT_AFTER_END_MS = 7 * 24 * 3_600_000;
export const JOURNAL_KEPT_MS = 365 * 24 * 3_600_000;
export const JOURNAL_MAX_ROWS = 50_000;
/** What the visitor's bar runs for: the core declares no travel time for a gate. */
export const DEFAULT_TRAVEL_S = 30;

const HOUR_MS = 3_600_000;
const ALARM_SOURCE = "shared-access";
const GUESSING_ALARM_ID = "shared-access:guessing";
const DEFAULT_PROFILE_NAME = "Par défaut";

export class SharedAccessDisabledError extends SharedAccessError {
  constructor() {
    super("disabled", "Shared access is turned off", 404);
    this.name = "SharedAccessDisabledError";
  }
}
export class UnknownProfileError extends SharedAccessError {
  constructor(message = "This profile is not granted to this plugin") {
    super("unknown_profile", message, 422);
    this.name = "UnknownProfileError";
  }
}
export class ProfileIncompleteError extends SharedAccessError {
  constructor() {
    super("profile_incomplete", "The profile lists no gate", 422);
    this.name = "ProfileIncompleteError";
  }
}
export class NoEndError extends SharedAccessError {
  constructor() {
    super("no_end", "A plugin's access needs an end", 422);
    this.name = "NoEndError";
  }
}

export interface CreateAccessInput {
  label?: unknown;
  gates?: unknown;
  withCode?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  timeWindows?: unknown;
}

export interface UpdateAccessInput extends CreateAccessInput {
  earlyOpenAt?: unknown;
  extendedUntil?: unknown;
}

export interface ProfileInput {
  name?: unknown;
  gates?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  timeWindows?: unknown;
  withCode?: unknown;
  pluginId?: unknown;
}

/** What the phone may know. Never the gate's state (R4.16). */
export interface PublicSession {
  label: string;
  status: SharedAccessStatus;
  gates: { id: string; name: string }[];
  activeAt: string | null;
  nextOpeningAt: string | null;
  validUntil: string | null;
  travelS: number;
  /** R5.22 — this phone's own presses, and nothing else. */
  presses: { at: string; gateId: string | null; gateName: string; result: string }[];
}

export type EnrolResult =
  | { ok: true; token: string; session: PublicSession }
  | { ok: false; error: "unknown_code" | "too_many" | "ended" | "too_many_phones" };

export type OpenResult =
  | { ok: true; duplicate?: boolean }
  | {
      ok: false;
      reason: SharedAccessRefusal;
      activeAt?: string;
      nextOpeningAt?: string;
    };

export interface PluginInvitation {
  id: string;
  code: string | null;
  invitationUrl: string | null;
}

interface ManagerDeps {
  db: Database.Database;
  eventBus: EventBus;
  equipmentManager: Pick<
    EquipmentManager,
    "getAll" | "getById" | "getOrderBindingsWithDetails" | "executeOrder"
  >;
  settingsManager: Pick<SettingsManager, "get" | "set">;
  logger: Logger;
  now?: () => number;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

function parseWindows(json: string): SharedAccessTimeWindow[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as SharedAccessTimeWindow[]) : [];
  } catch {
    return [];
  }
}

function parseValue(json: string | null): unknown {
  if (json === null) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return json;
  }
}

const minNullable = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : Math.min(a, b);
const maxNullable = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : Math.max(a, b);

export class SharedAccessManager {
  private readonly store: SharedAccessStore;
  private readonly eventBus: EventBus;
  private readonly equipments: ManagerDeps["equipmentManager"];
  private readonly settings: ManagerDeps["settingsManager"];
  private readonly logger: Logger;
  private readonly now: () => number;
  readonly guessing: GuessingBudget;
  private readonly queue = new GateQueue();
  private readonly phoneAlarms = new Set<string>();
  private readonly lastRefusal = new Map<string, { key: string; at: number }>();
  private readonly unsubscribes: (() => void)[] = [];
  private purgeTimer: NodeJS.Timeout | null = null;
  private pluginDirectory: () => { id: string; name: string }[] = () => [];

  constructor(deps: ManagerDeps) {
    this.store = new SharedAccessStore(deps.db);
    this.eventBus = deps.eventBus;
    this.equipments = deps.equipmentManager;
    this.settings = deps.settingsManager;
    this.logger = deps.logger.child({ module: "shared-access" });
    this.now = deps.now ?? Date.now;
    this.guessing = new GuessingBudget({
      now: this.now,
      onAlert: (failures) => {
        this.logger.warn({ failures }, "Shared access: many wrong codes");
        this.eventBus.emit({
          type: "system.alarm.raised",
          alarmId: GUESSING_ALARM_ID,
          level: "warning",
          source: ALARM_SOURCE,
          message: `Shared access: more than ${failures - 1} wrong codes in ten minutes`,
        });
      },
      onAlertCleared: () => {
        this.eventBus.emit({
          type: "system.alarm.resolved",
          alarmId: GUESSING_ALARM_ID,
          source: ALARM_SOURCE,
          message: "Shared access: wrong codes back to normal",
        });
      },
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────

  start(): void {
    this.unsubscribes.push(
      this.eventBus.on((event) => {
        try {
          if (event.type === "settings.changed" && event.keys.includes(SETTING_ENABLED)) {
            if (this.isEnabled()) this.ensureDefaultProfile();
            this.changed();
          } else if (event.type === "equipment.removed") {
            // The foreign keys already dropped the gate from every access and
            // profile (R2.6); the owner's page only needs to hear about it.
            this.changed();
          }
        } catch (err) {
          this.logger.error({ err }, "Shared access event handler failed");
        }
      }),
    );
    if (this.isEnabled()) this.ensureDefaultProfile();
    this.purge();
    this.purgeTimer = setInterval(() => this.purge(), HOUR_MS);
    this.purgeTimer.unref?.();
  }

  stop(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    this.purgeTimer = null;
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.guessing.releaseAll();
    this.queue.close();
  }

  /** The integration plugins a profile can be granted to (for the owner's page). */
  setPluginDirectory(fn: () => { id: string; name: string }[]): void {
    this.pluginDirectory = fn;
  }

  isEnabled(): boolean {
    return this.settings.get(SETTING_ENABLED) === "true";
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) throw new SharedAccessDisabledError();
  }

  // ── Addresses and secrets ────────────────────────────────────

  /** Base of the invitation links: `https://host/access/`, or null when unset. */
  publicUrl(): string | null {
    const base = (this.settings.get(SETTING_BASE_URL) ?? "").trim().replace(/\/+$/, "");
    if (!base) return null;
    let path = (this.settings.get(SETTING_PATH) ?? DEFAULT_PUBLIC_PATH).trim() || "/";
    if (!path.startsWith("/")) path = `/${path}`;
    if (!path.endsWith("/")) path = `${path}/`;
    return `${base}${path}`;
  }

  private linkSecret(): string {
    let secret = this.settings.get(SETTING_LINK_SECRET);
    if (!secret) {
      secret = generateLinkSecret();
      this.settings.set(SETTING_LINK_SECRET, secret);
    }
    return secret;
  }

  private linkToken(row: Pick<AccessRow, "id" | "link_version">): string {
    return deriveLinkToken(this.linkSecret(), row.id, row.link_version);
  }

  private invitationUrl(row: AccessRow): string | null {
    const base = this.publicUrl();
    return base ? `${base}#i=${this.linkToken(row)}` : null;
  }

  private freshCode(): string {
    for (let i = 0; i < 20; i++) {
      const code = generateCode();
      if (!this.store.codeInUse(code)) return code;
    }
    throw new SharedAccessError("code_exhausted", "Could not draw a free code", 500);
  }

  // ── Gates ────────────────────────────────────────────────────

  private gateEquipments(): Equipment[] {
    return this.equipments.getAll().filter((e) => e.type === "gate");
  }

  private commandValues(equipmentId: string): { has: boolean; values: string[] } {
    const binding = this.equipments
      .getOrderBindingsWithDetails(equipmentId)
      .find((b) => b.alias === "command");
    return { has: !!binding, values: binding?.enumValues ?? [] };
  }

  /**
   * R2.3 and R2.5: each listed equipment exists, is a gate, carries a command,
   * and when that command has values, the one that opens is known.
   */
  private validateGates(
    input: unknown,
    required: boolean,
  ): { equipmentId: string; value: string | null }[] {
    if (!Array.isArray(input)) {
      if (required) throw new SharedAccessError("no_gate", "At least one gate is needed");
      return [];
    }
    const seen = new Set<string>();
    const out: { equipmentId: string; value: string | null }[] = [];
    for (const raw of input as SharedAccessGateInput[]) {
      const equipmentId = typeof raw?.equipmentId === "string" ? raw.equipmentId : "";
      if (seen.has(equipmentId)) continue;
      const equipment = equipmentId ? this.equipments.getById(equipmentId) : null;
      if (!equipment) throw new SharedAccessError("unknown_gate", "Unknown equipment", 404);
      if (equipment.type !== "gate") {
        throw new SharedAccessError(
          "unsupported_equipment",
          `« ${equipment.name} » is not a gate`,
          422,
        );
      }
      const { has, values } = this.commandValues(equipmentId);
      if (!has) {
        throw new SharedAccessError("no_command", `« ${equipment.name} » has no command`, 422);
      }
      // R2.5 — what the gate's own button sends. With one value or none, the
      // button sends no value and the order resolves it (spec 150); only a
      // command with a choice (open / close / stop) needs the access to say.
      let value: string | null = null;
      if (values.length > 1) {
        const wanted =
          raw.value === undefined || raw.value === null
            ? values.includes("open")
              ? "open"
              : undefined
            : String(raw.value);
        if (wanted === undefined || !values.includes(wanted)) {
          throw new SharedAccessError(
            "invalid_value",
            `« ${equipment.name} » opens with one of: ${values.join(", ")}`,
          );
        }
        value = JSON.stringify(wanted);
      }
      seen.add(equipmentId);
      out.push({ equipmentId, value });
    }
    if (required && out.length === 0) {
      throw new SharedAccessError("no_gate", "At least one gate is needed");
    }
    return out;
  }

  // ── Views ────────────────────────────────────────────────────

  private facts(row: AccessRow, gateIds: string[]): ValidityFacts {
    return {
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      timeWindows: parseWindows(row.time_windows),
      suspendedAt: row.suspended_at,
      revokedAt: row.revoked_at,
      gateIds,
    };
  }

  private gateViews(links: GateLinkRow[], names: Map<string, string>): SharedAccessGateView[] {
    return links.map((l) => ({
      equipmentId: l.equipment_id,
      name: names.get(l.equipment_id) ?? l.equipment_id,
      value: parseValue(l.value),
    }));
  }

  private groupLinks(links: GateLinkRow[]): Map<string, GateLinkRow[]> {
    const map = new Map<string, GateLinkRow[]>();
    for (const l of links) {
      const list = map.get(l.owner_id) ?? [];
      list.push(l);
      map.set(l.owner_id, list);
    }
    return map;
  }

  private accessView(
    row: AccessRow,
    ctx: {
      links: Map<string, GateLinkRow[]>;
      names: Map<string, string>;
      phones: Map<string, number>;
      profiles: Map<string, ProfileRow>;
      now: number;
    },
  ): SharedAccessView {
    const links = ctx.links.get(row.id) ?? [];
    const profile = row.profile_id ? ctx.profiles.get(row.profile_id) : undefined;
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      code: row.code ? formatCode(row.code) : null,
      invitationUrl: this.invitationUrl(row),
      gates: this.gateViews(links, ctx.names),
      validFrom: iso(row.valid_from),
      validUntil: iso(row.valid_until),
      timeWindows: parseWindows(row.time_windows),
      status: accessStatus(
        this.facts(
          row,
          links.map((l) => l.equipment_id),
        ),
        ctx.now,
      ),
      suspendedAt: iso(row.suspended_at),
      revokedAt: iso(row.revoked_at),
      source:
        row.kind === "external"
          ? {
              pluginId: row.source_plugin ?? "",
              externalId: row.external_id ?? "",
              profileId: row.profile_id,
              profileName: profile?.name ?? null,
              from: iso(row.source_from),
              until: iso(row.source_until),
              earlyOpenAt: iso(row.early_open_at),
              extendedUntil: iso(row.extended_until),
            }
          : null,
      phones: ctx.phones.get(row.id) ?? 0,
      useCount: row.use_count,
      lastUsedAt: iso(row.last_used_at),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  private profileView(
    row: ProfileRow,
    links: GateLinkRow[],
    names: Map<string, string>,
  ): SharedAccessProfileView {
    return {
      id: row.id,
      name: row.name,
      pluginId: row.plugin_id,
      isDefault: row.is_default === 1,
      gates: this.gateViews(links, names),
      validFrom: iso(row.valid_from),
      validUntil: iso(row.valid_until),
      timeWindows: parseWindows(row.time_windows),
      withCode: row.with_code === 1,
    };
  }

  private equipmentNames(): Map<string, string> {
    return new Map(this.equipments.getAll().map((e) => [e.id, e.name]));
  }

  private viewContext() {
    return {
      links: this.groupLinks(this.store.allAccessGates()),
      names: this.equipmentNames(),
      phones: this.store.phoneCounts(),
      profiles: new Map(this.store.listProfiles().map((p) => [p.id, p])),
      now: this.now(),
    };
  }

  /** Everything the owner's page shows. */
  getState(): SharedAccessState {
    const ctx = this.viewContext();
    const rows = this.store.listAccesses();
    const accesses = rows.map((r) => this.accessView(r, ctx));
    const disarmed = this.store.disarmedGates();
    const gates: SharedAccessGateSummary[] = this.gateEquipments().map((e) => {
      const { has, values } = this.commandValues(e.id);
      return {
        equipmentId: e.id,
        name: e.name,
        armed: !disarmed.has(e.id),
        people: this.peopleFor(e.id, rows, ctx),
        commandValues: values,
        hasCommand: has,
      };
    });
    const profileLinks = this.groupLinks(this.store.allProfileGates());
    return {
      enabled: this.isEnabled(),
      publicUrl: this.publicUrl(),
      accesses,
      gates,
      profiles: this.store
        .listProfiles()
        .map((p) => this.profileView(p, profileLinks.get(p.id) ?? [], ctx.names)),
      plugins: this.pluginDirectory(),
    };
  }

  private peopleFor(
    equipmentId: string,
    rows: AccessRow[],
    ctx: { links: Map<string, GateLinkRow[]>; now: number },
  ): number {
    return rows.filter((r) => {
      const ids = (ctx.links.get(r.id) ?? []).map((l) => l.equipment_id);
      return ids.includes(equipmentId) && !hasEnded(this.facts(r, ids), ctx.now);
    }).length;
  }

  getAccess(id: string): SharedAccessView {
    const row = this.store.getAccess(id);
    if (!row) throw new SharedAccessError("not_found", "Unknown access", 404);
    return this.accessView(row, this.viewContext());
  }

  listJournal(accessId: string | null, limit = 200): SharedAccessJournalEntry[] {
    return this.store.listJournal(accessId, Math.max(1, Math.min(limit, 1000))).map((r) => ({
      id: r.id,
      at: new Date(r.at).toISOString(),
      accessId: r.access_id,
      label: r.label,
      kind: r.kind,
      reason: r.reason,
      actor: r.actor,
      equipmentId: r.equipment_id,
      phoneTag: r.phone_id ? phoneTag(r.phone_id) : null,
    }));
  }

  /** R5.23 — the phones set up on an access, oldest first. */
  listPhones(accessId: string): SharedAccessPhoneView[] {
    this.getRow(accessId);
    return this.store.listPhones(accessId).map((p) => ({
      id: p.id,
      platform: phonePlatform(p.user_agent),
      tag: phoneTag(p.id),
      firstSeenAt: new Date(p.first_seen_at).toISOString(),
      lastSeenAt: new Date(p.last_seen_at).toISOString(),
    }));
  }

  /** R5.23 — cut one phone: it falls back to the code screen, the others keep working. */
  cutPhone(accessId: string, phoneId: string, actor: string): void {
    this.assertEnabled();
    const row = this.getRow(accessId);
    if (!this.store.deletePhone(phoneId, accessId)) {
      throw new SharedAccessError("unknown_phone", "No such phone on this access", 404);
    }
    this.journal(row, "phone_cut", { actor, phone_id: phoneId });
    if (this.store.countPhones(accessId) <= PHONES_BEFORE_ALARM) this.resolvePhoneAlarm(row);
    this.changed();
  }

  /** R8 — the panel on a gate's own page. */
  gatePanel(equipmentId: string): { armed: boolean; people: number } {
    const rows = this.store.listAccesses();
    return {
      armed: !this.store.disarmedGates().has(equipmentId),
      people: this.peopleFor(equipmentId, rows, {
        links: this.groupLinks(this.store.allAccessGates()),
        now: this.now(),
      }),
    };
  }

  // ── Owner writes ─────────────────────────────────────────────

  private changed(): void {
    this.eventBus.emit({ type: "shared_access.changed" });
  }

  private journal(
    row: Pick<AccessRow, "id" | "label">,
    kind: string,
    extra: Partial<Pick<JournalRow, "reason" | "actor" | "equipment_id" | "phone_id">> = {},
  ): void {
    this.store.journal({
      at: this.now(),
      access_id: row.id,
      label: row.label,
      kind,
      reason: extra.reason ?? null,
      actor: extra.actor ?? null,
      equipment_id: extra.equipment_id ?? null,
      phone_id: extra.phone_id ?? null,
    });
  }

  private requireLabel(value: unknown): string {
    const label = typeof value === "string" ? value.trim() : "";
    if (!label) throw new SharedAccessError("label_required", "The label is required");
    if (label.length > 80) throw new SharedAccessError("label_too_long", "The label is too long");
    return label;
  }

  private getRow(id: string): AccessRow {
    const row = this.store.getAccess(id);
    if (!row) throw new SharedAccessError("not_found", "Unknown access", 404);
    return row;
  }

  createAccess(input: CreateAccessInput, actor: string): SharedAccessView {
    this.assertEnabled();
    const label = this.requireLabel(input.label);
    const gates = this.validateGates(input.gates, true);
    const from = parseInstant(input.validFrom, "validFrom");
    const until = parseInstant(input.validUntil, "validUntil");
    checkPeriod(from, until);
    const windows = validateTimeWindows(input.timeWindows);
    const withCode = input.withCode !== false;
    const id = crypto.randomUUID();
    const now = this.now();
    const row: AccessRow = {
      id,
      kind: "manual",
      label,
      code: withCode ? this.freshCode() : null,
      link_version: 1,
      link_token_hash: "",
      valid_from: from,
      valid_until: until,
      source_plugin: null,
      external_id: null,
      profile_id: null,
      source_from: null,
      source_until: null,
      early_open_at: null,
      extended_until: null,
      time_windows: JSON.stringify(windows),
      suspended_at: null,
      revoked_at: null,
      created_at: now,
      created_by: actor,
      last_used_at: null,
      use_count: 0,
    };
    row.link_token_hash = sha256(this.linkToken(row));
    this.store.transaction(() => {
      this.store.insertAccess(row);
      this.store.setAccessGates(id, gates);
      this.journal(row, "created", { actor });
    });
    this.logger.info({ accessId: id, gates: gates.length }, "Shared access created");
    this.changed();
    return this.getAccess(id);
  }

  updateAccess(id: string, input: UpdateAccessInput, actor: string): SharedAccessView {
    this.assertEnabled();
    const row = this.getRow(id);
    if (row.revoked_at !== null) {
      throw new SharedAccessError("revoked", "A revoked access cannot be changed", 409);
    }
    const fields: Partial<AccessRow> = {};
    if (input.label !== undefined) fields.label = this.requireLabel(input.label);
    if (input.timeWindows !== undefined) {
      fields.time_windows = JSON.stringify(validateTimeWindows(input.timeWindows));
    }
    const gates = input.gates !== undefined ? this.validateGates(input.gates, true) : null;

    if (row.kind === "manual") {
      const from =
        input.validFrom !== undefined ? parseInstant(input.validFrom, "validFrom") : row.valid_from;
      const until =
        input.validUntil !== undefined
          ? parseInstant(input.validUntil, "validUntil")
          : row.valid_until;
      checkPeriod(from, until);
      fields.valid_from = from;
      fields.valid_until = until;
      if (input.withCode !== undefined) {
        const want = input.withCode !== false;
        if (want && row.code === null) fields.code = this.freshCode();
        if (!want) fields.code = null;
      }
    } else {
      // R3.10 — an external access keeps its source's dates; the owner may
      // widen them only: open earlier, extend later.
      const early =
        input.earlyOpenAt !== undefined
          ? parseInstant(input.earlyOpenAt, "earlyOpenAt")
          : row.early_open_at;
      const extended =
        input.extendedUntil !== undefined
          ? parseInstant(input.extendedUntil, "extendedUntil")
          : row.extended_until;
      if (early !== null && row.source_from !== null && early > row.source_from) {
        throw new SharedAccessError("shorten_refused", "Only an earlier opening is allowed");
      }
      if (extended !== null && row.source_until !== null && extended < row.source_until) {
        throw new SharedAccessError("shorten_refused", "Only a later end is allowed");
      }
      fields.early_open_at = early;
      fields.extended_until = extended;
      Object.assign(fields, this.effectiveExternal({ ...row, ...fields }));
    }

    this.store.transaction(() => {
      this.store.updateAccess(id, fields);
      if (gates) this.store.setAccessGates(id, gates);
      this.journal({ id, label: fields.label ?? row.label }, "updated", { actor });
    });
    this.changed();
    return this.getAccess(id);
  }

  /** The dates in force of an external access: its source's, widened by the owner. */
  private effectiveExternal(
    row: Pick<AccessRow, "source_from" | "source_until" | "early_open_at" | "extended_until">,
  ): Pick<AccessRow, "valid_from" | "valid_until"> {
    return {
      valid_from:
        row.early_open_at !== null
          ? minNullable(row.early_open_at, row.source_from)
          : row.source_from,
      valid_until:
        row.extended_until !== null
          ? maxNullable(row.extended_until, row.source_until)
          : row.source_until,
    };
  }

  suspend(id: string, actor: string): SharedAccessView {
    this.assertEnabled();
    const row = this.getRow(id);
    if (row.revoked_at === null && row.suspended_at === null) {
      this.store.updateAccess(id, { suspended_at: this.now() });
      this.journal(row, "suspended", { actor });
      this.changed();
    }
    return this.getAccess(id);
  }

  resume(id: string, actor: string): SharedAccessView {
    this.assertEnabled();
    const row = this.getRow(id);
    if (row.suspended_at !== null) {
      this.store.updateAccess(id, { suspended_at: null });
      this.journal(row, "resumed", { actor });
      this.changed();
    }
    return this.getAccess(id);
  }

  revoke(id: string, actor: string): SharedAccessView {
    this.assertEnabled();
    const row = this.getRow(id);
    if (row.revoked_at === null) {
      this.store.updateAccess(id, { revoked_at: this.now() });
      this.journal(row, "revoked", { actor });
      this.resolvePhoneAlarm(row);
      this.changed();
    }
    return this.getAccess(id);
  }

  /** R3.11 — only once revoked or ended; the journal outlives the line. */
  deleteAccess(id: string, actor: string): void {
    this.assertEnabled();
    const row = this.getRow(id);
    const ids = this.store.accessGates(id).map((l) => l.equipment_id);
    if (!hasEnded(this.facts(row, ids), this.now())) {
      throw new SharedAccessError("still_live", "Revoke the access before deleting it", 422);
    }
    this.store.transaction(() => {
      this.journal(row, "deleted", { actor });
      this.store.deleteAccess(id);
    });
    this.resolvePhoneAlarm(row);
    this.changed();
  }

  /** R3.9 — a new code (when it has one) and a new link, the phones kept or cut. */
  changeCode(id: string, cutPhones: boolean, actor: string): SharedAccessView {
    this.assertEnabled();
    const row = this.getRow(id);
    if (row.revoked_at !== null) {
      throw new SharedAccessError("revoked", "A revoked access cannot be changed", 409);
    }
    const next = { ...row, link_version: row.link_version + 1 };
    this.store.transaction(() => {
      this.store.updateAccess(id, {
        code: row.code !== null ? this.freshCode() : null,
        link_version: next.link_version,
        link_token_hash: sha256(this.linkToken(next)),
      });
      if (cutPhones) this.store.deletePhones(id);
      this.journal(row, "code_changed", {
        actor,
        reason: cutPhones ? "phones_cut" : "phones_kept",
      });
    });
    if (cutPhones) this.resolvePhoneAlarm(row);
    this.changed();
    return this.getAccess(id);
  }

  setArmed(equipmentId: string, armed: boolean, actor: string): { armed: boolean; people: number } {
    this.assertEnabled();
    const equipment = this.equipments.getById(equipmentId);
    if (!equipment) throw new SharedAccessError("unknown_gate", "Unknown equipment", 404);
    if (equipment.type !== "gate") {
      throw new SharedAccessError("unsupported_equipment", "Not a gate", 422);
    }
    this.store.setArmed(equipmentId, armed, actor, this.now());
    this.logger.info({ equipmentId, armed }, "Shared access: gate armed switch changed");
    this.changed();
    return this.gatePanel(equipmentId);
  }

  // ── Profiles (R9) ────────────────────────────────────────────

  private profileLinks(id: string): GateLinkRow[] {
    return this.store.profileGates(id);
  }

  getProfile(id: string): SharedAccessProfileView {
    const row = this.store.getProfile(id);
    if (!row) throw new SharedAccessError("not_found", "Unknown profile", 404);
    return this.profileView(row, this.profileLinks(id), this.equipmentNames());
  }

  /** R9.33 — created once, when the feature is first turned on. */
  ensureDefaultProfile(): void {
    if (this.store.getDefaultProfile()) return;
    const gates = this.gateEquipments();
    const id = crypto.randomUUID();
    this.store.transaction(() => {
      this.store.insertProfile({
        id,
        name: DEFAULT_PROFILE_NAME,
        plugin_id: null,
        is_default: 1,
        valid_from: null,
        valid_until: null,
        time_windows: "[]",
        with_code: 1,
        created_at: this.now(),
      });
      if (gates.length === 1) {
        const { has, values } = this.commandValues(gates[0].id);
        if (has) {
          const value =
            values.length <= 1
              ? null
              : JSON.stringify(values.includes("open") ? "open" : values[0]);
          this.store.setProfileGates(id, [{ equipmentId: gates[0].id, value }]);
        }
      }
    });
    this.logger.info({ profileId: id }, "Shared access: default profile created");
  }

  private profileFields(input: ProfileInput, current?: ProfileRow): Partial<ProfileRow> {
    const fields: Partial<ProfileRow> = {};
    if (input.name !== undefined || !current) {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) throw new SharedAccessError("name_required", "The name is required");
      fields.name = name.slice(0, 80);
    }
    const from =
      input.validFrom !== undefined
        ? parseInstant(input.validFrom, "validFrom")
        : (current?.valid_from ?? null);
    const until =
      input.validUntil !== undefined
        ? parseInstant(input.validUntil, "validUntil")
        : (current?.valid_until ?? null);
    checkPeriod(from, until);
    fields.valid_from = from;
    fields.valid_until = until;
    if (input.timeWindows !== undefined || !current) {
      fields.time_windows = JSON.stringify(validateTimeWindows(input.timeWindows));
    }
    if (input.withCode !== undefined || !current)
      fields.with_code = input.withCode === false ? 0 : 1;
    if (input.pluginId !== undefined || !current) {
      fields.plugin_id =
        typeof input.pluginId === "string" && input.pluginId.trim() ? input.pluginId.trim() : null;
    }
    return fields;
  }

  createProfile(input: ProfileInput): SharedAccessProfileView {
    this.assertEnabled();
    const fields = this.profileFields(input);
    const gates = this.validateGates(input.gates ?? [], false);
    const id = crypto.randomUUID();
    this.store.transaction(() => {
      this.store.insertProfile({
        id,
        name: fields.name ?? "",
        plugin_id: fields.plugin_id ?? null,
        is_default: 0,
        valid_from: fields.valid_from ?? null,
        valid_until: fields.valid_until ?? null,
        time_windows: fields.time_windows ?? "[]",
        with_code: fields.with_code ?? 1,
        created_at: this.now(),
      });
      this.store.setProfileGates(id, gates);
    });
    this.changed();
    return this.getProfile(id);
  }

  updateProfile(id: string, input: ProfileInput): SharedAccessProfileView {
    this.assertEnabled();
    const row = this.store.getProfile(id);
    if (!row) throw new SharedAccessError("not_found", "Unknown profile", 404);
    const fields = this.profileFields(input, row);
    const gates = input.gates !== undefined ? this.validateGates(input.gates, false) : null;
    this.store.transaction(() => {
      this.store.updateProfile(id, fields);
      if (gates) this.store.setProfileGates(id, gates);
    });
    this.changed();
    return this.getProfile(id);
  }

  /** The accesses made from it keep their gates until their own end. */
  deleteProfile(id: string): void {
    this.assertEnabled();
    const row = this.store.getProfile(id);
    if (!row) throw new SharedAccessError("not_found", "Unknown profile", 404);
    if (row.is_default === 1) {
      throw new SharedAccessError("default_profile", "The default profile cannot be deleted", 422);
    }
    this.store.deleteProfile(id);
    this.changed();
  }

  // ── The phone (R5, R6) ───────────────────────────────────────

  private phoneOf(token: string) {
    const phone = token ? this.store.getPhoneByHash(sha256(token)) : undefined;
    if (!phone) return null;
    const access = this.store.getAccess(phone.access_id);
    // A revoked access no longer knows its phones: the page falls back to the
    // code screen, and the phone can no longer write to the journal.
    return access && access.revoked_at === null ? { phone, access } : null;
  }

  /**
   * R6.24 — the code or link is looked up first; only failures are counted,
   * and only failures are held back. A correct code is never slowed.
   */
  async enrol(input: { code?: unknown; link?: unknown }, userAgent: string): Promise<EnrolResult> {
    this.assertEnabled();
    let row: AccessRow | undefined;
    if (typeof input.link === "string" && input.link) {
      row = this.store.getAccessByLinkHash(sha256(input.link));
    } else if (typeof input.code === "string") {
      const code = normalizeCode(input.code);
      row = code ? this.store.getAccessByCode(code) : undefined;
    }
    if (!row) {
      const outcome = await this.guessing.fail();
      return { ok: false, error: outcome === "too_many" ? "too_many" : "unknown_code" };
    }
    const ids = this.store.accessGates(row.id).map((l) => l.equipment_id);
    if (hasEnded(this.facts(row, ids), this.now())) return { ok: false, error: "ended" };

    if (this.store.countPhones(row.id) >= MAX_PHONES_PER_ACCESS) {
      return { ok: false, error: "too_many_phones" };
    }
    const token = generatePhoneToken();
    const now = this.now();
    const phoneId = crypto.randomUUID();
    this.store.insertPhone({
      id: phoneId,
      access_id: row.id,
      token_hash: sha256(token),
      first_seen_at: now,
      last_seen_at: now,
      user_agent: userAgent.slice(0, 300),
    });
    this.journal(row, "enrolled", { phone_id: phoneId });
    const phones = this.store.countPhones(row.id);
    if (phones > PHONES_BEFORE_ALARM && !this.phoneAlarms.has(row.id)) {
      this.phoneAlarms.add(row.id);
      this.eventBus.emit({
        type: "system.alarm.raised",
        alarmId: `shared-access:phones:${row.id}`,
        level: "warning",
        source: ALARM_SOURCE,
        message: `Shared access « ${row.label} »: ${phones} phones set up`,
      });
    }
    this.changed();
    return { ok: true, token, session: this.buildSession(row, phoneId) };
  }

  private resolvePhoneAlarm(row: Pick<AccessRow, "id" | "label">): void {
    if (!this.phoneAlarms.delete(row.id)) return;
    this.eventBus.emit({
      type: "system.alarm.resolved",
      alarmId: `shared-access:phones:${row.id}`,
      source: ALARM_SOURCE,
      message: `Shared access « ${row.label} »: phones reset`,
    });
  }

  /**
   * R5.22 — the link a phone shows as a QR code to bring another phone in.
   * Null when the token is unknown; refused once the access has ended, or
   * while the house has no public address.
   */
  shareLink(token: string): { url: string } | { error: "ended" | "no_public_url" } | null {
    this.assertEnabled();
    const found = this.phoneOf(token);
    if (!found) return null;
    const ids = this.store.accessGates(found.access.id).map((l) => l.equipment_id);
    if (hasEnded(this.facts(found.access, ids), this.now())) return { error: "ended" };
    const url = this.invitationUrl(found.access);
    return url ? { url } : { error: "no_public_url" };
  }

  /** What the phone sees. Null when the token is unknown (the page asks for a code again). */
  session(token: string): PublicSession | null {
    this.assertEnabled();
    const found = this.phoneOf(token);
    if (!found) return null;
    this.store.touchPhone(found.phone.id, this.now());
    return this.buildSession(found.access, found.phone.id);
  }

  private buildSession(row: AccessRow, phoneId: string): PublicSession {
    const links = this.store.accessGates(row.id);
    const names = this.equipmentNames();
    const now = this.now();
    const facts = this.facts(
      row,
      links.map((l) => l.equipment_id),
    );
    const status = accessStatus(facts, now);
    const next = status === "outside_hours" ? nextWindowOpening(facts.timeWindows, now) : null;
    return {
      label: row.label,
      status,
      gates: links.map((l) => ({ id: l.equipment_id, name: names.get(l.equipment_id) ?? "" })),
      activeAt: status === "not_yet" ? iso(row.valid_from) : null,
      nextOpeningAt: iso(next),
      validUntil: iso(row.valid_until),
      travelS: DEFAULT_TRAVEL_S,
      presses: this.store.phonePresses(phoneId, 8).map((p) => ({
        at: new Date(p.at).toISOString(),
        gateId: p.equipment_id,
        gateName: p.equipment_id ? (names.get(p.equipment_id) ?? "") : "",
        result: p.kind === "opened" ? "sent" : (p.reason ?? "refused"),
      })),
    };
  }

  /** R4.12 then R4.13: what a press on this gate would meet right now. */
  private checkPress(
    access: AccessRow,
    gateId: string,
    now: number,
  ):
    | { ok: true; link: GateLinkRow }
    | { ok: false; reason: SharedAccessRefusal; activeAt?: number; nextOpeningAt?: number } {
    const links = this.store.accessGates(access.id);
    const disarmed = this.store.disarmedGates();
    const decision = decide(
      this.facts(
        access,
        links.map((l) => l.equipment_id),
      ),
      gateId,
      now,
      (id) => !disarmed.has(id),
    );
    if (!decision.ok) return decision;
    if (
      this.store.opensOfAccessSince(access.id, now - HOUR_MS) >= OPENS_PER_HOUR_PER_ACCESS ||
      this.store.opensOfGateSince(gateId, now - HOUR_MS) >= OPENS_PER_HOUR_PER_GATE
    ) {
      return { ok: false, reason: "too_many_opens" };
    }
    return { ok: true, link: links.find((l) => l.equipment_id === gateId)! };
  }

  /** R4 — decide, then send the gate's own command through executeOrder. */
  async open(token: string, gateId: string): Promise<OpenResult | null> {
    this.assertEnabled();
    const found = this.phoneOf(token);
    if (!found) return null;
    const { phone, access } = found;
    const now = this.now();
    this.store.touchPhone(phone.id, now);
    const first = this.checkPress(access, gateId, now);
    if (!first.ok) return this.refuse(access, phone.id, gateId, first.reason, first);
    if (!this.queue.acceptPress(`${access.id}:${gateId}`, now)) {
      return { ok: true, duplicate: true };
    }

    const source: OrderSource = { kind: "shared_access", accessId: access.id, label: access.label };
    let refusal: { reason: SharedAccessRefusal; activeAt?: number; nextOpeningAt?: number } | null =
      null;
    let error: string | null = null;
    try {
      await this.queue.run(gateId, async () => {
        // The press may have waited behind another one on this gate. What was
        // decided before the wait is decided again: a revoke, a hold or a disarm
        // made meanwhile stops it, and the openings the presses ahead of it made
        // count against the ceilings.
        const fresh = this.store.getAccess(access.id);
        if (!fresh || fresh.revoked_at !== null) {
          refusal = { reason: "revoked" };
          return;
        }
        const check = this.checkPress(fresh, gateId, this.now());
        if (!check.ok) {
          refusal = check;
          return;
        }
        const outcome = await this.equipments.executeOrder(
          gateId,
          "command",
          parseValue(check.link.value),
          source,
        );
        if (!outcome.success) {
          error = outcome.error ?? "dispatch failed";
          return;
        }
        const at = this.now();
        this.store.updateAccess(access.id, { last_used_at: at, use_count: fresh.use_count + 1 });
        this.journal(fresh, "opened", { equipment_id: gateId, phone_id: phone.id });
      });
    } catch (err) {
      error = err instanceof GateQueueClosedError ? "shutting down" : (err as Error).message;
    }
    const refused = refusal as {
      reason: SharedAccessRefusal;
      activeAt?: number;
      nextOpeningAt?: number;
    } | null;
    if (refused) return this.refuse(access, phone.id, gateId, refused.reason, refused);
    if (error !== null) {
      this.logger.warn(
        { accessId: access.id, gateId, error },
        "Shared access: gate command failed",
      );
      return this.refuse(access, phone.id, gateId, "gate_error");
    }

    this.logger.info({ accessId: access.id, gateId }, "Shared access: gate opened");
    this.eventBus.emit({
      type: "shared_access.opened",
      accessId: access.id,
      label: access.label,
      equipmentId: gateId,
    });
    this.changed();
    return { ok: true };
  }

  private refuse(
    access: AccessRow,
    phoneId: string,
    gateId: string | null,
    reason: SharedAccessRefusal,
    when: { activeAt?: number; nextOpeningAt?: number } = {},
  ): OpenResult {
    // Only a gate this access lists is named in the journal: an id the phone
    // made up is not the house's business.
    const listed = this.store.accessGates(access.id).some((l) => l.equipment_id === gateId);
    const equipmentId = listed ? gateId : null;
    const now = this.now();
    const key = `${reason}:${equipmentId ?? ""}`;
    const last = this.lastRefusal.get(phoneId);
    if (!last || last.key !== key || now - last.at >= REFUSAL_REPEAT_MS) {
      this.lastRefusal.set(phoneId, { key, at: now });
      if (this.lastRefusal.size > 5000) {
        for (const [id, r] of this.lastRefusal) {
          if (now - r.at >= REFUSAL_REPEAT_MS) this.lastRefusal.delete(id);
        }
      }
      this.journal(access, "refused", { reason, equipment_id: equipmentId, phone_id: phoneId });
      this.eventBus.emit({
        type: "shared_access.refused",
        accessId: access.id,
        label: access.label,
        equipmentId,
        reason,
      });
    }
    return {
      ok: false,
      reason,
      ...(when.activeAt !== undefined ? { activeAt: new Date(when.activeAt).toISOString() } : {}),
      ...(when.nextOpeningAt !== undefined
        ? { nextOpeningAt: new Date(when.nextOpeningAt).toISOString() }
        : {}),
    };
  }

  // ── Plugins (R9) ─────────────────────────────────────────────

  pluginProfiles(
    pluginId: string,
  ): { id: string; name: string; isDefault: boolean; complete: boolean }[] {
    this.assertEnabled();
    const links = this.groupLinks(this.store.allProfileGates());
    return this.store
      .listProfiles()
      .filter((p) => p.plugin_id === pluginId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        isDefault: p.is_default === 1,
        complete: (links.get(p.id) ?? []).length > 0,
      }));
  }

  private pluginInvitation(row: AccessRow): PluginInvitation {
    return {
      id: row.id,
      code: row.code ? formatCode(row.code) : null,
      invitationUrl: this.invitationUrl(row),
    };
  }

  /**
   * R9.34 — one stay, one key. Idempotent on (plugin, externalId). The plugin
   * gives who and when; the profile gives what opens and at what hours.
   */
  pluginUpsert(
    pluginId: string,
    externalId: unknown,
    input: { profileId?: unknown; label?: unknown; from?: unknown; until?: unknown },
  ): PluginInvitation {
    this.assertEnabled();
    if (typeof externalId !== "string" || !externalId.trim()) {
      throw new SharedAccessError("external_id_required", "externalId is required");
    }
    const label = this.requireLabel(input.label);
    const stayFrom = parseInstant(input.from, "from");
    const stayUntil = parseInstant(input.until, "until");
    if (stayUntil === null) throw new NoEndError();
    checkPeriod(stayFrom, stayUntil);

    let profile: ProfileRow | undefined;
    if (input.profileId !== undefined && input.profileId !== null) {
      profile =
        typeof input.profileId === "string" ? this.store.getProfile(input.profileId) : undefined;
      if (!profile || profile.plugin_id !== pluginId) throw new UnknownProfileError();
    } else {
      profile = this.store.getDefaultProfile();
      if (!profile || profile.plugin_id !== pluginId) {
        throw new UnknownProfileError("The default profile is not granted to this plugin");
      }
    }

    // The stay, inside the profile's own dates.
    const sourceFrom =
      profile.valid_from === null
        ? stayFrom
        : stayFrom === null
          ? profile.valid_from
          : Math.max(stayFrom, profile.valid_from);
    const sourceUntil =
      profile.valid_until === null ? stayUntil : Math.min(stayUntil, profile.valid_until);
    if (sourceFrom !== null && sourceUntil <= sourceFrom) {
      throw new SharedAccessError(
        "outside_profile",
        "The stay falls outside the profile's dates",
        422,
      );
    }

    const existing = this.store.getAccessByExternal(pluginId, externalId);
    if (existing) {
      if (existing.revoked_at !== null) return this.pluginInvitation(existing);
      const fields: Partial<AccessRow> = {
        label,
        source_from: sourceFrom,
        source_until: sourceUntil,
      };
      Object.assign(fields, this.effectiveExternal({ ...existing, ...fields }));
      const unchanged =
        existing.label === label &&
        existing.source_from === sourceFrom &&
        existing.source_until === sourceUntil &&
        existing.valid_from === fields.valid_from &&
        existing.valid_until === fields.valid_until;
      if (!unchanged) {
        this.store.transaction(() => {
          this.store.updateAccess(existing.id, fields);
          this.journal({ id: existing.id, label }, "updated", { actor: `plugin:${pluginId}` });
        });
        this.changed();
      }
      return this.pluginInvitation(this.getRow(existing.id));
    }

    const gates = this.profileLinks(profile.id).map((l) => ({
      equipmentId: l.equipment_id,
      value: l.value,
    }));
    if (gates.length === 0) throw new ProfileIncompleteError();

    const id = crypto.randomUUID();
    const row: AccessRow = {
      id,
      kind: "external",
      label,
      code: profile.with_code === 1 ? this.freshCode() : null,
      link_version: 1,
      link_token_hash: "",
      valid_from: sourceFrom,
      valid_until: sourceUntil,
      source_plugin: pluginId,
      external_id: externalId,
      profile_id: profile.id,
      source_from: sourceFrom,
      source_until: sourceUntil,
      early_open_at: null,
      extended_until: null,
      time_windows: profile.time_windows,
      suspended_at: null,
      revoked_at: null,
      created_at: this.now(),
      created_by: `plugin:${pluginId}`,
      last_used_at: null,
      use_count: 0,
    };
    row.link_token_hash = sha256(this.linkToken(row));
    this.store.transaction(() => {
      this.store.insertAccess(row);
      this.store.setAccessGates(id, gates);
      this.journal(row, "created", { actor: `plugin:${pluginId}` });
    });
    this.logger.info({ accessId: id, pluginId, externalId }, "Shared access created by a plugin");
    this.changed();
    return this.pluginInvitation(row);
  }

  pluginRevoke(pluginId: string, externalId: unknown): void {
    this.assertEnabled();
    if (typeof externalId !== "string") return;
    const row = this.store.getAccessByExternal(pluginId, externalId);
    if (!row || row.revoked_at !== null) return;
    this.store.updateAccess(row.id, { revoked_at: this.now() });
    this.journal(row, "revoked", { actor: `plugin:${pluginId}` });
    this.resolvePhoneAlarm(row);
    this.changed();
  }

  pluginList(pluginId: string): {
    externalId: string;
    state: SharedAccessStatus;
    code: string | null;
    invitationUrl: string | null;
  }[] {
    this.assertEnabled();
    const links = this.groupLinks(this.store.allAccessGates());
    const now = this.now();
    return this.store.listAccessesOfPlugin(pluginId).map((r) => ({
      externalId: r.external_id ?? "",
      state: accessStatus(
        this.facts(
          r,
          (links.get(r.id) ?? []).map((l) => l.equipment_id),
        ),
        now,
      ),
      code: r.code ? formatCode(r.code) : null,
      invitationUrl: this.invitationUrl(r),
    }));
  }

  // ── Housekeeping (R10) ───────────────────────────────────────

  purge(): void {
    try {
      const now = this.now();
      const result = this.store.purge({
        codesEndedBefore: now - CODE_KEPT_AFTER_END_MS,
        journalBefore: now - JOURNAL_KEPT_MS,
        journalMax: JOURNAL_MAX_ROWS,
      });
      if (result.codes > 0 || result.journal > 0) {
        this.logger.info(result, "Shared access housekeeping");
      }
    } catch (err) {
      this.logger.error({ err }, "Shared access housekeeping failed");
    }
  }
}
