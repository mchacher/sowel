import type { ReactNode } from "react";
import { useShadowMode } from "../../store/useShadowMode";

// iOS 26 blurs the top ~40pt of the page (title and pills included) unless a
// fixed, full-width box of one solid colour covers the top edge. Below lg the
// safe-area band and the top bar are that box, and a spacer keeps their place.
// They stay in the flow under a shadow or takeover banner, which they would cover.
// The fixed box sits at z-30: an overlay rendered inside <main> under a stacking
// context (transform, opacity, filter) ends up below it, so portal overlays.
export function TopBarFrame({ children }: { children: ReactNode }) {
  const topBanner = useShadowMode((s) => s.shadowMode || s.takeoverPending);

  return (
    <>
      <div
        data-testid="topbar-frame"
        className={`flex-shrink-0 bg-surface ${topBanner ? "" : "max-lg:fixed max-lg:inset-x-0 max-lg:top-0 max-lg:z-30"}`}
      >
        <div style={{ height: "env(safe-area-inset-top, 0px)" }} />
        {children}
      </div>
      {!topBanner && (
        <div
          aria-hidden
          data-testid="topbar-spacer"
          className="lg:hidden flex-shrink-0"
          style={{ height: "calc(env(safe-area-inset-top, 0px) + var(--spacing-topbar))" }}
        />
      )}
    </>
  );
}
