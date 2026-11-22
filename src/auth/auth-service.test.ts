import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import { OTP } from "otplib";
import { AuthService, AuthError } from "./auth-service.js";
import { MfaService } from "./mfa-service.js";
import { UserManager } from "./user-manager.js";
import { createLogger } from "../core/logger.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";

const logger = createLogger("silent").logger;
const totp = new OTP({ strategy: "totp" });
const JWT_SECRET = "test-secret";

describe("AuthService", () => {
  let db: Database.Database;
  let userManager: UserManager;
  let mfa: MfaService;
  let auth: AuthService;
  let userId: string;

  beforeEach(async () => {
    db = createMigratedTestDb();
    userManager = new UserManager(db, logger);
    mfa = new MfaService(db, userManager, logger);
    auth = new AuthService(
      db,
      userManager,
      mfa,
      { secret: JWT_SECRET, accessTtl: 900, refreshTtl: 2592000 },
      logger,
    );
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

  describe("login", () => {
    it("returns full AuthTokens unchanged when the account has no MFA (retro-compat)", async () => {
      const result = await auth.login("alice", "test-fixture-password");
      expect(result).toHaveProperty("accessToken");
      expect(result).toHaveProperty("refreshToken");
      expect((result as { mfaRequired?: boolean }).mfaRequired).toBeUndefined();
    });

    it("returns an MfaChallenge (no tokens) when MFA is enabled and no trusted device is presented", async () => {
      const setup = await mfa.beginEnrollment(userId, "alice");
      const code = await totp.generate({ secret: setup.secret });
      await mfa.confirmEnrollment(userId, code);

      const result = await auth.login("alice", "test-fixture-password");
      expect(result).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    });

    it("skips MFA and returns full tokens when a valid trusted-device token is presented", async () => {
      const setup = await mfa.beginEnrollment(userId, "alice");
      const code = await totp.generate({ secret: setup.secret });
      await mfa.confirmEnrollment(userId, code);

      const { token } = mfa.issueTrustedDevice(userId, "test-agent");
      const result = await auth.login("alice", "test-fixture-password", token);

      expect(result).toHaveProperty("accessToken");
      expect((result as { mfaRequired?: boolean }).mfaRequired).toBeUndefined();
    });

    it("still requires MFA when an unknown/invalid trusted-device token is presented", async () => {
      const setup = await mfa.beginEnrollment(userId, "alice");
      const code = await totp.generate({ secret: setup.secret });
      await mfa.confirmEnrollment(userId, code);

      const result = await auth.login("alice", "test-fixture-password", "not-a-real-token");
      expect(result).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    });
  });

  describe("verifyMfaToken", () => {
    it("rejects an expired mfaToken", () => {
      const expired = jwt.sign({ userId, purpose: "mfa_pending" }, JWT_SECRET, {
        expiresIn: -1,
      });
      expect(() => auth.verifyMfaToken(expired)).toThrow(AuthError);
    });

    it("rejects a token whose purpose is not mfa_pending", () => {
      const wrongPurpose = jwt.sign({ userId, purpose: "access" }, JWT_SECRET, {
        expiresIn: 300,
      });
      expect(() => auth.verifyMfaToken(wrongPurpose)).toThrow(AuthError);
    });

    it("accepts a freshly issued mfaToken from an MFA login challenge", async () => {
      const setup = await mfa.beginEnrollment(userId, "alice");
      const code = await totp.generate({ secret: setup.secret });
      await mfa.confirmEnrollment(userId, code);

      const challenge = (await auth.login("alice", "test-fixture-password")) as {
        mfaToken: string;
      };
      const { userId: verifiedUserId } = auth.verifyMfaToken(challenge.mfaToken);
      expect(verifiedUserId).toBe(userId);
    });
  });

  describe("verifyAccessToken — token purpose isolation (spec 151)", () => {
    it("rejects an mfa_pending token used as a normal bearer token", async () => {
      const setup = await mfa.beginEnrollment(userId, "alice");
      const code = await totp.generate({ secret: setup.secret });
      await mfa.confirmEnrollment(userId, code);

      const challenge = (await auth.login("alice", "test-fixture-password")) as {
        mfaToken: string;
      };
      expect(() => auth.verifyAccessToken(challenge.mfaToken)).toThrow(AuthError);
    });

    it("accepts a normal access token", async () => {
      const tokens = await auth.login("alice", "test-fixture-password");
      const { accessToken } = tokens as { accessToken: string };
      const payload = auth.verifyAccessToken(accessToken);
      expect(payload.userId).toBe(userId);
      expect(payload.role).toBe("admin");
    });
  });

  describe("completeMfaLogin", () => {
    it("issues full tokens for the given user", async () => {
      const tokens = auth.completeMfaLogin(userId);
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.user.id).toBe(userId);
    });
  });
  describe("session revocation (issue #1305)", () => {
    type Tokens = { accessToken: string; refreshToken: string };
    const login = async () => (await auth.login("alice", "test-fixture-password")) as Tokens;

    it("ends every session but the caller's when a token is kept", async () => {
      const caller = await login();
      const other = await login();
      expect(auth.revokeUserSessions(userId, caller.refreshToken)).toBe(1);
      await expect(auth.refresh(other.refreshToken)).rejects.toThrow(AuthError);
      await expect(auth.refresh(caller.refreshToken)).resolves.toHaveProperty("accessToken");
    });

    it("ends every session when no token is kept", async () => {
      const a = await login();
      const b = await login();
      expect(auth.revokeUserSessions(userId)).toBe(2);
      await expect(auth.refresh(a.refreshToken)).rejects.toThrow(AuthError);
      await expect(auth.refresh(b.refreshToken)).rejects.toThrow(AuthError);
    });

    it("does not spare a session when the kept token belongs to someone else", async () => {
      await userManager.createUser({
        username: "bob",
        displayName: "Bob",
        password: "test-fixture-password",
        role: "standard",
      });
      const bob = (await auth.login("bob", "test-fixture-password")) as Tokens;
      const alice = await login();
      expect(auth.revokeUserSessions(userId, bob.refreshToken)).toBe(1);
      await expect(auth.refresh(alice.refreshToken)).rejects.toThrow(AuthError);
      // Bob's own session is untouched: revocation is scoped to the user.
      await expect(auth.refresh(bob.refreshToken)).resolves.toHaveProperty("accessToken");
    });
  });

  describe("verifyAccessToken — reads the account as it is now (issue #1305)", () => {
    const accessToken = async () =>
      ((await auth.login("alice", "test-fixture-password")) as { accessToken: string }).accessToken;

    it("refuses the token of a disabled account", async () => {
      const token = await accessToken();
      userManager.updateUser(userId, { displayName: "Alice", role: "admin", enabled: false });
      expect(() => auth.verifyAccessToken(token)).toThrow(AuthError);
    });

    it("refuses the token of a deleted account", async () => {
      const token = await accessToken();
      userManager.deleteUser(userId);
      expect(() => auth.verifyAccessToken(token)).toThrow(AuthError);
    });

    it("applies the stored role, not the one signed into the token", async () => {
      const token = await accessToken();
      userManager.updateUser(userId, { displayName: "Alice", role: "standard", enabled: true });
      expect(auth.verifyAccessToken(token).role).toBe("standard");
    });
  });
});
