// Spec 196 — design-system rules on class names, as their own rules so that a
// justified exception disables one of them (`sowel/type-scale`) and not the
// number-formatting selectors of no-restricted-syntax.
//
// Every string literal and template chunk is read as a class list only when it
// looks like one: lower-case tokens made of class characters. Prose (capitals,
// accents, punctuation) is skipped. Each token is stripped of its variants
// (`sm:`, `hover:`, `[&>svg]:`) and of `!` before it is judged, so
// `sm:uppercase` or `!rounded-xl` cannot slip past.

const CLASS_TOKEN = /^[a-z0-9!@\-_:[\]/.%#(),'"=+*&>~<]+$/;

/** The utility a token applies, without its variants and its important mark. */
function baseOf(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!|!$/g, "");
}

/** The class tokens of a string, or none when it does not read as a class list. */
function classTokens(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((t) => CLASS_TOKEN.test(t))) return [];
  return tokens;
}

function stringRule({ description, message, judge, skip, messages = {}, extra = () => ({}) }) {
  return {
    meta: {
      type: "problem",
      docs: { description },
      schema: [],
      messages: { off: message, ...messages },
    },
    create(context) {
      function check(node, text) {
        if (skip?.(node)) return;
        for (const token of classTokens(text)) {
          // A chunk cut by `${…}` may end on a partial token (`rounded-${r}`).
          if (token.endsWith("-")) continue;
          if (judge(baseOf(token))) {
            context.report({ node, messageId: "off" });
            return;
          }
        }
      }
      return {
        Literal(node) {
          if (typeof node.value === "string") check(node, node.value);
        },
        TemplateElement(node) {
          check(node, node.value.raw);
        },
        ...extra(context),
      };
    },
  };
}

/** Inside a table column header, where uppercase stays. */
function inTableHeader(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "JSXElement" && /^(thead|th)$/.test(p.openingElement.name.name ?? ""))
      return true;
  }
  return false;
}

const RADIUS = /^rounded(?:-(?:t|r|b|l|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-(.+))?$/;
const RADIUS_STEPS = new Set(["xs", "sm", "md", "lg", "full"]);

export default {
  rules: {
    // FR-5 — one type scale (text-micro … text-value, index.css @theme). It
    // replaced 33 hand-picked sizes from 8 to 56 px. A colour in brackets
    // (text-[var(--n-700)]) is fine.
    "type-scale": stringRule({
      description: "Font sizes come from the type scale",
      message: "Arbitrary font size: use a step of the type scale (text-micro … text-value).",
      judge: (c) => /^text-\[(\d|\.\d|clamp|calc|length:)/.test(c) || /^\[font-size:/.test(c),
      // `{ fontSize: 10 }` in a style or a chart prop is a size off the scale too.
      messages: {
        prop: "Font size in a style or chart prop: use CHART_TICK_FONT / CHART_TOOLTIP_FONT (lib/chart-font) or a text-* class.",
      },
      extra: (context) => ({
        "Property[key.name='fontSize'] > Literal.value"(node) {
          context.report({ node, messageId: "prop" });
        },
      }),
    }),
    // FR-5 (slice 5b) — labels are sentence case: size and weight carry the
    // hierarchy. A table column header is the one place uppercase stays.
    "sentence-case": stringRule({
      description: "Labels are sentence case",
      message: "Uppercase is for table column headers only: write the label in sentence case.",
      judge: (c) => c === "uppercase",
      skip: inTableHeader,
    }),
    // Decision pr7-rayons — rounded-sm (6 px, controls), rounded-md (10 px,
    // cards, rows, popovers), rounded-lg (16 px, modals and sheets),
    // rounded-full; rounded-xs (2 px) for chart bars and swatches. A bare
    // `rounded`, an arbitrary or a removed step would draw 4 px or nothing.
    "radius-scale": stringRule({
      description: "Radii come from the scale",
      message:
        "Radius off the scale: use rounded-sm (controls), rounded-md (cards), rounded-lg (sheets) or rounded-full.",
      judge: (c) => {
        const m = c.match(RADIUS);
        return m !== null && !RADIUS_STEPS.has(m[1]);
      },
    }),
  },
};
