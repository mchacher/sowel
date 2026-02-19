import { useState } from "react";
import { Layers, Plus, Pencil, Trash2, X } from "lucide-react";
import type { EquipmentGroup } from "../../types";

interface GroupListProps {
  groups: EquipmentGroup[];
  onCreateGroup: (data: { name: string; description?: string }) => Promise<void>;
  onUpdateGroup: (id: string, data: { name?: string; description?: string | null }) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
}

export function GroupList({ groups, onCreateGroup, onUpdateGroup, onDeleteGroup }: GroupListProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-text">Equipment Groups</h3>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary-light rounded-[6px] transition-colors duration-150"
        >
          <Plus size={14} strokeWidth={1.5} />
          Add group
        </button>
      </div>

      {showForm && (
        <GroupInlineForm
          onSubmit={async (data) => {
            await onCreateGroup(data);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {groups.length === 0 && !showForm ? (
        <p className="text-[13px] text-text-tertiary py-4">
          No groups yet. Groups let you organize equipments within a zone (e.g., "Volets Sud", "Éclairage Ambiance").
        </p>
      ) : (
        <div className="space-y-1">
          {groups.map((group) => (
            <div key={group.id}>
              {editingId === group.id ? (
                <GroupInlineForm
                  initial={{ name: group.name, description: group.description }}
                  onSubmit={async (data) => {
                    await onUpdateGroup(group.id, data);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-[6px] bg-border-light/50 group">
                  <Layers size={16} strokeWidth={1.5} className="text-text-tertiary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-text">{group.name}</span>
                    {group.description && (
                      <span className="text-[12px] text-text-tertiary ml-2">{group.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingId(group.id)}
                      className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[4px] hover:bg-border-light"
                    >
                      <Pencil size={13} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => onDeleteGroup(group.id)}
                      className="p-1.5 text-text-tertiary hover:text-error rounded-[4px] hover:bg-error/10"
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupInlineForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; description?: string };
  onSubmit: (data: { name: string; description?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() || undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-2 bg-border-light/50 rounded-[6px] mb-1">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name..."
        className="flex-1 px-2 py-1 text-[13px] bg-surface border border-border rounded-[4px] outline-none focus:border-primary"
        autoFocus
        maxLength={100}
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description..."
        className="flex-1 px-2 py-1 text-[13px] bg-surface border border-border rounded-[4px] outline-none focus:border-primary"
        maxLength={500}
      />
      <button
        type="submit"
        disabled={!name.trim() || saving}
        className="px-3 py-1 text-[12px] font-medium text-white bg-primary rounded-[4px] hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? "..." : initial ? "Save" : "Add"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-1 text-text-tertiary hover:text-text-secondary"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </form>
  );
}
