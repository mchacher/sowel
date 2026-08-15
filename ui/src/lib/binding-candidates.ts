/**
 * Binding candidates — re-export of the single shared implementation
 * (spec 150). This file used to be a hand-synced mirror of
 * src/equipments/binding-candidates.ts; the two copies diverged (the mirror
 * was missing light_dimmable/light_color/gate among others, silently hiding
 * compatible devices in the selector). The one implementation now lives in
 * src/shared/binding-candidates.ts, which is pure TS with no backend
 * dependency, so the UI bundles it directly.
 */

export {
  CANDIDATE_BASED_TYPES,
  computeBindingCandidates,
  hasFreeCandidates,
  inferBindingCategory,
  type BindingCandidate,
  type CandidateData,
  type CandidateOrder,
} from "../../../src/shared/binding-candidates";
