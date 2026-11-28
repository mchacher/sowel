import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { FIELD_LABEL } from "../ui/text-roles";
import { modeGroupNames } from "../../lib/mode-groups";
import type { Mode } from "../../types";

export interface ModeFormData {
  name: string;
  description?: string;
  icon?: string;
  /** Spec 219 — `null` takes the mode out of its group. */
  group: string | null;
}

interface ModeFormProps {
  initial?: { name: string; description?: string; icon?: string; group?: string };
  onSubmit: (data: ModeFormData) => Promise<void>;
  onClose: () => void;
  title: string;
  /** Every mode, for the list of groups and the conflict warning (spec 219). */
  modes: Mode[];
  /** The mode being edited, absent on creation. */
  editing?: Mode;
}

const NEW_GROUP = "__new__";
const INPUT =
  "w-full px-3 py-2 text-body border border-border bg-surface rounded-sm outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150";

export function ModeForm({ initial, onSubmit, onClose, title, modes, editing }: ModeFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // The mode's own group is always offered, even before the store is loaded.
  const groups = [
    ...new Set([...modeGroupNames(modes), ...(initial?.group ? [initial.group] : [])]),
  ].sort((a, b) => a.localeCompare(b));
  const [groupChoice, setGroupChoice] = useState(initial?.group ?? "");
  const [newGroup, setNewGroup] = useState("");
  const chosenGroup = (groupChoice === NEW_GROUP ? newGroup : groupChoice).trim();
  // « + New group… » with no name yet: saving would silently take the mode out of its group.
  const newGroupMissing = groupChoice === NEW_GROUP && chosenGroup === "";
  // Spec 219 — an active mode joining a group that already has an active mode:
  // only the most recently activated stays on.
  const conflict =
    editing?.active === true &&
    chosenGroup !== "" &&
    chosenGroup !== (editing.group ?? "") &&
    modes.some((m) => m.id !== editing.id && m.active && m.group === chosenGroup);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || newGroupMissing) return;

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        group: chosenGroup || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg w-full max-w-[440px] mx-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h2 className="text-lead font-semibold text-text">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className={FIELD_LABEL}>{t("modes.name")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modes.form.namePlaceholder")}
              className={INPUT}
              autoFocus
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div>
            <label className={FIELD_LABEL}>
              {t("modes.description")}
              <span className="text-text-tertiary font-normal ml-1">({t("common.optional")})</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("modes.form.descriptionPlaceholder")}
              className={INPUT}
              maxLength={500}
            />
          </div>

          {/* Group (spec 219) */}
          <div>
            <label htmlFor="mode-form-group" className={FIELD_LABEL}>
              {t("modes.group")}
            </label>
            <select
              id="mode-form-group"
              value={groupChoice}
              onChange={(e) => setGroupChoice(e.target.value)}
              className={INPUT}
            >
              <option value="">{t("modes.groupNone")}</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={NEW_GROUP}>{t("modes.groupNew")}</option>
            </select>
            {groupChoice === NEW_GROUP && (
              <input
                type="text"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder={t("modes.groupNewPlaceholder")}
                aria-label={t("modes.groupNewPlaceholder")}
                className={`${INPUT} mt-2`}
                autoFocus
                maxLength={50}
              />
            )}
            <p className="text-caption text-text-tertiary mt-1">{t("modes.groupHelp")}</p>
            {conflict && (
              <p className="text-caption text-warning-ink mt-1">
                {t("modes.groupConflict", { group: chosenGroup })}
              </p>
            )}
          </div>

          {/* Error */}
          {error && <p className="text-small text-error">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-small font-medium text-text-secondary hover:text-text border border-border rounded-sm hover:bg-border-light transition-colors duration-150"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || newGroupMissing || saving}
              className="px-4 py-2 text-small font-medium text-white bg-primary-fill rounded-sm hover:bg-primary-fill-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t("common.saving") : initial ? t("common.save") : t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
