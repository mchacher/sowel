import { useState, useMemo, useId } from "react";
import { MarqueeName } from "../ui/MarqueeName";
import { useTranslation } from "react-i18next";
import { ShieldOff, Settings } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useAuth } from "../../store/useAuth";
import type { RecipeInfo, RecipeInstance } from "../../types";
import { recipeName } from "../../lib/recipe-i18n";
import { instanceEquipmentNames, shortNameList } from "../../lib/recipe-slots";
import { CountdownTimer, ModeCyclePill } from "./recipe-form-fields";
import { resolveCycle } from "./recipe-cycle";
import { RecipeIconTile } from "./RecipeIconTile";
import { RecipeJournal } from "./RecipeJournal";
import { RecipeSettings } from "./RecipeSettings";
import { instanceContextLine, instanceSummary, isInstanceInAlarm } from "../../lib/recipe-rows";
import { DuplicateRecipeModal } from "./DuplicateRecipeModal";
import { BottomSheet } from "../dashboard/BottomSheet";
import { useIsMobile } from "../../hooks/useIsMobile";
import { Switch } from "../ui/Switch";

// ============================================================
// Instance row
// ============================================================

export function RecipeInstanceRow({
  instance,
  recipes,
  zoneId,
  variant = "row",
}: {
  instance: RecipeInstance;
  recipes: RecipeInfo[];
  zoneId: string;
  /** "child": one line inside a group of the same recipe (spec 198). */
  variant?: "row" | "child";
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const isMobile = useIsMobile();
  const deleteInstance = useRecipes((s) => s.deleteInstance);
  const enableInstance = useRecipes((s) => s.enableInstance);
  const disableInstance = useRecipes((s) => s.disableInstance);
  const sendAction = useRecipes((s) => s.sendAction);
  const equipments = useEquipments((s) => s.equipments);
  const [showLog, setShowLog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);

  const recipe = recipes.find((r) => r.id === instance.recipeId);
  const displayName = recipe ? recipeName(recipe, lang) : instance.recipeId;
  // What this instance acts on (#1165): the equipment of the recipe's first
  // equipment slot, so instances of one recipe can be told apart. Identity,
  // not state: shown on a disabled instance too.
  const equipmentNames = useMemo(
    () => (recipe ? instanceEquipmentNames(recipe.slots, instance.params, equipments) : []),
    [recipe, instance.params, equipments],
  );
  const equipmentList = shortNameList(equipmentNames);

  const handleDelete = async () => {
    if (!confirm(t("recipes.deleteConfirm"))) return;
    setDeleting(true);
    try {
      await deleteInstance(instance.id);
    } catch {
      setDeleting(false);
    }
  };

  const handleToggleEnabled = async () => {
    setToggling(true);
    try {
      if (instance.enabled) {
        await disableInstance(instance.id);
      } else {
        await enableInstance(instance.id);
      }
    } catch {
      // ignore — store refresh will reflect actual state
    } finally {
      setToggling(false);
    }
  };

  // The journal fetches and refreshes itself while shown (RecipeJournal).
  // The journal alone (spec 198): opening it closes the edit form.
  const handleShowLog = () => {
    if (!showLog) setEditing(false);
    setShowLog(!showLog);
  };

  // Live pills (#1161), on the second line next to the context (spec 198).
  const showTimer = !!instance.state?.timerExpiresAt && instance.enabled;
  const showOverride = !!instance.state?.overrideMode && instance.enabled;
  const cycleActions =
    recipe?.actions?.filter((a) => a.type === "cycle" && resolveCycle(instance, a) !== null) ?? [];
  const hasPills = showTimer || showOverride || cycleActions.length > 0;

  // Spec 198 — the second line: « equipment, summary », red while in alarm
  // (the words are the recipe's own: state-watch says « en alarme »).
  const alarm = isInstanceInAlarm(instance);
  const summary = instance.enabled ? instanceSummary(instance) : "";
  const contextText = instanceContextLine(
    equipmentList.more > 0 ? `${equipmentList.text} +${equipmentList.more}` : equipmentList.text,
    summary,
  );
  // On hover, the whole equipment list (#1165), then the summary.
  const contextTitle = instanceContextLine(equipmentNames.join(", "), summary);
  const contextId = useId();

  const handleOpenSettings = () => {
    setShowLog(false);
    setEditing(true);
  };

  const settingsButton = isAdmin && recipe && (
    <button
      type="button"
      onClick={handleOpenSettings}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-caption font-medium text-primary hover:bg-primary/8 transition-colors duration-150"
    >
      <Settings size={13} strokeWidth={1.5} aria-hidden="true" />
      {t("recipes.settings")}
    </button>
  );

  const pills = hasPills && (
    <span className="relative flex items-center gap-1.5 flex-shrink-0">
      {showTimer && <CountdownTimer expiresAt={instance.state?.timerExpiresAt as string} />}
      {showOverride && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-micro font-medium flex-shrink-0"
          style={{
            backgroundColor: "var(--color-primary-light)",
            color: "var(--color-primary)",
          }}
          title={t("recipes.overrideActive", "Override active")}
        >
          <ShieldOff size={10} strokeWidth={2} />
          {t("recipes.overrideBadge")}
        </span>
      )}
      {recipe &&
        cycleActions.map((action) => (
          <ModeCyclePill
            key={action.id}
            instance={instance}
            recipe={recipe}
            action={action}
            lang={lang}
            sendAction={sendAction}
            // A taller hit area on a phone without changing the pill's look.
            className="relative after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] sm:after:hidden"
          />
        ))}
    </span>
  );

  // Names, count and summary in their own spans: the names truncate first and
  // the count is never cut from the names it counts (#1165).
  const contextSpans = contextText ? (
    <span className="flex min-w-0" title={contextTitle}>
      {equipmentList.text && <span className="truncate">{equipmentList.text}</span>}
      {equipmentList.more > 0 && (
        <span className="flex-shrink-0 whitespace-pre"> +{equipmentList.more}</span>
      )}
      {summary && (
        <span className="truncate flex-shrink-[0.5]">
          {equipmentList.text ? `, ${summary}` : summary}
        </span>
      )}
    </span>
  ) : null;

  const toggle = isAdmin && (
    <Switch
      checked={instance.enabled}
      onChange={() => void handleToggleEnabled()}
      disabled={toggling}
      title={instance.enabled ? t("recipes.disable") : t("recipes.enable")}
      label={instance.enabled ? t("recipes.disable") : t("recipes.enable")}
      // Above the stretched button, so it keeps its own click.
      className={`relative ${variant === "row" ? "col-start-3 row-start-1 row-span-2 justify-self-end" : ""}`}
    />
  );

  const open = showLog || editing;
  // The row opens through one real button whose ::after covers the whole row
  // (equipment-row pattern): no interactive element nests in another, and the
  // switch and the pills, positioned after it, stay clickable (spec 198).
  const opener =
    "text-left min-w-0 cursor-pointer after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary";
  const rowSurface = `relative transition-colors duration-150 hover:bg-border-light/40 ${open ? "bg-border-light/40" : ""}`;
  // A child line lines its text up with the name of the group above it.
  const childIndent = "pl-[calc(1.1rem+32px+0.85rem)]";

  return (
    <div className={instance.enabled ? "" : "opacity-50"}>
      {variant === "row" ? (
        <div
          className={`grid grid-cols-[32px_1fr_auto] gap-x-[0.85rem] gap-y-0.5 items-center px-[1.1rem] py-2 min-h-[52px] ${rowSurface}`}
        >
          <RecipeIconTile
            icon={recipe?.icon}
            enabled={instance.enabled}
            alarm={alarm}
            className="row-span-2 self-center"
          />
          {/* The name owns line 1 (#1161); a name too long scrolls once (#1163). */}
          <button
            type="button"
            aria-expanded={showLog}
            aria-describedby={contextText ? contextId : undefined}
            onClick={handleShowLog}
            className={`col-start-2 row-start-1 ${opener}`}
          >
            <MarqueeName text={displayName} className="text-body font-medium text-text" />
          </button>
          {toggle}
          <div
            className={`col-start-2 row-start-2 flex items-center gap-x-2 min-w-0 text-caption ${alarm ? "text-error font-medium" : "text-text-secondary"}`}
          >
            {contextSpans && (
              <span id={contextId} className="flex min-w-0">
                {contextSpans}
              </span>
            )}
            {pills}
          </div>
        </div>
      ) : (
        <div
          className={`grid grid-cols-[1fr_auto] gap-x-[0.85rem] items-center pr-[1.1rem] ${childIndent} py-1 min-h-11 sm:min-h-9 ${rowSurface}`}
        >
          <div
            className={`flex items-center gap-x-2 min-w-0 text-small ${alarm ? "text-error font-medium" : "text-text-secondary"}`}
          >
            <button
              type="button"
              aria-expanded={showLog}
              onClick={handleShowLog}
              className={`flex ${opener}`}
            >
              {contextSpans ?? <span className="truncate">{displayName}</span>}
            </button>
            {pills}
          </div>
          {toggle}
        </div>
      )}

      {/* Journal — inline on desktop, a bottom sheet on the PWA/mobile (#615). */}
      {showLog && !isMobile && (
        <div className={`pb-3 pr-[1.1rem] ${childIndent}`}>
          <div className="bg-border-light/40 rounded-sm px-2.5 pt-1.5 pb-2">
            <RecipeJournal
              instanceId={instance.id}
              action={settingsButton}
              listClassName="max-h-[220px] overflow-y-auto"
            />
          </div>
        </div>
      )}
      <BottomSheet
        open={showLog && isMobile}
        onClose={() => setShowLog(false)}
        title={displayName}
        icon={<RecipeIconTile icon={recipe?.icon} enabled={instance.enabled} alarm={alarm} />}
      >
        {/* The sheet names the instance: its second line under the title (spec 198). */}
        {contextText && (
          <p className={`text-small -mt-1 mb-2 ${alarm ? "text-error" : "text-text-secondary"}`}>
            {contextText}
          </p>
        )}
        {showLog && isMobile && <RecipeJournal instanceId={instance.id} action={settingsButton} />}
      </BottomSheet>

      {/* Duplicate modal */}
      {showDuplicate && recipe && (
        <DuplicateRecipeModal
          instance={instance}
          recipe={recipe}
          sourceZoneId={zoneId}
          onClose={() => setShowDuplicate(false)}
        />
      )}

      {/* Settings — a dialog on a computer, a full-screen page on a phone (spec 198). */}
      {editing && recipe && (
        <RecipeSettings
          instance={instance}
          recipe={recipe}
          zoneId={zoneId}
          context={contextText}
          alarm={alarm}
          onClose={() => setEditing(false)}
          onDuplicate={() => setShowDuplicate(true)}
          onDelete={() => void handleDelete()}
          deleting={deleting}
        />
      )}
    </div>
  );
}
