// Spec 210 — the Sowel mark, defined once. SowelLogo.tsx renders it; the static
// copies (splash, favicons, PWA icons, docs landing) are kept in step with it by
// logo-sync.test.ts. viewBox "20 10 160 165", round caps and joins.

export const HOUSE =
  "M100 30 L160 90 Q165 95 160 100 L160 150 Q160 158 152 158 L48 158 Q40 158 40 150 L40 100 Q35 95 40 90 Z";

export interface LogoWeight {
  /** Stroke widths: outline, eyes, smile. */
  house: number;
  eye: number;
  smile: number;
  /** Absolute paths, as the static SVG copies draw them. */
  leftEye: string;
  rightEye: string;
  smilePath: string;
  /** The winking eye, drawn around its own centre so it can scale in place. */
  wink: { origin: string; path: string };
}

/** From 32 px up. */
export const MASTER: LogoWeight = {
  house: 9,
  eye: 7,
  smile: 7.5,
  leftEye: "M75 94 Q81 84 87 94",
  rightEye: "M113 94 Q119 84 125 94",
  smilePath: "M72 114 Q100 142 128 114",
  wink: { origin: "119 89", path: "M-6 5 Q0 -5 6 5" },
};

/** Below 32 px: heavier strokes so the face still reads (tab, mobile header). */
export const SMALL: LogoWeight = {
  house: 14.5,
  eye: 11.5,
  smile: 12.5,
  leftEye: "M74 95 Q81 83 88 95",
  rightEye: "M112 95 Q119 83 126 95",
  smilePath: "M68 115 Q100 147 132 115",
  wink: { origin: "119 89", path: "M-7 6 Q0 -6 7 6" },
};

export const SMALL_BELOW_PX = 32;
