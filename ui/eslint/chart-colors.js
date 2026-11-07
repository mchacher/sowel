// Spec 196 (FR-E) — the energy and history charts take their colours from the
// theme tokens (design-system/tokens.css), never from a hex literal. A hex in a
// component ignores the theme: the legend swatches of the Consumption and
// Production pages stayed light-theme green in dark while their bars changed.
//
// Flags any string literal or template chunk holding a colour hex (#rgb,
// #rgba, #rrggbb, #rrggbbaa). Comments are not read. The palettes that need a
// hex (the Analyse identity a saved chart stores) live in src/lib.

const HEX = /(^|[^\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;

const noHexColor = {
  meta: {
    type: "problem",
    docs: { description: "Chart colours come from theme tokens, not hex literals." },
    schema: [],
    messages: {
      hex: "Hex colour in a chart component: use a token (var(--color-energy-hp), var(--color-series-N)…), see design-system/tokens.css.",
    },
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text === "string" && HEX.test(text)) context.report({ node, messageId: "hex" });
    };
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default { rules: { "no-hex-color": noHexColor } };
