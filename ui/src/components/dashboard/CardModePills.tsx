import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecipes } from "../../store/useRecipes";
import { modesForEquipment, type EquipmentMode } from "../../lib/recipe-target-modes";
import { modePillColors } from "../../lib/recipe-mode-colors";
import { cycleOptionLabel, resolveCycle } from "../recipes/recipe-cycle";

const SIZE = {
  md: "px-2 py-0.5",
  sm: "px-1.5 leading-4",
} as const;

/**
 * The mode of the recipes driving an equipment (spec 201): « Cocoon » on the
 * stove.
 *
 * `under` (the cards) places it under its parent's title block, which is
 * `relative`: on the left, over the top of the card body, so the title stays
 * centred and whole and the card keeps its height (mockup option B2).
 * `inline` (the phone sheet header) keeps it in the flow.
 *
 * `interactive` turns each pill into the zone page's cycle: a click moves to
 * the next mode. The phone card stays display only, since the whole card is
 * a button and a button cannot nest another; its sheet carries the control.
 */
export function CardModePills({
  equipmentId,
  size = "md",
  placement = "under",
  interactive = false,
}: {
  equipmentId: string | null;
  size?: keyof typeof SIZE;
  placement?: "under" | "inline";
  interactive?: boolean;
}) {
  const instances = useRecipes((s) => s.instances);
  const recipes = useRecipes((s) => s.recipes);
  const modes = useMemo(
    () => (equipmentId ? modesForEquipment(equipmentId, instances, recipes) : []),
    [equipmentId, instances, recipes],
  );
  if (modes.length === 0) return null;

  const box =
    placement === "under"
      ? "absolute left-0 top-full mt-0.5 z-10 flex gap-1 pointer-events-none"
      : "flex flex-wrap gap-1";
  return (
    <span className={box}>
      {modes.map((mode) => (
        <ModePill key={mode.key} mode={mode} size={size} interactive={interactive} />
      ))}
    </span>
  );
}

function ModePill({
  mode,
  size,
  interactive,
}: {
  mode: EquipmentMode;
  size: keyof typeof SIZE;
  interactive: boolean;
}) {
  const { t, i18n } = useTranslation();
  const sendAction = useRecipes((s) => s.sendAction);
  const [sending, setSending] = useState(false);
  const { instance, recipe, action, option } = mode;
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const colors = modePillColors(option.value);
  const label = cycleOptionLabel(recipe, action, option, lang, t);
  const base = `inline-flex items-center rounded-full text-micro font-semibold whitespace-nowrap ${SIZE[size]}`;
  const style = { backgroundColor: colors.bg, color: colors.text };

  const cycle = interactive ? resolveCycle(instance, action) : null;
  if (!cycle) {
    return (
      <span data-testid="card-mode-pill" className={base} style={style}>
        {label}
      </span>
    );
  }

  const nextLabel = cycleOptionLabel(recipe, action, cycle.next, lang, t);
  const handleClick = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sendAction(instance.id, action.id, { mode: cycle.next.value });
    } catch {
      // ignore — the state comes back through the WebSocket
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      type="button"
      data-testid="card-mode-pill"
      onClick={handleClick}
      disabled={sending}
      className={`${base} pointer-events-auto cursor-pointer transition-all duration-150 hover:brightness-95 active:scale-95 disabled:opacity-50 disabled:cursor-default`}
      style={style}
      title={t("recipes.actions.cycleTo", { mode: nextLabel })}
    >
      {label}
    </button>
  );
}
