// Spec 181 — which control a server refusal is about, so it is shown next to it.

export type RefusalField = "label" | "name" | "gates" | "dates" | "hours" | "other";

const FIELDS: Record<string, RefusalField> = {
  label_required: "label",
  label_too_long: "label",
  name_required: "name",
  no_gate: "gates",
  unknown_gate: "gates",
  unsupported_equipment: "gates",
  no_command: "gates",
  invalid_value: "gates",
  end_before_start: "dates",
  invalid_date: "dates",
  shorten_refused: "dates",
  invalid_hours: "hours",
  window_crosses_midnight: "hours",
  windows_overlap: "hours",
};

export function refusalField(code: string): RefusalField {
  return FIELDS[code] ?? "other";
}
