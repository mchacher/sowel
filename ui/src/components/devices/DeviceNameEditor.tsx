import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

interface DeviceNameEditorProps {
  name: string;
  onSave: (name: string) => Promise<void>;
}

export function DeviceNameEditor({ name, onSave }: DeviceNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    setValue(name);
  }, [name]);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setValue(name);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setValue(name);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setValue(name);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleCancel();
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <h1 className="text-[24px] font-semibold text-text leading-[32px]">
          {name}
        </h1>
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 rounded-[6px] text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-secondary hover:bg-border-light transition-all duration-150 ease-out"
          title="Edit name"
        >
          <Pencil size={14} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="text-[24px] font-semibold text-text leading-[32px] bg-transparent border-b-2 border-primary outline-none px-0 py-0 w-auto min-w-[200px]"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="p-1.5 rounded-[6px] text-success hover:bg-success/10 transition-colors duration-150 ease-out disabled:opacity-50"
          title="Save"
        >
          <Check size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          className="p-1.5 rounded-[6px] text-text-tertiary hover:text-error hover:bg-error/10 transition-colors duration-150 ease-out disabled:opacity-50"
          title="Cancel"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
      {error && (
        <span className="text-[12px] text-error">{error}</span>
      )}
    </div>
  );
}
