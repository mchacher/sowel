import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { OTP } from "otplib";
import { MfaService, clampTrustedDeviceDays } from "./mfa-service.js";
import { UserManager } from "./user-manager.js";
import { createLogger } from "../core/logger.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";

const logger = createLogger("silent").logger;
const totp = new OTP({ strategy: "totp" });

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function codeAt(secret: string, epochOffsetSeconds: number): Promise<string> {
  return totp.generate({ secret, epoch: nowSeconds() + epochOffsetSeconds });
}

describe("MfaService", () => {
  let db: Database.Database;
  let userManager: UserManager;
  let mfa: MfaService;
  let userId: string;

  beforeEach(async () => {
    db = createMigratedTestDb();
    userManager = new UserManager(db, logger);
    mfa = new MfaService(db, userManager, logger);
    const user = await userManager.createUser({
      username: "alice",
      displayName: "Alice",
      password: "test-fixture-password",
      role: "admin",
    });
    userId = user.id;
  });

  afterEach(() => {
    db.close();
  });

  async function enrollAndConfirm(): Promise<{ secret: string; backupCodes: string[] }> {
    const setup = await mfa.beginEnrollment(userId, "alice");
    const code = await codeAt(setup.secret, 0);
    const result = await mfa.confirmEnrollment(userId, code);
    return { secret: setup.secret, backupCodes: result!.backupCodes };
  }

  describe("enrollment", () => {
    it("confirms with the correct code, enables MFA, and returns 10 backup codes once", async () => {
      const { backupCodes } = await enrollAndConfirm();

      expect(backupCodes).toHaveLength(10);
      expect(mfa.isMfaEnabled(userId)).toBe(true);
      const status = mfa.getStatus(userId);
      expect(status.enabled).toBe(true);
      expect(status.confirmedAt).toBeTruthy();
      expect(status.backupCodesRemaining).toBe(10);

      // Only hashes are stored — the plaintext codes must not appear in the DB.
      const rows = db
        .prepare("SELECT code_hash FROM user_mfa_backup_codes WHERE user_id = ?")
        .all(userId) as Array<{ code_hash: string }>;
      for (const plain of backupCodes) {
        expect(rows.some((r) => r.code_hash === plain)).toBe(false);
      }
    });

    it("rejects confirmation with the wrong code and leaves the pending secret untouched", async () => {
      const setup = await mfa.beginEnrollment(userId, "alice");
      const result = await mfa.confirmEnrollment(userId, "000000");

      expect(result).toBeNull();
      expect(mfa.isMfaEnabled(userId)).toBe(false);

      // The original secret still confirms correctly afterward.
      const code = await codeAt(setup.secret, 0);
      const confirm = await mfa.confirmEnrollment(userId, code);
      expect(confirm).not.toBeNull();
    });

    it("replaces a previous unconfirmed secret when enrollment is restarted", async () => {
      const first = await mfa.beginEnrollment(userId, "alice");
      const second = await mfa.beginEnrollment(userId, "alice");

      expect(second.secret).not.toBe(first.secret);

      const row = db
        .prepare("SELECT COUNT(*) as count FROM user_mfa_totp WHERE user_id = ?")
        .get(userId) as { count: number };
      expect(row.count).toBe(1);

      // The old secret's code no longer confirms; the new one does.
      const oldCode = await codeAt(first.secret, 0);
      expect(await mfa.confirmEnrollment(userId, oldCode)).toBeNull();
      const newCode = await codeAt(second.secret, 0);
      expect(await mfa.confirmEnrollment(userId, newCode)).not.toBeNull();
    });
  });

  describe("verifyTotp", () => {
    it("accepts a code within one time step of drift", async () => {
      const { secret } = await enrollAndConfirm();
      const code = await codeAt(secret, -25); // 25s in the past, within ±30s tolerance
      expect(await mfa.verifyTotp(userId, code)).toBe(true);
    });

    it("rejects a code outside the drift window", async () => {
      const { secret } = await enrollAndConfirm();
      const code = await codeAt(secret, -90); // 90s in the past, outside ±30s tolerance
      expect(await mfa.verifyTotp(userId, code)).toBe(false);
    });

    it("rejects when MFA was never confirmed", async () => {
      expect(await mfa.verifyTotp(userId, "123456")).toBe(false);
    });
  });

  describe("backup codes", () => {
    it("accepts a valid unused code exactly once", async () => {
      const { backupCodes } = await enrollAndConfirm();
      const [code] = backupCodes;

      expect(mfa.verifyBackupCode(userId, code)).toBe(true);
      expect(mfa.verifyBackupCode(userId, code)).toBe(false);
    });

    it("is case/dash insensitive", async () => {
      const { backupCodes } = await enrollAndConfirm();
      const [code] = backupCodes;
      expect(mfa.verifyBackupCode(userId, code.toLowerCase().replace("-", ""))).toBe(true);
    });

    it("regenerateBackupCodes invalidates the previous set", async () => {
      const { backupCodes: oldCodes } = await enrollAndConfirm();
      const newCodes = mfa.regenerateBackupCodes(userId);

      expect(newCodes).toHaveLength(10);
      expect(mfa.verifyBackupCode(userId, oldCodes[0])).toBe(false);
      expect(mfa.verifyBackupCode(userId, newCodes[0])).toBe(true);
    });

    it("isLowOnBackupCodes flips once ≤ 2 remain", async () => {
      const { backupCodes } = await enrollAndConfirm();
      expect(mfa.isLowOnBackupCodes(userId)).toBe(false);

      for (const code of backupCodes.slice(0, 8)) {
        mfa.verifyBackupCode(userId, code);
      }
      expect(mfa.isLowOnBackupCodes(userId)).toBe(true);
    });
  });

  describe("disable", () => {
    it("removes the TOTP secret, all backup codes, and all trusted devices", async () => {
      const { backupCodes } = await enrollAndConfirm();
      mfa.issueTrustedDevice(userId, "test-agent");

      mfa.disable(userId);

      expect(mfa.isMfaEnabled(userId)).toBe(false);
      expect(mfa.verifyBackupCode(userId, backupCodes[0])).toBe(false);
      expect(mfa.listTrustedDevices(userId)).toHaveLength(0);
    });
  });

  describe("trusted devices", () => {
    it("issues a token that later checks as trusted", () => {
      const { token } = mfa.issueTrustedDevice(userId, "Chrome on macOS");
      expect(mfa.checkTrustedDevice(userId, token)).toBe(true);
    });

    it("rejects an unknown token", () => {
      expect(mfa.checkTrustedDevice(userId, "not-a-real-token")).toBe(false);
    });

    it("defaults to 30 days when the user has no preference set", () => {
      const { expiresAt } = mfa.issueTrustedDevice(userId, null);
      const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThan(31);
    });

    it("honors a custom mfaTrustedDeviceDays preference", async () => {
      await userManager.updatePreferences(userId, { language: "fr", mfaTrustedDeviceDays: 7 });
      const { expiresAt } = mfa.issueTrustedDevice(userId, null);
      const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6);
      expect(days).toBeLessThan(8);
    });

    it("revokeAllTrustedDevices clears only that user's devices", async () => {
      const other = await userManager.createUser({
        username: "bob",
        displayName: "Bob",
        password: "test-fixture-password",
        role: "standard",
      });
      const mine = mfa.issueTrustedDevice(userId, null);
      const theirs = mfa.issueTrustedDevice(other.id, null);

      mfa.revokeAllTrustedDevices(userId);

      expect(mfa.checkTrustedDevice(userId, mine.token)).toBe(false);
      expect(mfa.checkTrustedDevice(other.id, theirs.token)).toBe(true);
    });

    it("revokeTrustedDevice removes a single device by id", () => {
      mfa.issueTrustedDevice(userId, "device-a");
      const [device] = mfa.listTrustedDevices(userId);

      expect(mfa.revokeTrustedDevice(device.id, userId)).toBe(true);
      expect(mfa.listTrustedDevices(userId)).toHaveLength(0);
    });
  });

  describe("clampTrustedDeviceDays", () => {
    it("defaults to 30 when undefined", () => {
      expect(clampTrustedDeviceDays(undefined)).toBe(30);
    });

    it("clamps above the max to 90", () => {
      expect(clampTrustedDeviceDays(500)).toBe(90);
    });

    it("clamps below the min to 1", () => {
      expect(clampTrustedDeviceDays(0)).toBe(1);
      expect(clampTrustedDeviceDays(-5)).toBe(1);
    });

    it("passes a valid value through unchanged", () => {
      expect(clampTrustedDeviceDays(14)).toBe(14);
    });
  });
});
