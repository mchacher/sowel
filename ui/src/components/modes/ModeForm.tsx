import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { FIELD_LABEL } from "../ui/text-roles";

interface ModeFormProps {
  initial?: { name: string; description?: string; icon?: string };
  onSubmit: (data: { name: string; description?: string; icon?: string }) => Promise<void>;
  onClose: () => void;
  title: string;
}

export function ModeForm({ initial, onSubmit, onClose, title }: ModeFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
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
            <label className={FIELD_LABEL}>
              {t("modes.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modes.form.namePlaceholder")}
              className="w-full px-3 py-2 text-body border border-border bg-surface rounded-sm outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
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
              className="w-full px-3 py-2 text-body border border-border bg-surface rounded-sm outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
              maxLength={500}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-small text-error">{error}</p>
          )}

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
              disabled={!name.trim() || saving}
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
