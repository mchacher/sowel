# Spec 216: An integration says why it is not connected

- **Status**: In progress (core done, plugins being released)
- **Scope**: `IntegrationPlugin` (optional method), `GET /api/v1/integrations`, `IntegrationDrawer`, user docs (host setup); then the seven MQTT plugins
- **Related**: spec 111 (plugin method wrapping), spec 212 (integration drawer)

## Problem

Seen on 2026-11-25: a user set the Zigbee2MQTT broker URL to `mqtt://127.0.0.1:1883`. Inside the Sowel container that address is the container itself, so the plugin never connected. The panel showed "Disconnected" and nothing else. The reason (`ECONNREFUSED`) was only in the logs.

The usual fixes are known: `host.docker.internal` (which needs `extra_hosts` in the compose file, missing from installs made before it was added), or Mosquitto 2's `listener 1883 0.0.0.0`. Nothing on screen pointed to them.

## Goals

- A plugin can give one short sentence saying why it is not connected and what to check. The integration panel shows it under the status while the plugin is not connected.
- MQTT plugins fill the broker URL with `mqtt://host.docker.internal:1883` by default, and turn the common connection errors into that sentence.
- The host setup page explains which URL to give Sowel and how to fix a compose file without `extra_hosts`.

## Non-goals

- Translating plugin text. Plugin settings labels are English today; the reason is too.
- A shared MQTT library for plugins. Each plugin keeps its own connector.
- Diagnosing anything in core: the plugin knows its transport, core only relays.

## Functional rules

- **R1** `IntegrationPlugin.getStatusDetail?(): string | null` is optional. Plugins without it behave as before.
- **R2** Core wraps it like the other sync methods (spec 111): a throw is logged and read as `null`.
- **R3** `GET /api/v1/integrations` adds `statusDetail` when the plugin returns a non-empty string, trimmed and capped at 300 characters.
- **R4** The drawer shows the detail in a box under the status cards when the integration is enabled and not connected. It is hidden once connected and on a disabled plugin.
- **R4b** After Start, Restart, Enable or a save that restarts, the drawer reads the list again 3 s later: the plugin learns why it failed a moment after `start()` returns.
- **R5** MQTT plugins set `defaultValue: "mqtt://host.docker.internal:1883"` on `mqtt_url`. The drawer already prefills a default into an empty field; existing installs keep their saved value.
- **R6** MQTT plugins map errors to a sentence: name not resolved (with the `extra_hosts` hint for `host.docker.internal`), connection refused (with the localhost hint when the URL points at localhost, the listener hint otherwise), no answer, credentials rejected, anything else as the raw message. The detail clears on connect.

## Acceptance criteria

- [x] A plugin returning a reason while disconnected shows it in the drawer; connected or disabled, nothing shows.
- [x] A throwing `getStatusDetail` does not break the integrations list.
- [x] Host setup page (EN and FR) covers `host.docker.internal`, `extra_hosts` and the troubleshooting cases.
- [ ] Each MQTT plugin released with the default URL and the error mapping, registry bumped.
