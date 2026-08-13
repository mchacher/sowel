import { useTranslation } from "react-i18next";
import type { NotificationChannelSpec } from "./notification-channels";

// The field renderer for the generic notification-channel descriptors (issue
// #457 step 2). Kept in its own .tsx so notification-channels.ts stays a pure
// logic/registry module. Renders the selected channel's config fields (or its
// hint) from the descriptor.
export function ChannelConfigFields({
  spec,
  values,
  onChange,
}: {
  spec: NotificationChannelSpec;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  if (spec.fields.length === 0) {
    return spec.hintKey ? (
      <p className="text-[11px] text-text-tertiary">{t(spec.hintKey)}</p>
    ) : null;
  }
  return (
    <>
      {spec.fields.map((field) => (
        <div key={field.key}>
          <label className="block text-[12px] text-text-secondary mb-1">{t(field.labelKey)}</label>
          <input
            type={field.inputType}
            value={values[field.key] ?? ""}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className={`w-full px-3 py-1.5 text-[13px] bg-bg border border-border rounded-[6px] text-text placeholder:text-text-tertiary${
              field.mono ? " font-mono" : ""
            }`}
          />
        </div>
      ))}
    </>
  );
}
