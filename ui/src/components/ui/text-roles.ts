// Spec 196, FR-5 — text roles shared by many screens. Labels are sentence
// case: size and weight carry the hierarchy, not capitals and letter-spacing.
// Uppercase is kept for table column headers only (an ESLint rule checks it).

/** A form field label (13 px, medium, secondary text). */
export const FIELD_LABEL = "block text-small font-medium text-text-secondary mb-1";

/** The same label without its colour, for a label whose tone changes (a modified recipe slot). */
export const FIELD_LABEL_UNTONED = "block text-small font-medium mb-1";
