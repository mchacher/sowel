import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { SettingsManager } from "../core/settings-manager.js";
import { SharedAccessError } from "./validity.js";

// ============================================================
// Spec 181 R5.24 — the visitor's page as an app on the home screen: its name
// and its icon, chosen by the owner.
//
// The icons are PNGs at the three sizes the phones ask for (180 for iOS's
// apple-touch-icon, 192 and 512 for Android's manifest), resized by the
// owner's browser before upload: the backend carries no image library, it only
// checks that each file IS a PNG of the size it claims. They live in settings,
// base64, so a backup carries them with everything else.
// ============================================================

export const SETTING_APP_NAME = "sharedAccess.appName";
export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];
export const DEFAULT_APP_NAME = "Accès";
export const APP_NAME_MAX = 30;
/** Per PNG, decoded. A 512 px logo is a few tens of kilobytes. */
export const ICON_MAX_BYTES = 256 * 1024;

const iconKey = (size: IconSize) => `sharedAccess.appIcon.${size}`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR, or null when the bytes are not a PNG. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ── The default icon ─────────────────────────────────────────
// The page's own mark — a warm disc on the dark screen — drawn as a PNG, since
// iOS takes no SVG for a home-screen icon. Full-bleed: both platforms round
// the corners themselves.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function drawDefaultIcon(size: number): Buffer {
  const bg = [0x0a, 0x07, 0x05];
  const disc = [0xe8, 0x96, 0x3c];
  const r = size * 0.28;
  const c = (size - 1) / 2;
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    rows[row] = 0;
    for (let x = 0; x < size; x++) {
      // One pixel of antialiasing on the rim.
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - c, y - c) + 0.5));
      for (let i = 0; i < 3; i++) {
        rows[row + 1 + x * 3 + i] = Math.round(bg[i] + (disc[i] - bg[i]) * a);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const defaults = new Map<IconSize, Buffer>();
function defaultIcon(size: IconSize): Buffer {
  let png = defaults.get(size);
  if (!png) {
    png = drawDefaultIcon(size);
    defaults.set(size, png);
  }
  return png;
}

// ── The branding ─────────────────────────────────────────────

export interface AppBrandingView {
  name: string;
  customIcon: boolean;
  /** Changes whenever the name or the icon does: appended to the icon URLs. */
  version: string;
}

export interface AppBrandingInput {
  name?: unknown;
  /** `{ "180": base64, "192": base64, "512": base64 }`, or null for the default. */
  icons?: unknown;
}

function invalid(message: string): SharedAccessError {
  return new SharedAccessError("invalid_app", message, 400);
}

export class AppBranding {
  constructor(private readonly settings: Pick<SettingsManager, "get" | "set">) {}

  name(): string {
    return (this.settings.get(SETTING_APP_NAME) ?? "").trim() || DEFAULT_APP_NAME;
  }

  hasCustomIcon(): boolean {
    return ICON_SIZES.every((s) => Boolean(this.settings.get(iconKey(s))));
  }

  icon(size: IconSize): Buffer {
    if (this.hasCustomIcon()) return Buffer.from(this.settings.get(iconKey(size)) ?? "", "base64");
    return defaultIcon(size);
  }

  version(): string {
    const h = createHash("sha256").update(this.name());
    for (const s of ICON_SIZES) h.update("\n").update(this.settings.get(iconKey(s)) ?? "");
    return h.digest("hex").slice(0, 10);
  }

  view(): AppBrandingView {
    return { name: this.name(), customIcon: this.hasCustomIcon(), version: this.version() };
  }

  /** Validates everything before writing anything: a refused upload changes nothing. */
  update(input: AppBrandingInput): AppBrandingView {
    const writes: [string, string][] = [];
    if (input.name !== undefined) {
      if (typeof input.name !== "string") throw invalid("The name must be text");
      const name = input.name.trim();
      if (name.length > APP_NAME_MAX)
        throw invalid(`The name is limited to ${APP_NAME_MAX} characters`);
      writes.push([SETTING_APP_NAME, name]);
    }
    if (input.icons === null) {
      for (const s of ICON_SIZES) writes.push([iconKey(s), ""]);
    } else if (input.icons !== undefined) {
      if (typeof input.icons !== "object") throw invalid("The icons must be an object");
      const icons = input.icons as Record<string, unknown>;
      for (const s of ICON_SIZES) {
        const b64 = icons[String(s)];
        if (typeof b64 !== "string" || !b64) throw invalid(`The ${s} px icon is missing`);
        const png = Buffer.from(b64, "base64");
        if (png.length > ICON_MAX_BYTES) throw invalid(`The ${s} px icon is too large`);
        const dims = pngSize(png);
        if (!dims) throw invalid(`The ${s} px icon is not a PNG`);
        if (dims.width !== s || dims.height !== s) {
          throw invalid(`The ${s} px icon measures ${dims.width}×${dims.height}`);
        }
        writes.push([iconKey(s), png.toString("base64")]);
      }
    }
    for (const [k, v] of writes) this.settings.set(k, v);
    return this.view();
  }
}
