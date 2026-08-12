import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import bcrypt from "bcrypt";
import { UserManager } from "./user-manager.js";
import { createLogger } from "../core/logger.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";

const logger = createLogger("silent").logger;

describe("UserManager", () => {
  let db: Database.Database;
  let manager: UserManager;

  beforeEach(() => {
    db = createMigratedTestDb();
    manager = new UserManager(db, logger);
  });

  afterEach(() => {
    db.close();
  });

  function makeAdmin(overrides?: { username?: string; password?: string }) {
    return manager.createUser({
      username: overrides?.username ?? "alice",
      displayName: "Alice",
      password: overrides?.password ?? "s3cret-pass",
      role: "admin",
    });
  }

  describe("hasUsers", () => {
    it("is false on an empty database and true once a user exists", async () => {
      expect(manager.hasUsers()).toBe(false);
      await makeAdmin();
      expect(manager.hasUsers()).toBe(true);
    });
  });

  describe("createUser", () => {
    it("persists the user and returns it with defaults applied", async () => {
      const user = await makeAdmin();

      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(user.username).toBe("alice");
      expect(user.displayName).toBe("Alice");
      expect(user.role).toBe("admin");
      expect(user.enabled).toBe(true);
      expect(user.lastLoginAt).toBeNull();
      expect(user.createdAt).toBeTruthy();
      // Default preference applied when none supplied.
      expect(user.preferences.language).toBe("fr");
    });

    it("never stores the password in clear text", async () => {
      await makeAdmin({ password: "plaintext-here" });

      const row = db.prepare("SELECT password_hash FROM users WHERE username = ?").get("alice") as {
        password_hash: string;
      };

      expect(row.password_hash).not.toContain("plaintext-here");
      expect(row.password_hash.startsWith("$2")).toBe(true); // bcrypt hash marker
      expect(await bcrypt.compare("plaintext-here", row.password_hash)).toBe(true);
    });

    it("merges a partial preference over the defaults (unset keys keep their default)", async () => {
      // Supply only `theme`: `language` must fall back to the default "fr".
      // A test that supplied both keys would still pass even if createUser
      // ignored DEFAULT_PREFERENCES entirely, so we exercise the partial case.
      const user = await manager.createUser({
        username: "bob",
        displayName: "Bob",
        password: "pw",
        role: "standard",
        preferences: { theme: "dark" },
      });

      expect(user.preferences.theme).toBe("dark");
      expect(user.preferences.language).toBe("fr");
    });

    it("rejects a duplicate username (UNIQUE constraint)", async () => {
      await makeAdmin();
      await expect(makeAdmin()).rejects.toThrow(/UNIQUE/i);
      expect(manager.getAll()).toHaveLength(1);
    });
  });

  describe("lookups", () => {
    it("getById returns the user, or null for an unknown id", async () => {
      const user = await makeAdmin();
      expect(manager.getById(user.id)?.username).toBe("alice");
      expect(manager.getById("does-not-exist")).toBeNull();
    });

    it("getByUsername exposes the password hash, and returns null when absent", async () => {
      await makeAdmin({ password: "pw-123" });

      const found = manager.getByUsername("alice");
      expect(found).not.toBeNull();
      expect(await bcrypt.compare("pw-123", found!.passwordHash)).toBe(true);

      expect(manager.getByUsername("nobody")).toBeNull();
    });

    it("getAll returns every user", async () => {
      await makeAdmin();
      await manager.createUser({
        username: "bob",
        displayName: "Bob",
        password: "pw",
        role: "standard",
      });
      expect(
        manager
          .getAll()
          .map((u) => u.username)
          .sort(),
      ).toEqual(["alice", "bob"]);
    });
  });

  describe("verifyPassword", () => {
    it("accepts the correct password and rejects a wrong one", async () => {
      await makeAdmin({ password: "right-password" });
      const found = manager.getByUsername("alice")!;

      expect(await manager.verifyPassword(found.passwordHash, "right-password")).toBe(true);
      expect(await manager.verifyPassword(found.passwordHash, "wrong-password")).toBe(false);
    });
  });

  describe("updatePassword", () => {
    it("replaces the hash so the old password no longer verifies", async () => {
      const user = await makeAdmin({ password: "old-password" });
      const before = manager.getByUsername("alice")!.passwordHash;

      await manager.updatePassword(user.id, "new-password");
      const after = manager.getByUsername("alice")!.passwordHash;

      expect(after).not.toBe(before);
      expect(await manager.verifyPassword(after, "new-password")).toBe(true);
      expect(await manager.verifyPassword(after, "old-password")).toBe(false);
    });
  });

  describe("updateUser", () => {
    it("updates display name, role and enabled flag", async () => {
      const user = await makeAdmin();

      const updated = manager.updateUser(user.id, {
        displayName: "Alice Cooper",
        role: "standard",
        enabled: false,
      });

      expect(updated?.displayName).toBe("Alice Cooper");
      expect(updated?.role).toBe("standard");
      expect(updated?.enabled).toBe(false);
      // Confirm it round-trips through the DB, not just the returned object.
      expect(manager.getById(user.id)?.enabled).toBe(false);
    });

    it("returns null when updating an unknown id", () => {
      const updated = manager.updateUser("does-not-exist", {
        displayName: "Ghost",
        role: "standard",
        enabled: true,
      });
      expect(updated).toBeNull();
    });
  });

  describe("updatePreferences", () => {
    it("persists the new preferences", async () => {
      const user = await makeAdmin();
      manager.updatePreferences(user.id, { language: "en", theme: "light" });

      const reloaded = manager.getById(user.id)!;
      expect(reloaded.preferences.language).toBe("en");
      expect(reloaded.preferences.theme).toBe("light");
    });
  });

  describe("updateLastLogin", () => {
    it("stamps last_login_at from null to a timestamp", async () => {
      const user = await makeAdmin();
      expect(manager.getById(user.id)?.lastLoginAt).toBeNull();

      manager.updateLastLogin(user.id);
      expect(manager.getById(user.id)?.lastLoginAt).toBeTruthy();
    });
  });

  describe("deleteUser", () => {
    it("removes the user", async () => {
      const user = await makeAdmin();
      manager.deleteUser(user.id);

      expect(manager.getById(user.id)).toBeNull();
      expect(manager.hasUsers()).toBe(false);
    });

    it("cascades to the user's API and refresh tokens (FK ON DELETE CASCADE)", async () => {
      const user = await makeAdmin();
      db.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash) VALUES (?, ?, ?, ?)").run(
        "tok-1",
        user.id,
        "cli",
        "hash",
      );
      db.prepare(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      ).run("rt-1", user.id, "hash", "2099-01-01T00:00:00Z");

      manager.deleteUser(user.id);

      const apiCount = db
        .prepare("SELECT COUNT(*) as c FROM api_tokens WHERE user_id = ?")
        .get(user.id) as { c: number };
      const refreshCount = db
        .prepare("SELECT COUNT(*) as c FROM refresh_tokens WHERE user_id = ?")
        .get(user.id) as { c: number };
      expect(apiCount.c).toBe(0);
      expect(refreshCount.c).toBe(0);
    });
  });

  describe("preferences corruption tolerance", () => {
    it("falls back to defaults when stored preferences are not valid JSON", async () => {
      const user = await makeAdmin();
      db.prepare("UPDATE users SET preferences = ? WHERE id = ?").run("{not json", user.id);

      // rowToUser must not throw; it degrades to defaults.
      expect(manager.getById(user.id)?.preferences.language).toBe("fr");
    });
  });
});
