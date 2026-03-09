import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useZones } from "../store/useZones";
import { useRecipes } from "../store/useRecipes";
import { getZone } from "../api";
import { ZoneForm, flattenZoneTree } from "../components/zones/ZoneForm";
import {
  ArrowLeft,
  Loader2,
  Map,
  Pencil,
  Trash2,
  ChevronRight,
  FolderOpen,
} from "lucide-react";
import type { ZoneWithChildren, RecipeActionDef, RecipeInstance, RecipeInfo } from "../types";
import { useWsSubscription } from "../hooks/useWsSubscription";
import { ROOT_ZONE_ID } from "../lib/constants";

// ── Mode pill colors ────────────────────────────────────

const MODE_COLORS: Record<string, { bg: string; text: string }> = {
  eco: { bg: "var(--color-success-light, #dcfce7)", text: "var(--color-success, #16a34a)" },
  comfort: { bg: "var(--color-primary-light)", text: "var(--color-primary)" },
  cocoon: { bg: "var(--color-accent-light)", text: "var(--color-accent)" },
  night: { bg: "#ede9fe", text: "#7c3aed" },
};

const DEFAULT_PILL_COLOR = { bg: "var(--color-border-light)", text: "var(--color-text-secondary)" };

// ── Recipe mode pill ────────────────────────────────────

function RecipeModePill({
  instance,
  recipe,
  action,
}: {
  instance: RecipeInstance;
  recipe: RecipeInfo;
  action: RecipeActionDef;
}) {
  const { t } = useTranslation();
  const sendAction = useRecipes((s) => s.sendAction);
  const [sending, setSending] = useState(false);

  const currentValue = instance.state?.[action.stateKey] as string | undefined;
  if (!currentValue) return null;

  // Filter options: hide cocoon/night if their temp is not configured
  const availableOptions = action.options.filter((opt) => {
    if (opt.value === "cocoon" && !instance.params.cocoonTemp) return false;
    if (opt.value === "night" && !instance.params.nightTemp) return false;
    return true;
  });

  if (availableOptions.length < 2) return null;

  const currentIndex = availableOptions.findIndex((o) => o.value === currentValue);
  const nextIndex = (currentIndex + 1) % availableOptions.length;
  const nextOption = availableOptions[nextIndex];
  const currentOption = availableOptions[currentIndex >= 0 ? currentIndex : 0];

  const colors = MODE_COLORS[currentValue] ?? DEFAULT_PILL_COLOR;

  // Resolve label with i18n
  const lang = t("lang", { defaultValue: "" });
  const i18nPack = lang && recipe.i18n?.[lang];
  const displayLabel = i18nPack
    ? t(`recipes.actions.${action.id}.${currentValue}`, { defaultValue: currentOption.label })
    : currentOption.label;

  const handleClick = async () => {
    if (sending || !instance.enabled) return;
    setSending(true);
    try {
      await sendAction(instance.id, action.id, { mode: nextOption.value });
    } catch {
      // ignore — state will be refreshed via WebSocket
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={sending || !instance.enabled}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default hover:brightness-95 active:scale-95"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      title={t("recipes.actions.cycleTo", { mode: nextOption.label, defaultValue: `Click to switch to ${nextOption.label}` })}
    >
      {displayLabel}
    </button>
  );
}

// ── Page component ──────────────────────────────────────

export function ZoneDetailPage() {
  useWsSubscription(["zones", "equipments", "recipes"]);
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tree = useZones((s) => s.tree);
  const updateZone = useZones((s) => s.updateZone);
  const deleteZone = useZones((s) => s.deleteZone);
  const recipes = useRecipes((s) => s.recipes);
  const instances = useRecipes((s) => s.instances);
  const fetchRecipes = useRecipes((s) => s.fetchRecipes);
  const fetchInstances = useRecipes((s) => s.fetchInstances);

  useEffect(() => {
    if (recipes.length === 0) fetchRecipes();
    if (instances.length === 0) fetchInstances();
  }, [recipes.length, instances.length, fetchRecipes, fetchInstances]);

  const [zone, setZone] = useState<ZoneWithChildren | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- loading state before async fetch
    setError(null);
    getZone(id)
      .then((data) => {
        if (!cancelled) {
          setZone(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load zone");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [id, tree]); // Re-fetch when tree updates (via WebSocket)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (error || !zone) {
    return (
      <div className="p-4 sm:p-6">
        <Link to="/zones" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text mb-4">
          <ArrowLeft size={14} strokeWidth={1.5} />
          {t("zones.backToZones")}
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
            <Map size={28} strokeWidth={1.5} className="text-error" />
          </div>
          <h3 className="text-[16px] font-medium text-text mb-1">{t("zones.notFound.title")}</h3>
          <p className="text-[13px] text-text-secondary">{error ?? t("zones.notFound.message")}</p>
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm(t("zones.deleteConfirm", { name: zone.name }))) return;
    setDeleting(true);
    try {
      await deleteZone(zone.id);
      navigate("/zones");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete zone");
      setDeleting(false);
    }
  };

  // Build breadcrumb
  const breadcrumb = buildBreadcrumb(zone.id, tree);

  return (
    <div className="p-4 sm:p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] text-text-secondary mb-4">
        <Link to="/zones" className="hover:text-text transition-colors">{t("zones.title")}</Link>
        {breadcrumb.map((item) => (
          <span key={item.id} className="flex items-center gap-1.5">
            <ChevronRight size={12} strokeWidth={1.5} className="text-text-tertiary" />
            {item.id === zone.id ? (
              <span className="text-text font-medium">{item.name}</span>
            ) : (
              <Link to={`/zones/${item.id}`} className="hover:text-text transition-colors">
                {item.name}
              </Link>
            )}
          </span>
        ))}
      </div>

      {/* Zone header */}
      <div className="flex items-start justify-between mb-4 sm:mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[18px] sm:text-[24px] font-semibold text-text leading-[24px] sm:leading-[32px]">
              {zone.name}
            </h1>
            {/* Recipe mode pills */}
            {instances
              .filter((inst) => inst.params.zone === zone.id && inst.enabled)
              .map((inst) => {
                const recipe = recipes.find((r) => r.id === inst.recipeId);
                if (!recipe?.actions) return null;
                return recipe.actions
                  .filter((a) => a.type === "cycle")
                  .map((action) => (
                    <RecipeModePill
                      key={`${inst.id}-${action.id}`}
                      instance={inst}
                      recipe={recipe}
                      action={action}
                    />
                  ));
              })}
          </div>
          {zone.description && (
            <p className="text-[14px] text-text-secondary mt-1">{zone.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEditForm(true)}
            className="p-2 sm:px-3 sm:py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
            title={t("common.edit")}
          >
            <Pencil size={14} strokeWidth={1.5} />
            <span className="hidden sm:inline ml-2">{t("common.edit")}</span>
          </button>
          {zone.id !== ROOT_ZONE_ID && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-2 sm:px-3 sm:py-2 text-[13px] font-medium text-error border border-error/30 rounded-[6px] hover:bg-error/10 transition-colors duration-150 disabled:opacity-50"
              title={t("common.delete")}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              <span className="hidden sm:inline ml-2">{deleting ? t("common.deleting") : t("common.delete")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Child zones section */}
      {zone.children.length > 0 && (
        <div className="mb-8">
          <h3 className="text-[14px] font-semibold text-text mb-3">{t("zones.childZones")}</h3>
          <div className="bg-surface rounded-[10px] border border-border overflow-hidden divide-y divide-border-light">
            {zone.children.map((child) => (
              <Link
                key={child.id}
                to={`/zones/${child.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-primary-light/40 transition-colors duration-150"
              >
                <FolderOpen size={18} strokeWidth={1.5} className="text-text-secondary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-medium text-text">{child.name}</span>
                  {child.description && (
                    <span className="text-[12px] text-text-tertiary ml-2">{child.description}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {child.children.length > 0 && (
                    <span className="text-[11px] text-text-tertiary bg-border-light px-2 py-0.5 rounded-full">
                      {t("zones.childCount", { count: child.children.length })}
                    </span>
                  )}
                </div>
                <ChevronRight size={16} strokeWidth={1.5} className="text-text-tertiary" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Edit zone modal */}
      {showEditForm && (
        <ZoneForm
          title={t("zones.editZone")}
          initial={{ name: zone.name, description: zone.description }}
          parentZones={flattenZoneTree(tree, 0, zone.id)}
          defaultParentId={zone.parentId}
          onSubmit={async (data) => {
            await updateZone(zone.id, data);
          }}
          onClose={() => setShowEditForm(false)}
        />
      )}
    </div>
  );
}

function buildBreadcrumb(
  zoneId: string,
  tree: ZoneWithChildren[]
): { id: string; name: string }[] {
  const path: { id: string; name: string }[] = [];

  function find(zones: ZoneWithChildren[], trail: { id: string; name: string }[]): boolean {
    for (const zone of zones) {
      const current = [...trail, { id: zone.id, name: zone.name }];
      if (zone.id === zoneId) {
        path.push(...current);
        return true;
      }
      if (find(zone.children, current)) return true;
    }
    return false;
  }

  find(tree, []);
  return path;
}
