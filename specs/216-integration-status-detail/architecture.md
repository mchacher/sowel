# Spec 216: Architecture

- `src/integrations/integration-registry.ts`: `getStatusDetail?()` on `IntegrationPlugin`; `normalizeStatusDetail()` trims and caps; `getAllInfo()` adds `statusDetail` only when there is one.
- `src/plugins/scoped-deps.ts`: `wrapPluginMethods` wraps `getStatusDetail` with `wrapSync(..., null)`.
- `src/api/routes/integrations.ts`: passes `statusDetail` from the loaded plugin.
- `src/shared/types.ts`, `ui/src/types.ts`: `IntegrationInfo.statusDetail?: string`.
- `ui/src/components/integrations/IntegrationDrawer.tsx`: a `role="status"` box under the status cards, and a second `onRefresh` 3 s after a start.
- Plugins: the MQTT connector records the last error as a sentence (`describeMqttError`), clears it on `connect`, and the plugin returns it from `getStatusDetail()`. The minimum Sowel version is unchanged: an older core never calls the method.
