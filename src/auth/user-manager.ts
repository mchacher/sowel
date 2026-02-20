import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import { toISOUtc } from "../core/database.js";
import type { User, UserRole, UserPreferences } from "../shared/types.js";

const BCRYPT_ROUNDS = 12;

const DEFAULT_PREFERENCES: UserPreferences = {
  language: "fr",
};

// ============================================================
// UserManager — CRUD operations for users
// ============================================================

export class UserManager {
  private db: Database.Database;
  private logger: Logger;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, logger: Logger) {
    this.db = db;
    this.logger = logger.child({ module: "user-manager" });
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      insert: this.db.prepare(
        `INSERT INTO users (id, username, display_name, password_hash, role, preferences)
         VALUES (@id, @username, @displayName, @passwordHash, @role, @preferences)`,
      ),
      getById: this.db.prepare("SELECT * FROM users WHERE id = ?"),
      getByUsername: this.db.prepare("SELECT * FROM users WHERE username = ?"),
      getAll: this.db.prepare("SELECT * FROM users ORDER BY created_at"),
      update: this.db.prepare(
        `UPDATE users SET display_name = @displayName, role = @role, enabled = @enabled,
         updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
      ),
      updatePreferences: this.db.prepare(
        "UPDATE users SET preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
      updatePassword: this.db.prepare(
        "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
      updateLastLogin: this.db.prepare(
        "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
      delete: this.db.prepare("DELETE FROM users WHERE id = ?"),
      count: this.db.prepare("SELECT COUNT(*) as count FROM users"),
    };
  }

  hasUsers(): boolean {
    const row = this.stmts.count.get() as { count: number };
    return row.count > 0;
  }

  async createUser(input: {
    username: string;
    displayName: string;
    password: string;
    role: UserRole;
    preferences?: Partial<UserPreferences>;
  }): Promise<User> {
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const preferences = { ...DEFAULT_PREFERENCES, ...input.preferences };

    this.stmts.insert.run({
      id,
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      role: input.role,
      preferences: JSON.stringify(preferences),
    });

    this.logger.info({ userId: id, username: input.username, role: input.role }, "User created");
    return this.getById(id)!;
  }

  getById(id: string): User | null {
    const row = this.stmts.getById.get(id) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  getByUsername(username: string): (User & { passwordHash: string }) | null {
    const row = this.stmts.getByUsername.get(username) as UserRow | undefined;
    if (!row) return null;
    return { ...rowToUser(row), passwordHash: row.password_hash };
  }

  getAll(): User[] {
    const rows = this.stmts.getAll.all() as UserRow[];
    return rows.map(rowToUser);
  }

  updateUser(id: string, input: { displayName: string; role: UserRole; enabled: boolean }): User | null {
    this.stmts.update.run({
      id,
      displayName: input.displayName,
      role: input.role,
      enabled: input.enabled ? 1 : 0,
    });
    this.logger.info({ userId: id }, "User updated");
    return this.getById(id);
  }

  updatePreferences(id: string, prefs: UserPreferences): void {
    this.stmts.updatePreferences.run(JSON.stringify(prefs), id);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    this.stmts.updatePassword.run(hash, id);
    this.logger.info({ userId: id }, "Password changed");
  }

  updateLastLogin(id: string): void {
    this.stmts.updateLastLogin.run(id);
  }

  deleteUser(id: string): void {
    this.stmts.delete.run(id);
    this.logger.info({ userId: id }, "User deleted");
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

// ============================================================
// Row types & mappers
// ============================================================

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  preferences: string;
  enabled: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  let preferences: UserPreferences;
  try {
    preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(row.preferences) };
  } catch {
    preferences = { ...DEFAULT_PREFERENCES };
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as UserRole,
    preferences,
    enabled: row.enabled === 1,
    lastLoginAt: toISOUtc(row.last_login_at),
    createdAt: toISOUtc(row.created_at)!,
  };
}
