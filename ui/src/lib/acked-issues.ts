/**
 * Client-side acknowledgement of banner issues (#424).
 *
 * Alarms live only in the client WS store (no server persistence). A persistent
 * condition (e.g. a plug left unplugged) never resolves, so its warning would
 * sit in the header pill forever. Acknowledging an issue hides it locally until
 * it is re-raised as a materially different one, so a genuinely new problem is
 * never silently swallowed.
 *
 * The acknowledgement is keyed on a signature of source + level + wording, so
 * the SAME issue stays hidden across reloads while a DIFFERENT one re-appears.
 * State is stored in localStorage (per browser); a shared, server-persisted
 * acknowledgement is a separate feature.
 */

import { wordingSignature, type AlarmWording } from "./alarm-message";

const STORAGE_KEY = "sowel_acked_issues";
/** Control-char separator that cannot appear in a source id, level, or wording. */
const SEP = "\u0000";

export interface IssueSignatureInput extends AlarmWording {
  source: string;
  level: string;
}

/**
 * Stable signature of an issue. Acknowledging hides THIS exact issue; any change
 * to source, level, or wording yields a new signature and re-surfaces it.
 *
 * A localised alarm (#720) signs on its i18n key and parameters, never on the
 * rendered text: the same alarm has to stay acknowledged across a language
 * switch, and a change of parameters still has to re-surface it.
 */
export function issueSignature(issue: IssueSignatureInput): string {
  return [issue.source, issue.level, wordingSignature(issue)].join(SEP);
}

/** Read acknowledged signatures from localStorage. Never throws. */
export function loadAckedSignatures(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Persist acknowledged signatures. Silently no-ops when storage is unavailable. */
export function saveAckedSignatures(signatures: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signatures));
  } catch {
    // private mode / storage disabled / non-browser env: acknowledgement
    // degrades to in-memory only, which is acceptable.
  }
}
