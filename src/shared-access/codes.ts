import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

// ============================================================
// Spec 181 — codes and tokens (R3.8, R5.19)
//
// Three secrets, three shapes:
//   - the CODE is short, dictated over the telephone and typed on a keyboard,
//     so it is kept in clear (a hash would forbid reading it out). 40 bits, and
//     the anti-guessing budget of R6 is what stands in front of it;
//   - the LINK carries a token of its own that nobody types. It is derived from
//     a per-house secret and the access's link version, so the owner can copy
//     the link again and a plugin can read its invitation back, while the table
//     keeps only its SHA-256 for the lookup;
//   - the PHONE token is random, returned once at enrolment, hashed at rest.
// ============================================================

/** Crockford base32, without I, L, O, U. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 8;

/** The four letters a human writes for something else. */
const FOLDS: Record<string, string> = { I: "1", L: "1", O: "0", U: "V" };

/** A fresh code, stored and shown without its dash: `4K7M9QT2`. */
export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * What the visitor typed, reduced to what was meant: dashes, spaces and case
 * stripped, I/L/O/U folded. Returns null when it cannot be a code at all.
 */
export function normalizeCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[ILOU]/g, (c) => FOLDS[c] ?? c);
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const c of cleaned) if (!CODE_ALPHABET.includes(c)) return null;
  return cleaned;
}

/** `4K7M9QT2` → `4K7M-9QT2`. */
export function formatCode(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A random per-house secret for the link tokens. */
export function generateLinkSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * The link's token for one version of one access: 128 bits and a little more,
 * URL-safe. Changing the code bumps the version, which changes the token.
 */
export function deriveLinkToken(secret: string, accessId: string, version: number): string {
  return createHmac("sha256", secret)
    .update(`${accessId}:${version}`)
    .digest("base64url")
    .slice(0, 22);
}

/** A phone's token, returned once and kept by the phone. */
export function generatePhoneToken(): string {
  return randomBytes(32).toString("base64url");
}
