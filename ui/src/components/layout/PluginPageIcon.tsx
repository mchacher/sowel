import * as LucideIcons from "lucide-react";

/** Spec 180 — a plugin names its icon; one Lucide does not know is drawn as a puzzle piece. */
export function PluginPageIcon({ name, size }: { name: string; size: number }) {
  const Icon =
    (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[name] ?? LucideIcons.Puzzle;
  return <Icon size={size} strokeWidth={1.5} />;
}
