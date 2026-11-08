import type React from "react";

/**
 * The figure the Consumption and Production cards open on (spec 197,
 * FR-E6.1–2): the period total at 28 px, what it is measured against beside
 * it, and one sentence of what it is made of. It used to be the last line
 * under the chart, so the answer came after the picture.
 */
export function PeriodHeadline({
  value,
  context,
  sentence,
  aside,
}: {
  /** The formatted total, unit included. */
  value: string;
  /** The period word or the forecast it is read against. */
  context: React.ReactNode;
  sentence?: React.ReactNode;
  /** Right-aligned slot, e.g. the Total / By usage switch. */
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-display font-semibold text-text tabular-nums">{value}</span>
          <span className="text-small text-text-tertiary">{context}</span>
        </div>
        {sentence && <p className="text-small text-text-secondary tabular-nums">{sentence}</p>}
      </div>
      {aside}
    </div>
  );
}
