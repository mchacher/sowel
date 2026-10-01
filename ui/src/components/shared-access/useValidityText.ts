import { useTranslation } from "react-i18next";
import type { ValidityProblem } from "../../lib/shared-access-period";

/** A refusal found before sending, worded like the mock-up. */
export function useValidityText(): (p: ValidityProblem) => string {
  const { t } = useTranslation();
  return (p) => {
    switch (p.code) {
      case "end_before_start":
        return t("sharedAccess.error.end_before_start");
      case "invalid_hours":
        return t("sharedAccess.check.invalidHours", { from: p.window.from, to: p.window.to });
      case "window_crosses_midnight":
        return t("sharedAccess.check.crossesMidnight", { from: p.window.from, to: p.window.to });
      case "windows_overlap":
        return t("sharedAccess.check.overlap", {
          a: `${p.window.from}–${p.window.to}`,
          b: `${p.other.from}–${p.other.to}`,
        });
    }
  };
}
