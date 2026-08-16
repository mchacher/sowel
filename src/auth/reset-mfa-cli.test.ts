import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { UserManager } from "./user-manager.js";
import { MfaService } from "./mfa-service.js";
import { createLogger } from "../core/logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";

// Spec 151 FR7 — the break-glass CLI is a standalone script (not part of the
// TS build), invoked in production via `docker exec sowel node
// scripts/auth/reset-mfa.mjs <username>`. This test runs the REAL script as a
// child process against a real file-backed SQLite database seeded through the
// production UserManager/MfaService code paths (not hand-rolled SQL), so it
// exercises exactly what an operator would run.

const SCRIPT_PATH = resolve(import.meta.dirname, "../../scripts/auth/reset-mfa.mjs");
const logger = createLogger("silent").logger;

function runScript(
  dbPath: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [SCRIPT_PATH, ...args], {
      env: { ...process.env, SQLITE_PATH: dbPath },
      encoding: "utf-8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

describe("scripts/auth/reset-mfa.mjs (spec 151 FR7 — break-glass CLI)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sowel-mfa-cli-"));
    dbPath = join(dir, "sowel.db");

    // Migrate once per test file's db — applyMigrations re-execs every .sql
    // file unconditionally (no _migrations tracking table, unlike production
    // runMigrations), so calling it twice against the same file blows up on
    // any ALTER TABLE migration ("duplicate column").
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedUserWithMfa(username: string) {
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");

    const userManager = new UserManager(db, logger);
    const mfaService = new MfaService(db, userManager, logger);
    const user = await userManager.createUser({
      username,
      displayName: username,
      password: "test-fixture-password",
      role: "admin",
    });

    const setup = await mfaService.beginEnrollment(user.id, username);
    // Confirm with a deliberately wrong code is impossible to script without
    // otplib here; instead seed the confirmed state directly via the same
    // statement MfaService uses internally, then attach backup codes + a
    // trusted device through the real service methods.
    db.prepare("UPDATE user_mfa_totp SET confirmed_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(
      user.id,
    );
    mfaService.regenerateBackupCodes(user.id);
    mfaService.issueTrustedDevice(user.id, "test-agent");

    // Release the file lock before the child process opens the same file.
    db.close();
    return { userId: user.id, secret: setup.secret };
  }

  function countRows(table: string, userId: string): number {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE user_id = ?`)
        .get(userId) as {
        c: number;
      };
      return row.c;
    } finally {
      db.close();
    }
  }

  it("clears TOTP secret, backup codes, and trusted devices for the named user", async () => {
    const { userId } = await seedUserWithMfa("alice");

    expect(countRows("user_mfa_totp", userId)).toBe(1);
    expect(countRows("user_mfa_backup_codes", userId)).toBe(10);
    expect(countRows("mfa_trusted_devices", userId)).toBe(1);

    const result = runScript(dbPath, ["alice"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('MFA reset for "alice"');
    expect(countRows("user_mfa_totp", userId)).toBe(0);
    expect(countRows("user_mfa_backup_codes", userId)).toBe(0);
    expect(countRows("mfa_trusted_devices", userId)).toBe(0);
  });

  it("does not touch another user's MFA state", async () => {
    const { userId: aliceId } = await seedUserWithMfa("alice");
    const { userId: bobId } = await seedUserWithMfa("bob");

    runScript(dbPath, ["alice"]);

    expect(countRows("user_mfa_totp", aliceId)).toBe(0);
    expect(countRows("user_mfa_totp", bobId)).toBe(1);
    expect(countRows("mfa_trusted_devices", bobId)).toBe(1);
  });

  it("is a no-op (exit 0) for a user who never enrolled MFA", async () => {
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    const userManager = new UserManager(db, logger);
    await userManager.createUser({
      username: "carol",
      displayName: "Carol",
      password: "test-fixture-password",
      role: "standard",
    });
    db.close();

    const result = runScript(dbPath, ["carol"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("was not enrolled");
  });

  it("exits non-zero with a clear message for an unknown username", async () => {
    await seedUserWithMfa("alice");

    const result = runScript(dbPath, ["nobody"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("nobody");
  });

  it("exits non-zero with a usage message when no username is given", async () => {
    await seedUserWithMfa("alice");

    const result = runScript(dbPath, []);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("usage");
  });
});
