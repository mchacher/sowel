import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

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
        className="bg-surface rounded-[14px] border border-border shadow-xl w-full max-w-[440px] mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h2 className="text-[16px] font-semibold text-text">{title}</h2>
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
            <label className="block text-[12px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
              {t("modes.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modes.form.namePlaceholder")}
              className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
              autoFocus
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
              {t("modes.description")}
              <span className="text-text-tertiary font-normal normal-case tracking-normal ml-1">({t("common.optional")})</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("modes.form.descriptionPlaceholder")}
              className="w-full px-3 py-2 text-[14px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
              maxLength={500}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-[13px] text-error">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t("common.saving") : initial ? t("common.save") : t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
