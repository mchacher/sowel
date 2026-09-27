import { describe, it, expect } from "vitest";
import {
  CODE_ALPHABET,
  deriveLinkToken,
  formatCode,
  generateCode,
  generatePhoneToken,
  normalizeCode,
  sha256,
} from "./codes.js";

describe("shared access codes (R3.8)", () => {
  it("draws eight characters of Crockford base32 without I, L, O, U", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(8);
      for (const c of code) expect(CODE_ALPHABET).toContain(c);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("matches a code typed with dashes, spaces, lower case and the four look-alikes", () => {
    expect(normalizeCode("4k7m-9qt2")).toBe("4K7M9QT2");
    expect(normalizeCode(" 4K7M 9QT2 ")).toBe("4K7M9QT2");
    // I and L read as 1, O as 0, U as V.
    expect(normalizeCode("ILOU-2345")).toBe("110V2345");
    expect(normalizeCode("o0o0-lIi1")).toBe("00001111");
  });

  it("refuses what cannot be a code", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("4K7M-9QT")).toBeNull();
    expect(normalizeCode("4K7M-9QT2-X")).toBeNull();
    expect(normalizeCode("4K7M-9Q!2")).toBeNull();
  });

  it("shows a code with its dash", () => {
    expect(formatCode("4K7M9QT2")).toBe("4K7M-9QT2");
  });

  it("derives a stable link token per access and version, which changes with the version", () => {
    const a = deriveLinkToken("secret", "access-1", 1);
    expect(a).toBe(deriveLinkToken("secret", "access-1", 1));
    expect(a).not.toBe(deriveLinkToken("secret", "access-1", 2));
    expect(a).not.toBe(deriveLinkToken("secret", "access-2", 1));
    expect(a).not.toBe(deriveLinkToken("other", "access-1", 1));
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("draws phone tokens that differ, and hashes them to 64 hex", () => {
    const t = generatePhoneToken();
    expect(t).not.toBe(generatePhoneToken());
    expect(sha256(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
