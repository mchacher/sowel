import type Database from "better-sqlite3";

// ============================================================
// Spec 181 — SQLite reads and writes. No rule lives here: every caller goes
// through SharedAccessManager, which is what keeps « a suspended access cannot
// open » true for the owner's routes, the public routes and plugins at once.
// ============================================================

export interface AccessRow {
  id: string;
  kind: "manual" | "external";
  label: string;
  code: string | null;
  link_version: number;
  link_token_hash: string;
  valid_from: number | null;
  valid_until: number | null;
  source_plugin: string | null;
  external_id: string | null;
  profile_id: string | null;
  source_from: number | null;
  source_until: number | null;
  early_open_at: number | null;
  extended_until: number | null;
  time_windows: string;
  suspended_at: number | null;
  revoked_at: number | null;
  created_at: number;
  created_by: string;
  last_used_at: number | null;
  use_count: number;
}

export interface GateLinkRow {
  owner_id: string;
  equipment_id: string;
  value: string | null;
}

export interface ProfileRow {
  id: string;
  name: string;
  plugin_id: string | null;
  is_default: number;
  valid_from: number | null;
  valid_until: number | null;
  time_windows: string;
  with_code: number;
  created_at: number;
}

export interface PhoneRow {
  id: string;
  access_id: string;
  token_hash: string;
  first_seen_at: number;
  last_seen_at: number;
  user_agent: string;
}

export interface JournalRow {
  id: number;
  at: number;
  access_id: string | null;
  label: string;
  kind: string;
  reason: string | null;
  actor: string | null;
  equipment_id: string | null;
  phone_id: string | null;
}

export type JournalInput = Omit<JournalRow, "id">;

/** Columns of `shared_accesses` a caller may change after creation. */
const ACCESS_MUTABLE = new Set<keyof AccessRow>([
  "label",
  "code",
  "link_version",
  "link_token_hash",
  "valid_from",
  "valid_until",
  "profile_id",
  "source_from",
  "source_until",
  "early_open_at",
  "extended_until",
  "time_windows",
  "suspended_at",
  "revoked_at",
  "last_used_at",
  "use_count",
]);

const PROFILE_MUTABLE = new Set<keyof ProfileRow>([
  "name",
  "plugin_id",
  "valid_from",
  "valid_until",
  "time_windows",
  "with_code",
]);

export class SharedAccessStore {
  private readonly stmts;

  constructor(private readonly db: Database.Database) {
    this.stmts = {
      listAccesses: db.prepare(`SELECT * FROM shared_accesses ORDER BY created_at DESC`),
      getAccess: db.prepare(`SELECT * FROM shared_accesses WHERE id = ?`),
      byCode: db.prepare(`SELECT * FROM shared_accesses WHERE code = ?`),
      byLink: db.prepare(`SELECT * FROM shared_accesses WHERE link_token_hash = ?`),
      byExternal: db.prepare(
        `SELECT * FROM shared_accesses WHERE source_plugin = ? AND external_id = ?`,
      ),
      byPlugin: db.prepare(
        `SELECT * FROM shared_accesses WHERE source_plugin = ? ORDER BY created_at DESC`,
      ),
      insertAccess: db.prepare(
        `INSERT INTO shared_accesses
           (id, kind, label, code, link_version, link_token_hash, valid_from, valid_until,
            source_plugin, external_id, profile_id, source_from, source_until, early_open_at,
            extended_until, time_windows, suspended_at, revoked_at, created_at, created_by,
            last_used_at, use_count)
         VALUES
           (@id, @kind, @label, @code, @link_version, @link_token_hash, @valid_from, @valid_until,
            @source_plugin, @external_id, @profile_id, @source_from, @source_until, @early_open_at,
            @extended_until, @time_windows, @suspended_at, @revoked_at, @created_at, @created_by,
            @last_used_at, @use_count)`,
      ),
      deleteAccess: db.prepare(`DELETE FROM shared_accesses WHERE id = ?`),
      codeInUse: db.prepare(`SELECT 1 FROM shared_accesses WHERE code = ?`),

      allAccessGates: db.prepare(
        `SELECT access_id AS owner_id, equipment_id, value FROM shared_access_gates`,
      ),
      accessGates: db.prepare(
        `SELECT access_id AS owner_id, equipment_id, value FROM shared_access_gates WHERE access_id = ?`,
      ),
      clearAccessGates: db.prepare(`DELETE FROM shared_access_gates WHERE access_id = ?`),
      insertAccessGate: db.prepare(
        `INSERT INTO shared_access_gates (access_id, equipment_id, value) VALUES (?, ?, ?)`,
      ),

      listProfiles: db.prepare(
        `SELECT * FROM shared_access_profiles ORDER BY is_default DESC, created_at ASC`,
      ),
      getProfile: db.prepare(`SELECT * FROM shared_access_profiles WHERE id = ?`),
      defaultProfile: db.prepare(`SELECT * FROM shared_access_profiles WHERE is_default = 1`),
      insertProfile: db.prepare(
        `INSERT INTO shared_access_profiles
           (id, name, plugin_id, is_default, valid_from, valid_until, time_windows, with_code, created_at)
         VALUES
           (@id, @name, @plugin_id, @is_default, @valid_from, @valid_until, @time_windows, @with_code, @created_at)`,
      ),
      deleteProfile: db.prepare(`DELETE FROM shared_access_profiles WHERE id = ?`),
      allProfileGates: db.prepare(
        `SELECT profile_id AS owner_id, equipment_id, value FROM shared_access_profile_gates`,
      ),
      profileGates: db.prepare(
        `SELECT profile_id AS owner_id, equipment_id, value FROM shared_access_profile_gates WHERE profile_id = ?`,
      ),
      clearProfileGates: db.prepare(`DELETE FROM shared_access_profile_gates WHERE profile_id = ?`),
      insertProfileGate: db.prepare(
        `INSERT INTO shared_access_profile_gates (profile_id, equipment_id, value) VALUES (?, ?, ?)`,
      ),

      listDisarmed: db.prepare(`SELECT equipment_id FROM shared_access_disarmed`),
      disarm: db.prepare(
        `INSERT INTO shared_access_disarmed (equipment_id, disarmed_at, disarmed_by) VALUES (?, ?, ?)
         ON CONFLICT(equipment_id) DO NOTHING`,
      ),
      arm: db.prepare(`DELETE FROM shared_access_disarmed WHERE equipment_id = ?`),

      insertPhone: db.prepare(
        `INSERT INTO shared_access_phones (id, access_id, token_hash, first_seen_at, last_seen_at, user_agent)
         VALUES (@id, @access_id, @token_hash, @first_seen_at, @last_seen_at, @user_agent)`,
      ),
      phoneByHash: db.prepare(`SELECT * FROM shared_access_phones WHERE token_hash = ?`),
      touchPhone: db.prepare(`UPDATE shared_access_phones SET last_seen_at = ? WHERE id = ?`),
      countPhones: db.prepare(`SELECT COUNT(*) AS n FROM shared_access_phones WHERE access_id = ?`),
      phoneCounts: db.prepare(
        `SELECT access_id, COUNT(*) AS n FROM shared_access_phones GROUP BY access_id`,
      ),
      deletePhones: db.prepare(`DELETE FROM shared_access_phones WHERE access_id = ?`),
      listPhones: db.prepare(
        `SELECT * FROM shared_access_phones WHERE access_id = ? ORDER BY first_seen_at, id`,
      ),
      deletePhone: db.prepare(`DELETE FROM shared_access_phones WHERE id = ? AND access_id = ?`),

      insertJournal: db.prepare(
        `INSERT INTO shared_access_journal (at, access_id, label, kind, reason, actor, equipment_id, phone_id)
         VALUES (@at, @access_id, @label, @kind, @reason, @actor, @equipment_id, @phone_id)`,
      ),
      journalAll: db.prepare(
        `SELECT * FROM shared_access_journal ORDER BY at DESC, id DESC LIMIT ?`,
      ),
      journalOf: db.prepare(
        `SELECT * FROM shared_access_journal WHERE access_id = ? ORDER BY at DESC, id DESC LIMIT ?`,
      ),
      phonePresses: db.prepare(
        `SELECT * FROM shared_access_journal
         WHERE phone_id = ? AND kind IN ('opened', 'refused') ORDER BY at DESC, id DESC LIMIT ?`,
      ),
      insertTombstone: db.prepare(
        `INSERT OR REPLACE INTO shared_access_tombstones (plugin_id, external_id, deleted_at)
         VALUES (?, ?, ?)`,
      ),
      hasTombstone: db.prepare(
        `SELECT 1 FROM shared_access_tombstones WHERE plugin_id = ? AND external_id = ?`,
      ),
      purgeTombstones: db.prepare(`DELETE FROM shared_access_tombstones WHERE deleted_at < ?`),
      opensOfAccess: db.prepare(
        `SELECT COUNT(*) AS n FROM shared_access_journal
         WHERE access_id = ? AND kind = 'opened' AND at >= ?`,
      ),
      opensOfGate: db.prepare(
        `SELECT COUNT(*) AS n FROM shared_access_journal
         WHERE equipment_id = ? AND kind = 'opened' AND at >= ?`,
      ),
      purgeJournalOld: db.prepare(`DELETE FROM shared_access_journal WHERE at < ?`),
      purgeJournalExcess: db.prepare(
        `DELETE FROM shared_access_journal WHERE id NOT IN
           (SELECT id FROM shared_access_journal ORDER BY at DESC, id DESC LIMIT ?)`,
      ),
      nullEndedCodes: db.prepare(
        `UPDATE shared_accesses SET code = NULL
         WHERE code IS NOT NULL
           AND ((valid_until IS NOT NULL AND valid_until < @before)
             OR (revoked_at IS NOT NULL AND revoked_at < @before))`,
      ),
    };
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ── Accesses ───────────────────────────────────────────────

  listAccesses(): AccessRow[] {
    return this.stmts.listAccesses.all() as AccessRow[];
  }
  getAccess(id: string): AccessRow | undefined {
    return this.stmts.getAccess.get(id) as AccessRow | undefined;
  }
  getAccessByCode(code: string): AccessRow | undefined {
    return this.stmts.byCode.get(code) as AccessRow | undefined;
  }
  getAccessByLinkHash(hash: string): AccessRow | undefined {
    return this.stmts.byLink.get(hash) as AccessRow | undefined;
  }
  getAccessByExternal(pluginId: string, externalId: string): AccessRow | undefined {
    return this.stmts.byExternal.get(pluginId, externalId) as AccessRow | undefined;
  }
  listAccessesOfPlugin(pluginId: string): AccessRow[] {
    return this.stmts.byPlugin.all(pluginId) as AccessRow[];
  }
  insertAccess(row: AccessRow): void {
    this.stmts.insertAccess.run(row);
  }
  /** One more opening, counted in SQL: two gates of one access press in parallel. */
  countUse(id: string, at: number): void {
    this.db
      .prepare(
        `UPDATE shared_accesses SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?`,
      )
      .run(at, id);
  }

  updateAccess(id: string, fields: Partial<AccessRow>): void {
    const keys = Object.keys(fields).filter((k) => ACCESS_MUTABLE.has(k as keyof AccessRow));
    if (keys.length === 0) return;
    const sql = `UPDATE shared_accesses SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`;
    this.db.prepare(sql).run({ ...fields, id });
  }
  deleteAccess(id: string): void {
    this.stmts.deleteAccess.run(id);
  }
  codeInUse(code: string): boolean {
    return this.stmts.codeInUse.get(code) !== undefined;
  }

  allAccessGates(): GateLinkRow[] {
    return this.stmts.allAccessGates.all() as GateLinkRow[];
  }
  accessGates(accessId: string): GateLinkRow[] {
    return this.stmts.accessGates.all(accessId) as GateLinkRow[];
  }
  setAccessGates(accessId: string, gates: { equipmentId: string; value: string | null }[]): void {
    this.stmts.clearAccessGates.run(accessId);
    for (const g of gates) this.stmts.insertAccessGate.run(accessId, g.equipmentId, g.value);
  }

  // ── Profiles ───────────────────────────────────────────────

  listProfiles(): ProfileRow[] {
    return this.stmts.listProfiles.all() as ProfileRow[];
  }
  getProfile(id: string): ProfileRow | undefined {
    return this.stmts.getProfile.get(id) as ProfileRow | undefined;
  }
  getDefaultProfile(): ProfileRow | undefined {
    return this.stmts.defaultProfile.get() as ProfileRow | undefined;
  }
  insertProfile(row: ProfileRow): void {
    this.stmts.insertProfile.run(row);
  }
  updateProfile(id: string, fields: Partial<ProfileRow>): void {
    const keys = Object.keys(fields).filter((k) => PROFILE_MUTABLE.has(k as keyof ProfileRow));
    if (keys.length === 0) return;
    const sql = `UPDATE shared_access_profiles SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`;
    this.db.prepare(sql).run({ ...fields, id });
  }
  deleteProfile(id: string): void {
    this.stmts.deleteProfile.run(id);
  }
  allProfileGates(): GateLinkRow[] {
    return this.stmts.allProfileGates.all() as GateLinkRow[];
  }
  profileGates(profileId: string): GateLinkRow[] {
    return this.stmts.profileGates.all(profileId) as GateLinkRow[];
  }
  setProfileGates(profileId: string, gates: { equipmentId: string; value: string | null }[]): void {
    this.stmts.clearProfileGates.run(profileId);
    for (const g of gates) this.stmts.insertProfileGate.run(profileId, g.equipmentId, g.value);
  }

  // ── Arming ─────────────────────────────────────────────────

  disarmedGates(): Set<string> {
    return new Set(
      (this.stmts.listDisarmed.all() as { equipment_id: string }[]).map((r) => r.equipment_id),
    );
  }
  setArmed(equipmentId: string, armed: boolean, by: string, at: number): void {
    if (armed) this.stmts.arm.run(equipmentId);
    else this.stmts.disarm.run(equipmentId, at, by);
  }

  // ── Phones ─────────────────────────────────────────────────

  insertPhone(row: PhoneRow): void {
    this.stmts.insertPhone.run(row);
  }
  getPhoneByHash(hash: string): PhoneRow | undefined {
    return this.stmts.phoneByHash.get(hash) as PhoneRow | undefined;
  }
  touchPhone(id: string, at: number): void {
    this.stmts.touchPhone.run(at, id);
  }
  countPhones(accessId: string): number {
    return (this.stmts.countPhones.get(accessId) as { n: number }).n;
  }
  phoneCounts(): Map<string, number> {
    const rows = this.stmts.phoneCounts.all() as { access_id: string; n: number }[];
    return new Map(rows.map((r) => [r.access_id, r.n]));
  }
  deletePhones(accessId: string): void {
    this.stmts.deletePhones.run(accessId);
  }

  // ── Journal ────────────────────────────────────────────────

  journal(entry: JournalInput): void {
    this.stmts.insertJournal.run(entry);
  }
  listJournal(accessId: string | null, limit: number): JournalRow[] {
    return (
      accessId ? this.stmts.journalOf.all(accessId, limit) : this.stmts.journalAll.all(limit)
    ) as JournalRow[];
  }
  listPhones(accessId: string): PhoneRow[] {
    return this.stmts.listPhones.all(accessId) as PhoneRow[];
  }

  /** False when the phone is not one of this access's. */
  deletePhone(phoneId: string, accessId: string): boolean {
    return this.stmts.deletePhone.run(phoneId, accessId).changes > 0;
  }

  phonePresses(phoneId: string, limit: number): JournalRow[] {
    return this.stmts.phonePresses.all(phoneId, limit) as JournalRow[];
  }
  /** R9.34 — a deleted plugin access keeps its key, so the stay stays revoked. */
  addTombstone(pluginId: string, externalId: string, at: number): void {
    this.stmts.insertTombstone.run(pluginId, externalId, at);
  }

  hasTombstone(pluginId: string, externalId: string): boolean {
    return this.stmts.hasTombstone.get(pluginId, externalId) !== undefined;
  }

  opensOfAccessSince(accessId: string, since: number): number {
    return (this.stmts.opensOfAccess.get(accessId, since) as { n: number }).n;
  }
  opensOfGateSince(equipmentId: string, since: number): number {
    return (this.stmts.opensOfGate.get(equipmentId, since) as { n: number }).n;
  }

  // ── Housekeeping (R10) ─────────────────────────────────────

  purge(opts: { codesEndedBefore: number; journalBefore: number; journalMax: number }): {
    codes: number;
    journal: number;
  } {
    return this.transaction(() => {
      const codes = this.stmts.nullEndedCodes.run({ before: opts.codesEndedBefore }).changes;
      const old = this.stmts.purgeJournalOld.run(opts.journalBefore).changes;
      const excess = this.stmts.purgeJournalExcess.run(opts.journalMax).changes;
      this.stmts.purgeTombstones.run(opts.journalBefore);
      return { codes, journal: old + excess };
    });
  }
}
