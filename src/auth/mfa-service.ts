import { randomUUID, randomBytes, createHash, randomInt } from "node:crypto";
import { OTP } from "otplib";
import QRCode from "qrcode";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { UserManager } from "./user-manager.js";
import type { MfaStatus, MfaTrustedDevice } from "../shared/types.js";
import { toISOUtc } from "../core/database.js";

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LOW_WATERMARK = 2;
const TOTP_ISSUER = "Sowel";
// ±1 time step (30s) of clock drift tolerance, symmetric.
const TOTP_EPOCH_TOLERANCE_S = 30;

export const DEFAULT_TRUSTED_DEVICE_DAYS = 30;
export const MIN_TRUSTED_DEVICE_DAYS = 1;
export const MAX_TRUSTED_DEVICE_DAYS = 90;

// Excludes ambiguous characters (0/O, 1/I/L).
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const totp = new OTP({ strategy: "totp" });

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

// ============================================================
// MfaService — TOTP enrollment, verification, backup codes,
// trusted devices (Spec 151)
// ============================================================

export class MfaService {
  private db: Database.Database;
  private userManager: UserManager;
  private logger: Logger;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, userManager: UserManager, logger: Logger) {
    this.db = db;
    this.userManager = userManager;
    this.logger = logger.child({ module: "mfa-service" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      upsertPendingTotp: this.db.prepare(
        `INSERT INTO user_mfa_totp (user_id, secret, confirmed_at)
         VALUES (@userId, @secret, NULL)
         ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, confirmed_at = NULL,
           created_at = CURRENT_TIMESTAMP`,
      ),
      getTotp: this.db.prepare("SELECT * FROM user_mfa_totp WHERE user_id = ?"),
      confirmTotp: this.db.prepare(
        "UPDATE user_mfa_totp SET confirmed_at = CURRENT_TIMESTAMP WHERE user_id = ?",
      ),
      deleteTotp: this.db.prepare("DELETE FROM user_mfa_totp WHERE user_id = ?"),

      insertBackupCode: this.db.prepare(
        "INSERT INTO user_mfa_backup_codes (id, user_id, code_hash) VALUES (@id, @userId, @codeHash)",
      ),
      getUnusedBackupCodeByHash: this.db.prepare(
        "SELECT * FROM user_mfa_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
      ),
      markBackupCodeUsed: this.db.prepare(
        "UPDATE user_mfa_backup_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
      countUnusedBackupCodes: this.db.prepare(
        "SELECT COUNT(*) as count FROM user_mfa_backup_codes WHERE user_id = ? AND used_at IS NULL",
      ),
      deleteUnusedBackupCodes: this.db.prepare(
        "DELETE FROM user_mfa_backup_codes WHERE user_id = ? AND used_at IS NULL",
      ),
      deleteAllBackupCodes: this.db.prepare("DELETE FROM user_mfa_backup_codes WHERE user_id = ?"),

      insertTrustedDevice: this.db.prepare(
        `INSERT INTO mfa_trusted_devices (id, user_id, token_hash, user_agent, expires_at)
         VALUES (@id, @userId, @tokenHash, @userAgent, datetime('now', '+' || @days || ' days'))`,
      ),
      getTrustedDeviceByHash: this.db.prepare(
        `SELECT * FROM mfa_trusted_devices
         WHERE user_id = ? AND token_hash = ? AND expires_at > datetime('now')`,
      ),
      listTrustedDevices: this.db.prepare(
        `SELECT id, user_agent, expires_at, created_at FROM mfa_trusted_devices
         WHERE user_id = ? ORDER BY created_at DESC`,
      ),
      deleteTrustedDevice: this.db.prepare(
        "DELETE FROM mfa_trusted_devices WHERE id = ? AND user_id = ?",
      ),
      deleteAllTrustedDevices: this.db.prepare("DELETE FROM mfa_trusted_devices WHERE user_id = ?"),
    };
  }

  // ============================================================
  // Enrollment
  // ============================================================

  /** Starts (or restarts) enrollment. Replaces any previous unconfirmed secret. */
  async beginEnrollment(userId: string, username: string): Promise<MfaSetup> {
    const secret = totp.generateSecret();
    this.stmts.upsertPendingTotp.run({ userId, secret });

    const otpauthUrl = totp.generateURI({
      issuer: TOTP_ISSUER,
      label: username,
      secret,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    this.logger.info({ userId }, "MFA enrollment started");
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Confirms a pending enrollment with the current TOTP code. On success,
   * generates a fresh set of backup codes (returned once, plaintext) and
   * marks the account as MFA-enabled.
   */
  async confirmEnrollment(userId: string, code: string): Promise<{ backupCodes: string[] } | null> {
    const row = this.stmts.getTotp.get(userId) as TotpRow | undefined;
    if (!row || row.confirmed_at) return null;

    const valid = await this.verifyTotpCode(row.secret, code);
    if (!valid) return null;

    this.stmts.confirmTotp.run(userId);
    const backupCodes = this.regenerateBackupCodesInternal(userId);

    this.logger.info({ userId }, "MFA enabled");
    return { backupCodes };
  }

  isMfaEnabled(userId: string): boolean {
    const row = this.stmts.getTotp.get(userId) as TotpRow | undefined;
    return !!row?.confirmed_at;
  }

  getStatus(userId: string): MfaStatus {
    const row = this.stmts.getTotp.get(userId) as TotpRow | undefined;
    const { count } = this.stmts.countUnusedBackupCodes.get(userId) as { count: number };
    return {
      enabled: !!row?.confirmed_at,
      confirmedAt: row?.confirmed_at ? toISOUtc(row.confirmed_at) : null,
      backupCodesRemaining: count,
    };
  }

  /** True when the account has confirmed MFA and ≤ the low-watermark of unused backup codes remain. */
  isLowOnBackupCodes(userId: string): boolean {
    if (!this.isMfaEnabled(userId)) return false;
    const { count } = this.stmts.countUnusedBackupCodes.get(userId) as { count: number };
    return count <= BACKUP_CODE_LOW_WATERMARK;
  }

  // ============================================================
  // Verification
  // ============================================================

  /** Verifies a live TOTP code against the account's *confirmed* secret. */
  async verifyTotp(userId: string, code: string): Promise<boolean> {
    const row = this.stmts.getTotp.get(userId) as TotpRow | undefined;
    if (!row || !row.confirmed_at) return false;
    return this.verifyTotpCode(row.secret, code);
  }

  /** Verifies and, on success, consumes a single-use backup code. */
  verifyBackupCode(userId: string, code: string): boolean {
    const hash = hashCode(normalizeBackupCode(code));
    const row = this.stmts.getUnusedBackupCodeByHash.get(userId, hash) as BackupCodeRow | undefined;
    if (!row) return false;

    this.stmts.markBackupCodeUsed.run(row.id);
    this.logger.info({ userId }, "Backup code consumed");
    return true;
  }

  private async verifyTotpCode(secret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const result = await totp.verify({
      secret,
      token: code,
      epochTolerance: TOTP_EPOCH_TOLERANCE_S,
    });
    return result.valid;
  }

  // ============================================================
  // Backup codes
  // ============================================================

  regenerateBackupCodes(userId: string): string[] {
    const codes = this.regenerateBackupCodesInternal(userId);
    this.logger.info({ userId }, "Backup codes regenerated");
    return codes;
  }

  private regenerateBackupCodesInternal(userId: string): string[] {
    this.stmts.deleteUnusedBackupCodes.run(userId);

    const codes: string[] = [];
    const insertMany = this.db.transaction((plainCodes: string[]) => {
      for (const code of plainCodes) {
        this.stmts.insertBackupCode.run({
          id: randomUUID(),
          userId,
          codeHash: hashCode(normalizeBackupCode(code)),
        });
      }
    });

    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      codes.push(generateBackupCode());
    }
    insertMany(codes);

    return codes;
  }

  // ============================================================
  // Disable
  // ============================================================

  disable(userId: string): void {
    const tx = this.db.transaction(() => {
      this.stmts.deleteTotp.run(userId);
      this.stmts.deleteAllBackupCodes.run(userId);
      this.stmts.deleteAllTrustedDevices.run(userId);
    });
    tx();
    this.logger.info({ userId }, "MFA disabled");
  }

  // ============================================================
  // Trusted devices
  // ============================================================

  issueTrustedDevice(
    userId: string,
    userAgent: string | null,
  ): { token: string; expiresAt: string } {
    const user = this.userManager.getById(userId);
    const days = clampTrustedDeviceDays(user?.preferences.mfaTrustedDeviceDays);

    const token = randomBytes(32).toString("hex");
    const id = randomUUID();
    this.stmts.insertTrustedDevice.run({
      id,
      userId,
      tokenHash: hashCode(token),
      userAgent,
      days,
    });

    const row = this.db
      .prepare("SELECT expires_at FROM mfa_trusted_devices WHERE id = ?")
      .get(id) as { expires_at: string };

    this.logger.info({ userId, days }, "Trusted device issued");
    return { token, expiresAt: toISOUtc(row.expires_at) };
  }

  checkTrustedDevice(userId: string, token: string): boolean {
    const row = this.stmts.getTrustedDeviceByHash.get(userId, hashCode(token));
    return !!row;
  }

  listTrustedDevices(userId: string): MfaTrustedDevice[] {
    const rows = this.stmts.listTrustedDevices.all(userId) as Array<{
      id: string;
      user_agent: string | null;
      expires_at: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      userAgent: r.user_agent,
      expiresAt: toISOUtc(r.expires_at),
      createdAt: toISOUtc(r.created_at),
    }));
  }

  revokeTrustedDevice(id: string, userId: string): boolean {
    const result = this.stmts.deleteTrustedDevice.run(id, userId);
    return result.changes > 0;
  }

  revokeAllTrustedDevices(userId: string): void {
    this.stmts.deleteAllTrustedDevices.run(userId);
  }
}

// ============================================================
// Helpers
// ============================================================

export function clampTrustedDeviceDays(days: number | undefined): number {
  if (days === undefined || !Number.isFinite(days)) return DEFAULT_TRUSTED_DEVICE_DAYS;
  return Math.min(MAX_TRUSTED_DEVICE_DAYS, Math.max(MIN_TRUSTED_DEVICE_DAYS, Math.round(days)));
}

function hashCode(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/-/g, "");
}

function generateBackupCode(): string {
  let raw = "";
  for (let i = 0; i < 10; i++) {
    raw += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

interface TotpRow {
  user_id: string;
  secret: string;
  confirmed_at: string | null;
  created_at: string;
}

interface BackupCodeRow {
  id: string;
  user_id: string;
  code_hash: string;
  used_at: string | null;
  created_at: string;
}
