import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChefHat,
  Clock,
  DoorClosed,
  Droplets,
  Fan,
  Flame,
  Lightbulb,
  Snowflake,
  Sun,
  Thermometer,
  Timer,
  Truck,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { ConfirmActionSheet } from "./ConfirmActionSheet";
import { useCardPrimaryAction } from "./card-primary-action";
import { CountdownTimer, ModeCyclePill } from "../recipes/recipe-form-fields";
import { cycleOptionLabel, resolveCycle } from "../recipes/recipe-cycle";
import { recipeName } from "../../lib/recipe-i18n";
import { useRecipes } from "../../store/useRecipes";
import type { DashboardWidget } from "../../types";

/**
 * Icons a recipe may name in its `tile.icon` declaration.
 *
 * A closed set on purpose: resolving an arbitrary Lucide name at runtime means
 * importing the whole icon package and losing tree-shaking, for a field only a
 * handful of recipes will ever set. An unknown name falls back to the default
 * rather than failing — a typo in a third-party package must not blank a tile.
 */
const TILE_ICONS: Record<string, LucideIcon> = {
  ChefHat,
  Clock,
  DoorClosed,
  Droplets,
  Fan,
  Flame,
  Lightbulb,
  Snowflake,
  Sun,
  Thermometer,
  Timer,
  Truck,
  Waves,
  Zap,
};

/**
 * Dashboard tile for a recipe instance (spec 169).
 *
 * Renders nothing the recipe did not declare: the summary line, the countdown
 * and the controls each come from a key named in `recipe.tile`, and each is
 * omitted when the instance state does not carry it. A recipe with no `tile`
 * never reaches this component — the picker does not list it and the API
 * refuses to pin it.
 *
 * The mobile branch is a plain `div`, not the `button` that `MobileWidgetCard`
 * uses: this tile carries its own controls, and nesting a button inside a
 * button is invalid HTML that breaks keyboard navigation.
 *
 * Spec 171 — when the tile renders exactly one control, the whole card fires
 * it, like every other widget on this Dashboard. A recipe that moves something
 * physical says so with `tile.confirm`, and the mobile card then asks for a
 * slide before it acts.
 */
export function RecipeTile({
  widget,
  isMobile,
  editMode,
}: {
  widget: DashboardWidget;
  isMobile?: boolean;
  editMode?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";

  // Read the store rather than take three more props through WidgetRenderer:
  // the recipe row does the same, and the dashboard's renderer already carries
  // more prop-drilling than it should.
  const instances = useRecipes((s) => s.instances);
  const recipes = useRecipes((s) => s.recipes);
  const sendAction = useRecipes((s) => s.sendAction);

  // Above the early return: hooks cannot hide behind a condition.
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const instance = instances.find((i) => i.id === widget.recipeInstanceId);
  const recipe = instance ? recipes.find((r) => r.id === instance.recipeId) : undefined;

  const tile = recipe?.tile;
  const title = widget.label ?? (recipe ? recipeName(recipe, lang) : t("dashboard.recipeTile.gone"));

  // A package can stop declaring a tile from one version to the next, and a
  // widget must survive that: it says so and keeps its place. Deleting the
  // user's layout because a third-party package changed its mind would be a
  // worse answer than an honest empty tile.
  if (!recipe || !tile || !instance) {
    const body = (
      <span className="text-[11px] text-text-tertiary text-center px-2">
        {t("dashboard.recipeTile.unavailable")}
      </span>
    );
    return isMobile ? (
      <MobileShell title={title} editMode={editMode}>
        <ChefHat size={22} strokeWidth={1.5} className="text-text-tertiary" />
        {body}
      </MobileShell>
    ) : (
      <WidgetCard label={title}>
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <ChefHat size={34} strokeWidth={1.5} className="text-text-tertiary" />
          {body}
        </div>
      </WidgetCard>
    );
  }

  const Icon = (tile.icon && TILE_ICONS[tile.icon]) || ChefHat;
  const state = instance.state ?? {};
  const summary = state[tile.summaryKey ?? "summary"];
  const expiresAt = state[tile.countdownKey ?? "timerExpiresAt"];

  // `tile.actions` names ids; anything it names that the recipe does not
  // actually declare is skipped rather than rendered as a dead control.
  const actions = (recipe.actions ?? []).filter((a) => (tile.actions ?? []).includes(a.id));

  const dim = instance.enabled ? "" : "opacity-50";

  const icon = (
    <Icon
      size={isMobile ? 22 : 34}
      strokeWidth={1.5}
      className={instance.enabled ? "text-primary" : "text-text-tertiary"}
    />
  );

  const summaryLine =
    typeof summary === "string" && summary.length > 0 ? (
      <span
        className={`text-[11px] text-text-secondary text-center leading-tight ${
          isMobile ? "truncate max-w-full" : "line-clamp-2 px-1"
        }`}
      >
        {summary}
      </span>
    ) : null;

  const countdown =
    typeof expiresAt === "string" && instance.enabled ? <CountdownTimer expiresAt={expiresAt} /> : null;

  // Spec 171 — one control, one card action. `resolveCycle` is the very call
  // the pill makes, so the card can never offer a press the pill would refuse;
  // two controls and the card would have to guess which one, none and there is
  // nothing to fire.
  const only = actions.length === 1 ? actions[0] : undefined;
  const cycle = only ? resolveCycle(instance, only) : null;

  const fire = () => {
    if (!only || !cycle || sending) return;
    setSending(true);
    void sendAction(instance.id, only.id, { mode: cycle.next.value })
      .catch(() => {
        // ignore — the state comes back over the WebSocket either way
      })
      .finally(() => setSending(false));
  };

  // Edit mode never actuates, the way the mobile equipment cards already
  // behave: a Dashboard being rearranged is not a Dashboard being used.
  const primary =
    !cycle || editMode
      ? undefined
      : tile.confirm && isMobile
        ? () => setConfirming(true)
        : fire;

  const confirmSheet =
    confirming && only && cycle ? (
      <ConfirmActionSheet
        title={t("dashboard.recipeTile.confirmTitle", {
          mode: cycleOptionLabel(recipe, only, cycle.next, lang, t),
        })}
        subtitle={[title, typeof summary === "string" ? summary : ""].filter(Boolean).join(" · ")}
        slideLabel={t("dashboard.recipeTile.slideToConfirm")}
        confirmedLabel={t("dashboard.recipeTile.confirmed")}
        onConfirm={fire}
        onClose={() => setConfirming(false)}
      />
    ) : null;

  const controls =
    actions.length > 0 ? (
      <div className="flex items-center justify-center gap-1 flex-wrap">
        {actions.map((action) => (
          <ModeCyclePill
            key={action.id}
            instance={instance}
            recipe={recipe}
            action={action}
            lang={lang}
            sendAction={sendAction}
          />
        ))}
      </div>
    ) : null;

  if (isMobile) {
    // The sheet is a sibling of the shell, not a child: a portal still bubbles
    // its clicks through the REACT tree, so a tap on the backdrop inside the
    // card would come straight back out as a tap on the card.
    return (
      <>
        <MobileShell title={title} editMode={editMode} className={dim} onClick={primary}>
          <div className="flex-1 flex items-center justify-center min-h-0 gap-1.5">
            {icon}
            {countdown}
          </div>
          {summaryLine}
          {controls}
        </MobileShell>
        {confirmSheet}
      </>
    );
  }

  return (
    <WidgetCard label={title} className={dim} onClick={primary}>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0">
        {icon}
        {countdown}
        {summaryLine}
      </div>
      {controls}
    </WidgetCard>
  );
}

/** Mobile chrome matching MobileWidgetCard, minus its whole-card button. */
function MobileShell({
  title,
  editMode,
  className = "",
  onClick,
  children,
}: {
  title: string;
  editMode?: boolean;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const cardAction = useCardPrimaryAction(onClick);
  return (
    <div
      className={`relative bg-surface border border-border rounded-[8px] p-2 flex flex-col items-center h-[120px] overflow-hidden w-full gap-1 ${
        onClick ? "cursor-pointer active:scale-[0.98] transition-transform" : ""
      } ${className}`}
      {...cardAction}
    >
      <span
        className={`text-[12px] font-semibold text-text truncate w-full text-center ${
          editMode ? "pl-5 pr-8" : ""
        }`}
      >
        {title}
      </span>
      {children}
    </div>
  );
}
