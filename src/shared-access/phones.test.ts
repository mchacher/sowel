import { describe, it, expect } from "vitest";
import { phonePlatform, phoneTag } from "./phones.js";

describe("phone names (R5.23)", () => {
  it("reads the platform family from the user agent", () => {
    expect(phonePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iphone");
    expect(phonePlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("ipad");
    expect(phonePlatform("Mozilla/5.0 (Linux; Android 14; K)")).toBe("android");
    expect(phonePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(phonePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(phonePlatform("")).toBe("other");
  });

  it("draws a four-character tag that stays the same for a phone", () => {
    expect(phoneTag("a")).toBe(phoneTag("a"));
    expect(phoneTag("a")).not.toBe(phoneTag("b"));
    expect(phoneTag(crypto.randomUUID())).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});
