// Spec 124 — Sticky banner that appears on every page when the server
// reports `shadowMode === true`. Intentionally non-dismissable: the
// whole point is that the operator cannot accidentally forget which
// instance they're looking at.

import { useTranslation } from "react-i18next";
import { useShadowMode } from "../../store/useShadowMode";

export function ShadowBanner() {
  const { t } = useTranslation();
  const shadowMode = useShadowMode((s) => s.shadowMode);
  if (!shadowMode) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-500 text-white text-[12px] sm:text-[13px] font-medium px-4 py-1.5 text-center sticky top-0 z-50 shadow-sm"
    >
      {t("shadow.banner")}
    </div>
  );
}
