/**
 * Historization defaults — re-export of the single shared implementation.
 *
 * Same arrangement as ./binding-candidates (spec 150): the rule deciding
 * whether a data binding is written to InfluxDB is pure TS with no backend
 * dependency, so the UI bundles the backend's own module rather than keeping a
 * copy that can drift. Used to tell the owner which bindings a plan would
 * start recording (issue #707).
 */

export {
  ALIAS_DEFAULTS_OFF,
  ALIAS_DEFAULTS_ON,
  CATEGORY_DEFAULTS_ON,
  resolveHistorize,
} from "../../../src/shared/history-defaults";
