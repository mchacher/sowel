import type React from "react";
import { splitUnits } from "../../lib/column-units";

/**
 * The text of an uppercase column header (#1231). The label is uppercased by
 * the header's class, the unit keeps its own case: « HP €/kWh » reads « HP
 * €/kWh », not « HP €/KWH ». SI forbids changing the case of a unit symbol.
 */
export function ColumnLabel({ text }: { text: string }): React.ReactNode {
  return splitUnits(text).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="normal-case">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
