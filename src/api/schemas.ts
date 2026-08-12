// Shared JSON-schema fragments for route input validation (issue #452).
// These encode the recurring hand-rolled rules so each route stays a thin
// declaration and the rules cannot drift between routes.

/** A non-blank string of at most 100 chars (old `!v?.trim()` + length <= 100). */
export const nameField = { type: "string", pattern: "\\S", maxLength: 100 };

/** An optional description: string or null, at most 500 chars (old `v && v.length > 500`). */
export const descriptionField = { type: ["string", "null"], maxLength: 500 };

/**
 * A non-empty string (old `!v` guard: rejects undefined and ""), but WITHOUT a
 * whitespace check — "   " passes, matching a bare `!v`. Use this instead of
 * `nameField` where the old code did not `.trim()`.
 */
export const nonEmptyString = { type: "string", minLength: 1 };
