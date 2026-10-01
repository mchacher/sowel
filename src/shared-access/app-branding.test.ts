import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import {
  AppBranding,
  DEFAULT_APP_NAME,
  ICON_MAX_BYTES,
  SETTING_APP_NAME,
  pngSize,
} from "./app-branding.js";
import { SharedAccessError } from "./validity.js";

// Spec 181 R5.24 — the page's name and icon on the home screen.

function settings() {
  const map = new Map<string, string>();
  return { map, get: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

/** A minimal valid-looking PNG: signature + IHDR of the given size. */
function png(width: number, height = width): string {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    deflateSync(Buffer.alloc(10)),
  ]).toString("base64");
}

const icons = () => ({ "180": png(180), "192": png(192), "512": png(512) });

function refusal(fn: () => unknown): SharedAccessError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SharedAccessError);
    return err as SharedAccessError;
  }
  throw new Error("expected a refusal");
}

describe("the shared access app branding", () => {
  it("defaults to « Accès » and the page's own mark, a real PNG at each size", () => {
    const b = new AppBranding(settings());
    expect(b.view()).toMatchObject({ name: DEFAULT_APP_NAME, customIcon: false });
    for (const size of [180, 192, 512] as const) {
      expect(pngSize(b.icon(size))).toEqual({ width: size, height: size });
    }
  });

  it("stores a name and three icons, and serves them back", () => {
    const s = settings();
    const b = new AppBranding(s);
    const before = b.version();
    const view = b.update({ name: "  SOLIO  ", icons: icons() });
    expect(view).toMatchObject({ name: "SOLIO", customIcon: true });
    expect(view.version).not.toBe(before);
    expect(s.map.get(SETTING_APP_NAME)).toBe("SOLIO");
    expect(b.icon(512).toString("base64")).toBe(icons()["512"]);
  });

  it("an empty name falls back to the default", () => {
    const b = new AppBranding(settings());
    b.update({ name: "SOLIO" });
    expect(b.update({ name: "   " }).name).toBe(DEFAULT_APP_NAME);
  });

  it("null icons return to the default mark", () => {
    const b = new AppBranding(settings());
    b.update({ icons: icons() });
    expect(b.update({ icons: null }).customIcon).toBe(false);
    expect(b.icon(192).toString("base64")).not.toBe(icons()["192"]);
  });

  it("refuses what is not a PNG, a wrong size, a missing size, too large a file or too long a name", () => {
    const b = new AppBranding(settings());
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(40).fill(0)]).toString("base64");
    expect(refusal(() => b.update({ icons: { ...icons(), "192": jpeg } })).code).toBe(
      "invalid_app",
    );
    expect(refusal(() => b.update({ icons: { ...icons(), "512": png(500) } })).message).toContain(
      "500×500",
    );
    expect(
      refusal(() => b.update({ icons: { "180": png(180), "192": png(192) } })).message,
    ).toContain("512");
    const huge = Buffer.concat([Buffer.from(png(512), "base64"), Buffer.alloc(ICON_MAX_BYTES)]);
    expect(
      refusal(() => b.update({ icons: { ...icons(), "512": huge.toString("base64") } })).message,
    ).toContain("too large");
    expect(refusal(() => b.update({ name: "x".repeat(31) })).statusCode).toBe(400);
  });

  it("writes nothing when any part is refused", () => {
    const s = settings();
    const b = new AppBranding(s);
    refusal(() => b.update({ name: "SOLIO", icons: { ...icons(), "180": png(10) } }));
    expect(s.map.size).toBe(0);
  });
});
