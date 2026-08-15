import type { ReactNode } from "react";

// Spec 149 (issue #325) — layout-agnostic widget presentation descriptor.
// One resolver per equipment type produces this shape; every surface
// (desktop widget, mobile card, mobile tap action, detail sheet) renders it
// instead of re-deriving icon/state/controls on its own.

/** Rendering context passed to the descriptor's icon factory. */
export interface IconCtx {
  /**
   * Which surface is asking. Mobile cards render icons ~96px before their
   * 50% container scale; desktop slots are ~64px. The factory picks
   * size/stroke from this instead of each surface hardcoding its own.
   */
  surface: "desktop" | "mobile-card" | "detail";
}

/**
 * Declarative control — the resolver owns WHICH control exists and the exact
 * order alias/values (single source of truth); each surface owns only the
 * pixels (desktop 40px button, mobile direct tap, sheet full-width button).
 *
 * A "slider" kind (brightness/position/setpoint) is reserved for the phases
 * that migrate the light/shutter/thermostat families.
 */
export type WidgetControl =
  | {
      kind: "toggle";
      /** Order binding alias to execute. */
      alias: string;
      /** Current state — drives the button tint and picks the value to send. */
      on: boolean;
      /** Value that turns the equipment ON (enum match or boolean true). */
      onValue: unknown;
      /** Value that turns the equipment OFF. */
      offValue: unknown;
    }
  | {
      kind: "buttons";
      buttons: Array<{ label: string; alias: string; value: unknown }>;
    };

/** Everything a surface needs to render an equipment widget. */
export interface WidgetPresentation {
  /** Icon factory — respects the widget.icon custom override internally (#318). */
  icon: (ctx: IconCtx) => ReactNode;
  /** Drives the active tint on the state pill / icon. */
  isActive: boolean;
  /** Pre-localized state text. Surfaces never re-translate. */
  state: { primary: string; secondary?: string[] };
  controls: WidgetControl[];
  accent?: "success" | "warning" | null;
}
