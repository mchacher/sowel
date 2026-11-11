import { createElement } from "react";
import type { LucideProps } from "lucide-react";
import { pluginIcon } from "../../lib/plugin-icons";

/**
 * A plugin's manifest icon, resolved through the closed set of
 * lib/plugin-icons (#1187); `Cpu` when the name is unknown or missing.
 */
export function PluginIcon({ name, ...props }: { name: string | undefined } & LucideProps) {
  return createElement(pluginIcon(name), props);
}
