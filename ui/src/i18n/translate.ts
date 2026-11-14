/**
 * The `t` function as pure helpers take it: react-i18next's `t` and a plain
 * test stub (`(k) => k`) both fit.
 *
 * Two overloads rather than `(key, opts?) => string`: since i18next 27,
 * `TFunction` is not assignable to a single signature with optional options,
 * only to one signature per arity.
 */
export interface Translate {
  (key: string): string;
  (key: string, opts: Record<string, unknown>): string;
}
