// Spec 196 (FR-E) — the energy and history charts take their colours from the
// theme tokens (design-system/tokens.css), never from a literal. A literal in a
// component ignores the theme: the legend swatches of the Consumption and
// Production pages stayed light-theme green in dark while their bars changed.
//
// Flags, in any string literal or template chunk (comments are not read):
// - a colour-shaped hex: `#` then exactly 3, 4, 6 or 8 hex digits, not glued to
//   a word or to `&` (`&#123;`), and not followed by a word character or `-`;
// - an `rgb(` / `rgba(` / `hsl(` / `hsla(` call with a literal first argument
//   (`rgb(var(--x))` names a token and passes).
// A hex is not flagged where it is a reference or prose: after `url(` or
// `href=`, in an `href` / `xlinkHref` attribute, in a bracket opened after a
// space ("(#960)"), or right after a plain word that is not a CSS keyword
// ("voir #617", "issue #123"; `solid #fff` is CSS and is flagged). The
// palettes that need a hex (the Analyse identity a saved chart stores) live in
// src/lib.

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const COLOR_FN = /(?<![\w-])(?:rgba?|hsla?)\(\s*[-+.\d]/i;
const REFERENCE_BEFORE = /(?:url\(\s*['"]?|href\s*=\s*['"]?)$/i;
/** A bracket opened after a space is prose ("(#960)"); a CSS call has a name. */
const PROSE_BRACKET_BEFORE = /(?:^|\s)\($/;
const WORD_BEFORE = /(?:^|[^\w-])([A-Za-zÀ-ÿ]{2,})\s+$/;
/** Words a colour may follow in CSS (border, gradient, color-mix, shadow). */
const CSS_KEYWORDS = new Set([
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
  "none",
  "transparent",
  "currentcolor",
  "srgb",
  "oklch",
  "oklab",
  "to",
  "at",
  "left",
  "right",
  "top",
  "bottom",
  "center",
  "circle",
  "ellipse",
]);

/** True when `text` holds a colour literal the theme cannot follow. */
export function hasColorLiteral(text) {
  if (typeof text !== "string") return false;
  if (COLOR_FN.test(text)) return true;
  for (const m of text.matchAll(HEX)) {
    const before = text.slice(0, m.index);
    if (/[\w&#]$/.test(before)) continue;
    if (REFERENCE_BEFORE.test(before) || PROSE_BRACKET_BEFORE.test(before)) continue;
    const word = WORD_BEFORE.exec(before);
    if (word && !CSS_KEYWORDS.has(word[1].toLowerCase())) continue;
    return true;
  }
  return false;
}

/** An `href="#abc"` attribute is an anchor, not a colour. */
function isHrefValue(node) {
  const parent = node.parent;
  const attr = parent?.type === "JSXExpressionContainer" ? parent.parent : parent;
  if (attr?.type !== "JSXAttribute") return false;
  const name = attr.name?.type === "JSXNamespacedName" ? attr.name.name.name : attr.name?.name;
  return /^(?:href|xlinkHref)$/i.test(name ?? "");
}

const noHexColor = {
  meta: {
    type: "problem",
    docs: {
      description: "Chart colours come from theme tokens, not hex, rgb() or hsl() literals.",
    },
    schema: [],
    messages: {
      hex: "Colour literal in a chart component: use a token (var(--color-energy-hp), var(--color-series-N)…), see design-system/tokens.css.",
    },
  },
  create(context) {
    const check = (node, text) => {
      if (hasColorLiteral(text)) context.report({ node, messageId: "hex" });
    };
    return {
      Literal(node) {
        if (isHrefValue(node)) return;
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default { rules: { "no-hex-color": noHexColor } };
