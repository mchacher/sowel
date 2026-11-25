# Spec 216: Plan

## Tasks

- [x] Core: optional method, wrapping, API field, drawer box
- [x] Docs: host setup (EN/FR), plugin development, API reference
- [ ] Plugins: zigbee2mqtt, lora2mqtt, tasmota, shelly-mqtt, somfy-rts, displays, apsystems (default URL, error mapping, release, registry bump)

## Test plan

| Module              | Scenario                      | Expected                              |
| ------------------- | ----------------------------- | ------------------------------------- |
| IntegrationRegistry | plugin returns " No broker "  | `statusDetail: "No broker"`           |
| IntegrationRegistry | no method, null, blank        | no `statusDetail` key                 |
| IntegrationRegistry | 1000-character reason         | capped at 300, ends with "…"          |
| wrapPluginMethods   | `getStatusDetail` throws      | `null`                                |
| IntegrationDrawer   | disconnected with a reason    | reason shown in a status box          |
| IntegrationDrawer   | connected, or disabled        | reason hidden                         |
| plugin connector    | ENOTFOUND, ECONNREFUSED, auth | matching sentence; cleared on connect |
