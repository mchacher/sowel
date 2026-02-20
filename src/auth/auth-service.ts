import { randomUUID, randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { UserManager } from "./user-manager.js";
import type { User, UserRole } from "../shared/types.js";
import { toISOUtc } from "../core/database.js";

// ============================================================
// Types
// ============================================================

export interface JwtPayload {
  userId: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface AuthConfig {
  secret: string;
  accessTtl: number;
  refreshTtl: number;
}

// ============================================================
// AuthService — JWT & API token management
// ============================================================

export class AuthService {
  private userManager: UserManager;
  private config: AuthConfig;
  private logger: Logger;
  private stmts: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, userManager: UserManager, config: AuthConfig, logger: Logger) {
    this.userManager = userManager;
    this.config = config;
    this.logger = logger.child({ module: "auth-service" });
    this.stmts = this.prepareStatements(db);
  }

  private prepareStatements(db: Database.Database) {
    return {
      insertRefresh: db.prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'))`,
      ),
      getRefresh: db.prepare(
        "SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime('now')",
      ),
      deleteRefresh: db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?"),
      deleteUserRefreshTokens: db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?"),
      cleanExpiredRefresh: db.prepare("DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')"),

      insertApiToken: db.prepare(
        `INSERT INTO api_tokens (id, user_id, name, token_hash, expires_at)
         VALUES (@id, @userId, @name, @tokenHash, @expiresAt)`,
      ),
      getApiTokenByHash: db.prepare(
        "SELECT * FROM api_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
      ),
      getApiTokensByUser: db.prepare(
        "SELECT id, name, last_used_at, expires_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at",
      ),
      deleteApiToken: db.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?"),
      updateApiTokenUsed: db.prepare(
        "UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
    };
  }

  // ============================================================
  // JWT Authentication
  // ============================================================

  async login(username: string, password: string): Promise<AuthTokens> {
    const userWithHash = this.userManager.getByUsername(username);
    if (!userWithHash) {
      throw new AuthError("Invalid credentials", 401);
    }

    if (!userWithHash.enabled) {
      throw new AuthError("Account disabled", 403);
    }

    const valid = await this.userManager.verifyPassword(userWithHash.passwordHash, password);
    if (!valid) {
      throw new AuthError("Invalid credentials", 401);
    }

    this.userManager.updateLastLogin(userWithHash.id);

    // Get clean user object without passwordHash
    const user = this.userManager.getById(userWithHash.id)!;
    return this.generateTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const hash = sha256(refreshToken);
    const row = this.stmts.getRefresh.get(hash) as RefreshRow | undefined;
    if (!row) {
      throw new AuthError("Invalid refresh token", 401);
    }

    // Revoke old refresh token (rotation)
    this.stmts.deleteRefresh.run(hash);

    const user = this.userManager.getById(row.user_id);
    if (!user || !user.enabled) {
      throw new AuthError("User not found or disabled", 401);
    }

    return this.generateTokens(user);
  }

  logout(refreshToken: string): void {
    const hash = sha256(refreshToken);
    this.stmts.deleteRefresh.run(hash);
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, this.config.secret) as JwtPayload;
      return payload;
    } catch {
      throw new AuthError("Invalid or expired token", 401);
    }
  }

  private generateTokens(user: User): AuthTokens {
    const payload: JwtPayload = { userId: user.id, role: user.role };
    const accessToken = jwt.sign(payload, this.config.secret, {
      expiresIn: this.config.accessTtl,
    });

    const refreshToken = randomBytes(32).toString("hex");
    const refreshHash = sha256(refreshToken);

    this.stmts.insertRefresh.run(
      randomUUID(),
      user.id,
      refreshHash,
      this.config.refreshTtl,
    );

    // Clean up expired refresh tokens periodically
    this.stmts.cleanExpiredRefresh.run();

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTtl,
      user,
    };
  }

  // ============================================================
  // API Token Management
  // ============================================================

  createApiToken(userId: string, name: string, expiresAt: string | null): { token: string; id: string } {
    const id = randomUUID();
    const rawToken = `cbl_${randomBytes(32).toString("hex")}`;
    const tokenHash = sha256(rawToken);

    this.stmts.insertApiToken.run({
      id,
      userId,
      name,
      tokenHash,
      expiresAt,
    });

    this.logger.info({ tokenId: id, userId, name }, "API token created");
    return { token: rawToken, id };
  }

  verifyApiToken(token: string): JwtPayload | null {
    const hash = sha256(token);
    const row = this.stmts.getApiTokenByHash.get(hash) as ApiTokenRow | undefined;
    if (!row) return null;

    const user = this.userManager.getById(row.user_id);
    if (!user || !user.enabled) return null;

    // Update last used
    this.stmts.updateApiTokenUsed.run(row.id);

    return { userId: user.id, role: user.role };
  }

  getUserApiTokens(userId: string): Array<{
    id: string;
    name: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  }> {
    const rows = this.stmts.getApiTokensByUser.all(userId) as Array<{
      id: string;
      name: string;
      last_used_at: string | null;
      expires_at: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lastUsedAt: toISOUtc(r.last_used_at),
      expiresAt: toISOUtc(r.expires_at),
      createdAt: toISOUtc(r.created_at)!,
    }));
  }

  deleteApiToken(tokenId: string, userId: string): boolean {
    const result = this.stmts.deleteApiToken.run(tokenId, userId);
    return result.changes > 0;
  }
}

// ============================================================
// AuthError
// ============================================================

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// ============================================================
// Helpers
// ============================================================

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface RefreshRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
}

interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  last_used_at: string | null;
  expires_at: string | null;
}
