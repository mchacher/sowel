# Release notes

Sowel has been versioned and shipped through CI/CD since `v1.0.0` (April 2026, spec 055). Every release is published as:

- A signed GitHub release with a generated changelog — [github.com/mchacher/sowel/releases](https://github.com/mchacher/sowel/releases)
- A multi-arch Docker image tagged `ghcr.io/mchacher/sowel:<version>` and `:latest`

This page summarises every published version, newest first. For the full diff between two versions use `https://github.com/mchacher/sowel/compare/v<a>...v<b>`.

**Updating a running instance.** Sowel polls GitHub every hour and surfaces the available update in the topbar. Click the pill to open the updates sheet and apply the new version in one click (added in v1.9.0). On the command line: `cd /opt/sowel && docker compose pull && docker compose up -d`.

---

## 1.37.x: Recipe tariff helper

### v1.37.1 — 2026-08-10 { #v1-37-1 }

- Fix (ui): **recipe equipment and zone pickers now spell out the zone**, so homonymous rooms and sensors can be told apart (spec 139). An installation with a bathroom per floor used to list "Salle de bain" several times with nothing to choose between, and equipment lists showed the bare name (integrations name every sensor "Température"). Each option now carries the shortest ancestor path that makes it unique, and the same helper tidies up the Analyse view labels. Contributed by Adrien Jouve (computingify). (#386)
- Fix (ui): the **Energy tariff page no longer shows its default hours as if they were saved** (#384). On an instance that never saved a tariff, the standard 06:00-22:00 HP / 22:00-06:00 HC schedule looked configured while it was not, so energy cost attribution and load-shifting recipes appeared broken. The form still lands on those hours for convenience, but a banner now marks them as a suggestion until you click Save. Reported by Adrien Jouve (computingify). (#388)

### v1.37.0 — 2026-08-09 { #v1-37-0 }

- Feat (recipes): **recipes can read the configured HP/HC tariff schedule** (spec 138). A load-shifting recipe (water heater, pool pump, EV charger) no longer has to re-ask for off-peak hours the instance already knows: `ctx.helpers.getTariff()` returns today's off-peak slots and whether the current time is off-peak, straight from the schedule configured under Settings. Read-only by construction, and tariff **prices are deliberately not exposed** to recipe packages — knowing when energy is cheap is enough to schedule a load. Recipes should keep their own time slots as a fallback for instances with no tariff configured. Contributed by Adrien Jouve (computingify). (#379)
- Fix (api): reading the tariff configuration over the API (`GET /api/v1/settings/energy/tariff`) now requires the **admin role**, like the rest of the settings. Any authenticated user could previously read the schedule and the prices; writing was already admin-only, and recipes are unaffected since they read through the new helper. Found during review of #379. (#382)
- Docs: specs index catch-up (specs 137/138) and French translation of the new recipe tariff documentation. (#380)

---

## 1.36.x: Plugin categories, search, energy live metering

### v1.36.0 — 2026-08-09 { #v1-36-0 }

- Feat (plugins): the Plugins page now **groups recipes by category** (spec 137) — Lighting, Heating and cooling, Watering and pool, Scheduling, Safety and monitoring, Energy and display — in both the Installed and Store tabs, with a **search field** that filters integrations and recipes as you type, matching names, descriptions and keywords in the displayed language and ignoring accents. The Store tab also finally displays the French names and descriptions already authored in the catalog (they were silently dropped before). Categories come from the plugin catalog: existing installations pick them up automatically, no recipe update needed. (#375)
- Feat (equipments): **live electrical data on energy meters** — the zone-view card of every meter type (consumption, main, production) now shows the live instantaneous power next to the daily consumption, whether the meter reports a direct power reading or a Legrand NLPC 5-minute demand. The equipment detail page gains an **Electrical metering** panel with live power, voltage, current and power factor tiles, each shown when the corresponding data is bound; the "Energy consumption" cumuls panel is unchanged. (#377)
- Feat (ui): the mobile **"More" drawer** now exposes the full Administration navigation (Devices, Equipments, Zones, Plugins, Logs, Backup, ...) from a single source of truth shared with the desktop sidebar, including the plugin-update badge. Non-admin users get the consultation pages (Equipments, Zones) in the main section. Previously only Settings, Analyse and four admin entries were reachable on mobile. (#374)
- Docs: new **Plugins user guide** page on docs.sowel.org — the two tabs, finding a plugin, trust levels, personal sources, and the fingerprint confirmation flow. (#371)
- Chore (core): installation-specific operations context moved out of the public repository into a private companion repo; new agent skill for personal recipe development; specs index updated. (#368, #370, #372)

---

## 1.35.x: Personal plugin sources

### v1.35.0 — 2026-08-08 { #v1-35-0 }

- Feat (plugins): **personal plugin sources** (spec 136). Add your own public GitHub repositories as plugin sources and install your own integrations and recipes without going through the central registry, neither for the first publication nor for version bumps. A third trust tier appears next to official and community: personal entries carry a blue **Personal** badge, and trust follows a trust-on-first-use model. Sowel downloads the release tarball, shows its version and SHA256 fingerprint in a confirmation dialog, then pins the hash; any later content change (updates included) asks again with the new fingerprint, and backup restores verify re-downloads against the pinned hash. The registry install path is unchanged, and personal packages get extra guards: the manifest repository must match the source, and a plugin id cannot shadow a registry entry. Everything is managed from the new "Personal sources" section of the Plugins page. (#367)
- Chore (registry): **Zigbee2MQTT plugin 2.3.1**: per-device availability topics are now ignored when Z2M's availability feature is disabled, so stale retained availability messages left on the broker no longer mark working devices offline at every boot or reconnect. (#365)
- Chore (registry): **Schedule On/Off recipe 2.0.1**: water heater equipments (introduced in v1.34.0) can now be picked in the recipe's equipment slot. (#366)

---

## 1.34.x: Water heater equipment

### v1.34.0 — 2026-08-08 { #v1-34-0 }

- Feat (equipments): new **water heater** equipment type (spec 135). ON/OFF control through the standard on/off relay channel (Zigbee relays such as the Tuya WHD02 work out of the box), an optional **water temperature** display bound under its own alias so it never skews the zone's room-temperature average, and automatic power/energy display when the relay meters consumption (like metering switches). Creating one from a relay device binds everything automatically, and a custom state-aware icon shows when it is heating. Full desktop and mobile dashboard support. (#359)
- Fix (equipments): boolean on/off commands sent to Zigbee relays through the REST API or by automations were **silently ignored**: the call returned success, but Zigbee2MQTT dropped the payload because binary switches expect their declared wire form (`"ON"`/`"OFF"`), not a JSON boolean. Integrations can now declare the wire representation of a boolean order at discovery time, and Sowel translates the value at dispatch: `true` becomes `"ON"`, or `"LOCK"`, or whatever the device declares. Pairs with the Zigbee2MQTT plugin v2.3.0, which declares those values; orders that do not declare them are dispatched exactly as before. (#360, #362)
- Fix (equipments): relay modules exposing on/off as a boolean order (Tuya WHD02 and similar) could not be associated with a **light or pool pump** equipment: the binding candidate rule only accepted ON/OFF enums for those types, although the same relay bound fine as a switch. Both now accept boolean on/off orders, aligned with the switch rule. (#358)
- Chore (registry): **Netatmo camera** community plugin 1.0.0 added (Netatmo Presence: snapshot, live view, monitoring toggle, spot light, motion detections), binding into the camera equipment type introduced in v1.31.0. By Romain (alpitux). (#356)
- Chore (registry): **Zigbee2MQTT plugin 2.3.0**: the Tuya PJ-1203A bidirectional dual-channel energy meter now lands as one device per channel feeding the energy pipeline (signed energy deltas, same shape as the Shelly Pro 3EM), contributed by Adrien Jouve (computingify); plus the Tuya relay binding fix and the binary wire-value declarations used by the order fix above. (#357, #363)

---

## 1.33.x: Reliability fixes

### v1.33.0 — 2026-08-07 { #v1-33-0 }

- Fix (equipments): battery-powered remotes and wireless buttons are no longer shown as **"Disconnected"** just because they have been silent. These devices only transmit when pressed, so silence is normal — the red badge was a false alarm (and it trained users to ignore red badges, hiding real disconnections). They now stay online; genuine low battery still shows through the battery signal. Applies to every integration (Zigbee, LoRa, ...). (#348)
- Fix (recipes): updating a recipe from the store now restarts its running automations immediately. Before, the new version was loaded and shown in the form, but running instances kept executing the previous version's logic until manually toggled off and on — a silent trap. (#349)
- Fix (plugins): the **Refresh** button on the Plugins page now shows a just-published catalog change within seconds instead of waiting several minutes. It was hitting a cached copy that the refresh could not bypass; it now reads the up-to-date source directly. (#353)

---

## 1.32.x: Weather daily min/max

### v1.32.0 — 2026-08-05 { #v1-32-0 }

- Feat (equipments): weather station equipments now show **today's measured minimum and maximum temperature** in small under each temperature reading — on the desktop dashboard widget, the mobile dashboard widget, and the equipment detail page (outdoor and indoor modules). Sowel tracks the envelope itself from the temperature samples it already receives, so it works with any station that reports a temperature, without configuration and regardless of vendor. The envelope resets at local midnight and survives restarts. Note for the first day after updating: the min/max starts counting from the update, so it becomes fully accurate the next day. (#344)

---

## 1.31.x: Camera equipment

### v1.31.1 — 2026-08-05 { #v1-31-1 }

- Fix (notifications): a notification mapped to an on/off source (typically a recipe alarm) fired its message on both transitions, so a fixed text like "washing machine done" was also sent the moment the alarm cleared — for a state-watch on the idle state, that is exactly when the machine starts a cycle. Such notifications now fire only when the source activates; notifications mapped to state texts (e.g. a mode name) or numeric values are unchanged. (#342)

### v1.31.0 — 2026-08-05 { #v1-31-0 }

- Feat (equipments): new vendor-agnostic **camera** equipment type (spec 133). A camera equipment shows a periodically refreshed snapshot (equipment detail page and dashboard widget) and an on-demand live view (HLS), plus optional monitoring on/off, light mode and siren controls when the integration exposes them. Media is proxied through the Sowel backend, so the browser never talks to the camera or vendor relay directly and the camera's real URL is never exposed. Each feature is enabled by simply binding its data/order category, enforced server-side. No camera integration ships in core: vendor plugins provide the devices (a Netatmo camera community plugin is on its way). Known limitation: live view is not yet available on iOS Safari (snapshots work everywhere). Contributed by Romain (alpitux). (#339)
- Fix (ui): the service worker rule that keeps API calls network-only never actually matched, because the pattern was tested against the full URL instead of the path. No known user-facing impact, fixed for correctness. (#339)
- Chore (plugins): the legacy Netatmo Security plugin (monitoring on/off only) is removed from the plugin store, superseded by the camera equipment type and the upcoming Netatmo camera plugin. Instances that already installed it keep running it; it is simply no longer listed or updated. (#340)

---

## 1.30.x: Three-phase metering

### v1.30.0 — 2026-07-31 { #v1-30-0 }

- Feat (energy): the Energy → Live page can now show a per-phase power breakdown for three-phase installations. A main energy meter equipment may carry `power_l1` / `power_l2` / `power_l3` data bindings (a convention any integration exposing per-phase power can adopt), and when at least two phases are bound, a "Phase breakdown" panel renders one bar per phase under the live flow diagram, making an unbalanced phase visible at a glance. Single-phase installations are unaffected: without those bindings the panel does not exist. Pairs with the Legrand Energy plugin v2.1.0, which now discovers Legrand Drivia with Netatmo three-phase meters (NLY modules, ref. 412175) as a "Total" device plus one device per phase. Contributed by Romain (alpitux). (#336, legrand-energy #1)

---

## 1.29.x: Standard role and dashboard parity

### v1.29.4 — 2026-07-26 { #v1-29-4 }

- Fix (ui): the rain barchart tooltip showed the wrong bar on the 7-day view. A 7-day window renders 8 daily bars, so the weekday used as the chart key repeated and hovering one bar could show another day's value (e.g. hovering today's ~1 mm bar showed "Sunday 19 / 0 mm"). Bars are now keyed on their timestamp. (#334)
- Fix (history): rain totals collapsed to ~0 mm on the 30-day view. Rain is a cumulative total but the daily history stored only the average (about the total divided by 24). Daily rain is now summed from the hourly data, so the 30-day view shows real totals, matching the 24h and 7-day views (which were already correct). (#334)

### v1.29.3 — 2026-07-21 { #v1-29-3 }

- Fix (ui): the bulk "Stop all shutters" / "Stop all awnings" commands (zone toolbar, whole house, dashboard zone widget and its detail sheet, and the physical button-action picker) are now hidden when any shutter in scope cannot actually stop mid-travel (e.g. Bubendorff via iDiamant). This extends the single-shutter fix from v1.29.2 to grouped commands, which act on the whole zone subtree. Groups where every shutter supports Stop are unaffected. (#332)

### v1.29.2 — 2026-07-20 { #v1-29-2 }

- Fix (ui): the shutter Stop button is now hidden when the bridge cannot actually stop the motor mid-travel. Some bridges (confirmed on Bubendorff shutters via an iDiamant with Netatmo bridge) only pause briefly before continuing to the original target, so a Stop button there was misleading. An integration signals this by omitting "STOP" from the move order; every shutter that keeps a real Stop is unaffected. (#327)
- Fix (equipments): shutter auto-binding now works for integrations that do not use Tasmota-style key names. Adding a shutter whose device exposes current_position / target_position / state (e.g. Legrand / Bubendorff Home+Control) produced an equipment with no bindings, shown as offline; a category-based fallback now binds it correctly. (#327)

### v1.29.1 — 2026-07-19 { #v1-29-1 }

- Fix (auth): follow-up to the v1.29.0 Standard role. A Standard user could still see config controls that the server rejects with a 403 (Edit / Delete on an equipment, the equipment Configuration panel, mode activation, chart save / delete, the update pill). These are now hidden, and the config-only pages (devices, calendar, integrations, plugins, MQTT / notification publishers, logs, backup) redirect a Standard user to the dashboard. Actuation (lights, gates, shutters, zone commands) and personal settings (profile, password, API tokens) are unchanged. (#319)

### v1.29.0 — 2026-07-19 { #v1-29-0 }

- Feat (auth): the **Standard** role is now scoped to viewing and operating. A Standard user can browse the dashboard and zones, see equipment states, and actuate equipments (open a gate or a door, toggle a light), but can no longer create, rename or delete equipments, recipes, zones or modes, nor change any configuration. All configuration is now admin-only, hidden in the UI and enforced server-side (a blocked action returns 403, so it cannot be worked around). This answers the surprise that a Standard account could alter equipments and recipes by accident. No migration needed: existing Standard accounts simply lose the config actions they should not have had. (#319)
- Fix (ui): a custom widget icon is now shown identically on a PC browser and on mobile. The desktop dashboard ignored the custom icon for most widget types (a pool-pump icon chosen for a plug showed on Android but reverted to the plug icon on desktop); it now honors the chosen icon for lights, switches, shutters, awnings, thermostats, heaters, water valves and pool equipment, matching mobile. (#318)

---

## 1.28.x: Watering weekdays

### v1.28.2 — 2026-07-18 { #v1-28-2 }

- Fix (ui): on the mobile dashboard, a contact sensor (door/window) modelled as a **Capteur** now shows "Ouvert / Fermé" instead of a bare "Oui / Non". The mobile widget card was formatting boolean sensor values generically; it now uses the same category-aware labels as the desktop card and the zone view (also fixes motion / water-leak / smoke labels on mobile). Note: a motorised door/gate is best modelled as an **Ouvrant**, which already derives open/closed from a contact and displays correctly everywhere. (#316)

### v1.28.1 — 2026-07-18 { #v1-28-1 }

- Fix (weather): rain totals could balloon to absurd values (e.g. 1392 mm over 24h from an actual 11.9 mm), which permanently blocked the Auto Watering rain-skip and plotted a flat "11.9 mm every hour" on rain charts. Netatmo's rolling 1h / 24h totals (`sum_rain_1` / `sum_rain_24`) were summed at every poll. Sowel now reads them as the totals they already are, and no longer stores them as time series. Live weather values are unchanged; existing rain charts self-correct within ~24h. (#312)

### v1.28.0 — 2026-07-17 { #v1-28-0 }

- Feat (recipes): recipe forms now support multi-select option fields, shown as toggle chips instead of a single dropdown. This powers a new per-slot **day of week** selector in the Auto Watering recipe (update the recipe to v1.2.0): each watering slot can be limited to chosen weekdays, and leaving it empty keeps watering every day. Example: water at 07:30 on school days and at 09:00 on Wednesday and the weekend. Existing watering schedules are unchanged. (#310, auto-watering #2)

---

## 1.27.x: Metering-aware switch

### v1.27.1 — 2026-07-10 { #v1-27-1 }

- Fix (equipments): creating a Switch / Plug on a metering device (e.g. SONOFF S60ZBTPF) now binds its power/energy, not just the on/off channel. v1.27.0 shipped the display side but the binding step missed the metering data. Note: plugs bound before this fix keep their on/off-only binding; re-create or re-bind them to pick up power/energy. (#302)

### v1.27.0 — 2026-07-10 { #v1-27-0 }

- Feat (equipments): a Switch / Plug now surfaces power and energy when the device reports them. A metering smart plug (e.g. SONOFF S60ZBTPF over Zigbee2MQTT) modelled as a Switch shows its live power next to the on/off toggle, feeds the energy dashboard (history and HP/HC), and appears in the live submeter breakdown, while keeping its ON/OFF control. A basic relay with no metering behaves exactly as before. (#300)

---

## 1.26.x: Notification re-notify

### v1.26.0 — 2026-07-07 { #v1-26-0 }

- Feat (notifications): notification mappings gain an explicit re-notify option. While a mapped value stays "active" (e.g. a State Watch alarm), the notification is re-sent on a fixed cadence and stops silently once it clears. Pick "None", "Indefinitely" or "Limited to N reminders" per mapping — distinct from the anti-spam throttle. (#294)

---

## 1.25.x: Notification mapping editor

### v1.25.0 — 2026-07-01 { #v1-25-0 }

- Fix (ui): the notification mapping editor restores the zone filter when you re-edit a mapping. A recipe or equipment picked in a specific zone (e.g. a State Watch in the cave) no longer shows "all zones" with an unfiltered source list. (#291)
- Feat (ui): the recipe source dropdown now shows the equipment(s) each recipe instance applies to, e.g. "State Watch (Machine à laver)", so several instances of the same recipe are distinguishable. (#291)

---

## 1.24.x: Web Push notifications

### v1.24.3 — 2026-06-29 { #v1-24-3 }

- Fix (notifications): Web Push notifications are split into a title (the message) and a body (the value). A longer notification such as "Garage door open since" followed by a timestamp now reads on two lines instead of being truncated onto one. Telegram keeps its single-line format. Note: the "from Sowel" line on the notification is added by the browser/phone itself (it always shows which app sent the push) and cannot be removed.

### v1.24.2 — 2026-06-29 { #v1-24-2 }

- Fix (notifications): the "Test channel" button now delivers a real notification for the Web Push channel. It previously only validated the VAPID keys without sending anything, so it looked like nothing happened. It also returns a clear error when no device has enabled push yet. (#288)
- Fix (notifications): Web Push notifications no longer show a redundant "Sowel" title. The installed app (and the browser) already labels the notification with the Sowel name, so the message itself is now the notification heading. (#288)
- Fix (ui): the Administration > Notifications page is now readable on mobile. The publisher actions move onto their own row, the channel (Telegram or Web Push) is labelled correctly instead of always showing "Telegram", and mapping rows wrap cleanly. (#288)

### v1.24.1 — 2026-06-29 { #v1-24-1 }

- Fix (core): Web Push now works on iOS and Safari. Apple's push gateway rejected every notification (HTTP 403) because the default VAPID subject used a `.local` domain, which Apple refuses (Chrome and Android were unaffected). The default is now a valid contact, and existing instances self-heal the stored value on update without regenerating keys, so previously registered devices keep working. (#287)

### v1.24.0 — 2026-06-29 { #v1-24-0 }

Web Push as a notification channel for the installed PWA, plus two mobile layout fixes:

- Feat (core): new **Web Push** notification channel alongside Telegram. The installed PWA (over HTTPS) can receive native push notifications. VAPID keys are generated and stored on first boot, subscriptions are per user, and expired endpoints are pruned automatically. Configure it from Settings > Notifications: enable push on a device, then map a "Web Push" publisher to any equipment, zone or recipe value. (#284)
- Fix (ui): on mobile, the current time and sunrise/sunset are now shown in the top bar (they were desktop-only). (#285)
- Fix (ui): on mobile, the Wh / € toggle on Energy > Consumption is now reachable; it no longer overflows off-screen next to the period selector. (#285)

---

## 1.23.x: Sun-aware recipe building blocks

### v1.23.0 — 2026-06-24 { #v1-23-0 }

Recipe form building blocks for sun-aware scheduling (spec 126):

- Feat (recipes): new `select` recipe slot type, rendered as a dropdown with per-language option labels. A recipe can now offer a small closed list of named choices.
- Feat (recipes): new `ctx.helpers.getSunlight()` exposing the current sunrise, sunset and daylight flag to recipes (from the existing sunlight manager, offsets applied), so a recipe can schedule on sun times. Pairs with the `sunlight.changed` event to re-sync across days.
- Feat (recipes): new `hiddenWhen` slot rule, so a recipe form shows only the relevant field (e.g. a fixed-time picker for "fixed time", a minute offset for "sunrise/sunset"); the irrelevant field is removed from the layout, keeping the form aligned.
- Feat (ui): `number` recipe slots render as numeric inputs (with min/max), so values like a positive or negative minute offset can be entered cleanly; recipe slot grids use equal-width columns.

These ship for the new **Schedule On/Off** recipe (fixed time / sunrise / sunset windows), available from the plugin store.

---

## 1.22.x: Smart plug controls and Zigbee on/off binding

### v1.22.0 — 2026-06-23 { #v1-22-0 }

Zigbee on/off equipment binding fixes and smart plug controls:

- Fix (equipments): Zigbee2MQTT plugs and relays (Lidl, Legrand, ...) are now proposed when binding a `switch` (smart plug) equipment. Their on/off command is a boolean `light_toggle` order, which the binding matcher previously only recognised as an enum ON/OFF, so only Tasmota devices appeared. (#276)
- Feat (ui): `switch` (smart plug) equipments now have on/off controls everywhere (compact card, equipment card, detail page) plus a dedicated dashboard widget with a wall-socket picto and ON/OFF toggle, instead of a read-only badge. (#277)
- Fix (equipments): Zigbee water valves (e.g. SONOFF SWV) are now proposed when binding a `water_valve` equipment, and bind their full surface (state, flow, battery, irrigation) instead of being dropped. (#278)

New recipe in the store: **Schedule On/Off** ("Programmation horaire"), up to 3 daily ON/OFF windows for any on/off equipment.

---

## 1.21.x — Solar panel equipment

### v1.21.0 — 2026-06-12 { #v1-21-0 }

Solar Panel equipment + APsystems integration (spec 125):

- Feat (equipments): new `solar_panel` ("Solar Panel" / "Panneau Photovoltaïque") equipment type. One equipment = one PV panel = one inverter channel; binding a multi-channel inverter offers one candidate per channel (Panel 1 / Panel 2), a channel already used by another panel is no longer offered, and selection is single-device. Read-only.
- Feat (core): new generic `temperature_device` DataCategory — the internal temperature of a device (e.g. an inverter), distinct from `temperature` so it never pollutes a zone's room-temperature average. Streaming (15 min freshness) and historized by default.
- Feat (ui): dedicated solar dashboard widget — PV panel logo + produced power · current · voltage, identical on desktop and mobile, "Veille" when not producing. New "Solar" group on the Maison view, and a read-only detail panel (power / energy / voltage / current / inverter temperature).
- New plugin: `apsystems` (read-only) — discovers APsystems micro-inverters (DS3 / YC600 / QS1) from the [ESP32-ECU](https://github.com/mchacher/ESP32-ECU) MQTT bridge, one device per inverter, using the firmware Name as the stable identity so a hardware swap keeps the Sowel config (the serial is exposed as a read-only data point). Install it from the plugin store.

---

## 1.20.x — Energy cost valuation + shadow mode

### v1.20.0 — 2026-06-03 { #v1-20-0 }

Energy cost valuation (spec 123):

- Feat (energy/api): `GET /api/v1/energy/history` now returns `cost_hp`, `cost_hc` and `cost_total` (€) on every point and in totals, computed at read time from the existing `TariffPrices.hp` / `TariffPrices.hc` (€/kWh) already stored in `energy.tariff` settings. Per-point cost reflects the raw bucket consumption (matches chart bar tooltips); totals cost reflects the grid-side hp/hc (autoconso-subtracted) and matches the summary card. When the tariff is missing or both prices are 0, every cost field is exactly 0 and the request succeeds.
- Feat (energy/api): `GET /api/v1/energy/by-usage` adds per-submeter `cost` plus `totals.costByEquipment`, `totals.otherCost`, `totals.totalCost`, using a period-blended €/kWh derived from the main meter's HP/HC totals for the same window. Submeters store only `energy` (no HP/HC channel) so the blended rate keeps the cost computation to a single Influx pass; the trade-off is a slight (~5 %) attribution skew for an equipment running exclusively in HC vs. invoice-grade attribution. When there is no main meter, the blended rate is 0 and submeter costs are 0.
- Feat (UI/energy): new Wh / € toggle in the Energy page header. Cost mode swaps the bar chart Y axis and tooltips, the summary card totals and the by-usage stacked bar to euros. Toggle preference persisted in `localStorage` (`sowel_energy_unit`). When the tariff is not configured the toggle is disabled with a tooltip pointing to Settings > Tariff. Autoconso has no billed cost and is therefore hidden from the chart in € mode.
- Feat (UI/settings): TariffSettings shows a one-line hint under the prices — "Ces prix valorisent toute votre consommation passée et future" — making the read-time pricing semantic discoverable (changing prices re-values past data).
- Change (energy/api): `/api/v1/energy/status.tariffConfigured` semantics tightened from "any `energy.tariff` setting blob exists" to "at least one of `prices.hp` / `prices.hc` is > 0". A schedule-only tariff with 0/0 prices no longer enables the cost UI.

Shadow mode (spec 124):

- Feat (core): new `SOWEL_SHADOW_MODE=1` env var. When set, Sowel boots its HTTP server and serves the UI normally, but every outbound subsystem is gated off both at boot and at runtime: no plugin starts (no MQTT connect, no cloud poll, no OAuth refresh), no recipe instance is restored or armed, no MQTT publisher connects, no notification publisher subscribes, no GitHub version polling. The runtime gates on `PluginLoader.loadPlugin` and `RecipeManager.startInstance` mean that an admin clicking _Enable_ on a plugin or recipe inside a shadow instance does NOT cause it to dial out — the SQLite row updates, but the runtime stays inert.
- Feat (api): `GET /api/v1/system/mode` returns `{ shadowMode: boolean }`, used by the UI banner. Auth required, accessible to any authenticated user.
- Feat (ui): full-width amber **SHADOW MODE** stripe above the sidebar and content on every page, non-dismissable, when `shadowMode === true`. Localized FR + EN.
- Feat (logs): when shadow mode is active, a `warn`-level structured log line `module: "shadow-mode"` is emitted at boot with the container hostname, so any accidental activation of shadow mode on production is immediately visible in `docker logs sowel` and can be alerted on.
- Docs: new internal playbook in `scripts/howto-shadow.md` (not published to docs.sowel.org) describing the full lifecycle of a shadow instance — pre-flight checklist, backup, run with `SOWEL_SHADOW_MODE=1`, restore, test, cleanup, and a recovery section for the "I forgot to set the env var" case.

---

## 1.19.x — Display wake action

### v1.19.1 — 2026-06-02 { #v1-19-1 }

- Fix (UI/equipments): the auto-binding flow now picks up the `wake` order on display equipments. Before this fix, the `RELEVANT_ORDERS["display"]` whitelist in `bindingUtils.ts` listed only `language` and `brightness`, so even after the firmware advertised the new `display_wake` capability (iter 036) and the displays plugin v0.2.1 exposed it on the device, the equipment creation flow silently filtered it out. Result: the presence-display recipe v0.2.0 refused to start with `Display "..." has no order of category "display_wake" — firmware too old`. Fix: add `wake` to the display whitelist. Companion to spec 122. Note: the UI's `CANDIDATE_BASED_TYPES` set still excludes `display` (asymmetry with the backend's `binding-candidates.ts` which treats display as an "all"-candidate type). Aligning those is a follow-up; the whitelist fix is the minimal patch for the user-visible issue.
- Feat (UI/displays): the equipment card in the zone view now surfaces a display's current brightness inline next to the type label — `Display · 30 %` when lit, `Display · Off` when brightness is 0 (the recipe-driven sleep state). Previously the user had to click into the equipment detail page to read the slider value to know whether the panel was asleep.

### v1.19.0 — 2026-06-02 { #v1-19-0 }

- Feat (core): new `display_wake` order category for the display equipment type. A no-value action that tells the display to restore its last user-chosen brightness from local NVS. Spec 122. Used by the presence-driven sleep recipe (`sowel-recipe-presence-display` v0.2.0+) so the recipe no longer needs to know the user's preferred brightness level. Companion changes: `sowel-plugin-displays` v0.2.0 routes the order to `<prefix>/<id>/cmd/wake`; sowel-energy-display iter 035 splits NVS into `current_pct` + `user_pct`, restores `user_pct` on tap-wake or `cmd/wake`, and auto-extinguishes 2 minutes after a tap-wake if the recipe has not confirmed the wake.

---

## 1.18.x — Display equipment type

### v1.18.4 — 2026-06-02 { #v1-18-4 }

- Fix (UI/display): brightness slider polish. The v1.18.3 echo-driven draft clear left a short window where the rendered value could flash back to the previous binding value between the user release and the server echo. Replaced by a flat 1.5 s post-commit hold — the slider pins on the user's target until the firmware round-trip has reliably landed, no flicker. Slider step bumped from 5 to 10 (`min=0 max=100 step=10` → 11 well-spaced stops including the "Off" position at 0), per user feedback that the 5 % step felt too fine and the touch hit on 0 was unreliable.

### v1.18.3 — 2026-06-02 { #v1-18-3 }

- Fix (UI/display): brightness slider now commits the order on `onPointerUp` (pointer release) instead of via the 300 ms trailing debounce of v1.18.2 — zero perceived latency between releasing the slider and the panel reacting. A 500 ms fallback debounce on `onChange` still covers keyboard / accessibility paths where pointerup never fires. The local draft value also stays pinned to the user's target until the WebSocket round-trip echoes the same value back, so the thumb no longer snaps back to the stale binding during the ~700 ms server cycle.
- Feat (UI/display): the slider's `min` lowered from 5 to 0 so the panel-off state ("Off" — full LEDC duty zero on the firmware side) is reachable from the equipment detail card. The numeric readout renders "Off" instead of "0 %" when the value reaches zero. Companion firmware change on sowel-energy-display iter 035 supports 0 as the explicit off value, falls back to the default 80 % at boot if NVS holds 0 (recovery against a stuck panel after a power cycle while a sleep recipe was active), and wakes the panel on any tap when off (failsafe in case the recipe stops dispatching).

### v1.18.2 — 2026-06-02 { #v1-18-2 }

- Fix (UI/display): the brightness slider on the display equipment detail page is now debounced (300 ms trailing). React's `onChange` on a `<input type="range">` fires on every pointer-move event during a drag (5..10 / s) — pre-1.18.2 each event posted to `/api/v1/equipments/:id/orders` and the displays plugin republished a `cmd/brightness` per event, hammering the firmware and amplifying the cmd flood. A slow scrub from 100 % to 5 % now produces exactly one MQTT cmd (the final value). Live thumb + numeric readout still track the drag locally for responsiveness. Companion firmware fix on sowel-energy-display iter 035 marshals the cmd through `lv_async_call` with coalescing to absorb any flood that still slips through.

### v1.18.1 — 2026-06-02 { #v1-18-1 }

- Fix (UI/equipments): the "Add equipment" device picker now filters down to display-capable devices when the equipment type is `display`. The v1.18.0 version forgot the `display` entry in `DeviceSelector`'s `EQUIPMENT_TYPE_CATEGORIES` and `bindingUtils`'s `RELEVANT_DATA / RELEVANT_ORDERS` maps, so the picker listed every device on the system and the create-with-devices flow silently bound nothing. Filters now match on the canonical display fields (`display_brightness` / `language` / `rssi`) and auto-create the 5 data bindings (firmware_version / uptime / rssi / language / display_brightness) + 2 order bindings (language / brightness) when the user picks a supervised device. Spec 120 follow-up.

### v1.18.0 — 2026-06-01 { #v1-18-0 }

- Feat (equipments): new `display` equipment type for Sowel-supervised displays. Companion plugin `sowel-plugin-displays` (separate repo) discovers displays via MQTT (retained `state` payload, LWT-driven availability) and exposes them as Sowel devices that bind to the new `display` equipment. The first vendor is the sowel-energy-display AMOLED firmware (iter 035, separate repo); future e-paper / OLED / ePOS displays follow the same wire contract with zero plugin change. New `DataCategory` values: `firmware_version`, `uptime`, `rssi`, `language`, `display_brightness`. New `OrderCategory` values: `set_language`, `set_display_brightness`. New widget family `displays` (zone-level aggregation `displaysOnline / displaysTotal`). New `DisplayPanel.tsx` on the equipment detail page renders the canonical fields with an inline language dropdown and brightness slider, hidden when the matching binding is absent. The dashboard widget picker hides displays — they are meta / control surfaces, not "things in the home" to be summarised. Spec 120 + 121.
- Feat (plugins/registry): added `displays` plugin (v0.1.0, owner mchacher, official) — install from Admin → Plugins → Browse to start supervising displays. The plugin exposes `mqtt_url` / `mqtt_username` / `mqtt_password` / `topic_prefix` (default `sowel-display`) in its settings page.

---

## 1.17.x — Energy history per-period aggregation

### v1.17.0 — 2026-05-31 { #v1-17-0 }

- Feat (backend/api): `GET /api/v1/energy/history` and `GET /api/v1/energy/by-usage` now return a fixed number of pre-aggregated buckets per period — 24 hourly for `day`, 7 daily Mon-Sun for `week`, 28-31 daily for `month`, 12 monthly Jan-Dec for `year`. Pre-spec-119 a `?period=week` query returned 168 hourly points and `?period=year` returned ~365 daily points, forcing every consumer (web UI `EnergyBarChart.tsx` and the new sowel-energy-display firmware iter 034) to re-aggregate client-side. The aggregation now happens once in InfluxDB via Flux `aggregateWindow(every: $resolution, location: $tz)`, with bucket boundaries aligned to the server's local TZ (`Europe/Paris` by default; logged at startup). HP / HC tariff split is preserved on every bucket. Empty buckets are returned zero-filled so consumers iterate `0..N-1` without gap-handling code. `EnergyHistoryResponse.resolution` gains a new `"1mo"` literal for the yearly bucket. Spec 119.

---

## 1.16.x — Analyse chart improvements

### v1.16.0 — 2026-05-30 { #v1-16-0 }

- Feat (UI/Analyse): per-category chart families locked to a single chart. `temperature` / `humidity` / `pressure` / `co2` / `voc` / `noise` / `luminosity` / `power` / `voltage` / `current` / `wind` / `battery` form the **Measurements** family (line chart). `rain` / `energy` form the **Cumulative** family (bar chart). `motion` / `contact_door` / `contact_window` / `water_leak` / `smoke` form the **States** family (step chart on a `[0, 1]` axis with semantic tick labels — "fermé" / "ouvert", "absent" / "présent", etc.). The series picker greys out cross-family bindings with a "Famille incompatible" tooltip; a "Vider le graphe" button resets the family lock. Spec 118 F2 / F5 / F7.
- Feat (UI/Analyse): min/max envelope band on slow-moving Measurements series (temperature, humidity, pressure, CO2, VOC, noise, luminosity, power) at 1h / 1d resolution. A semi-transparent shaded area is drawn around the mean line between the API's `min` and `max` fields (already returned by the downsampled buckets). A global header toggle "Enveloppe min/max" turns the band on/off in memory; default on. Tooltip rows show `21.5 °C (18 / 26)` when the band is rendered. Spec 118 F1.
- Fix (backend/history): cumulative-category history queries (`rain`, `energy`) now read the pre-aggregated `mean` field from downsampled buckets (`sowel-hourly`, `sowel-daily`) instead of filtering on the raw `value_number` field that only exists in the raw bucket. The previous query path silently returned zero points on every aggregated rain / energy chart and fell back to the raw bucket, which holds only a few days of live-writer data. Caught on sowelox right after a 12-month rain backfill: the "Pluie" chart on Mois view stayed empty despite `sum_rain_24` daily totals being correctly written by the Netatmo backfill script. Spec 118 F8, with new `buildFluxQuery` unit tests covering both the downsampled and raw-bucket branches.
- Fix (UI/nav): clicking "Analyse" in the sidebar while on a saved-chart sub-route (`/analyse/<chartId>`) now navigates back to the empty workspace at `/analyse` instead of only toggling the section expansion. The previous click handler called `preventDefault` for any path starting with `/analyse`, making the new-chart workspace unreachable once a saved chart had been opened. Spec 118 F9.
- Feat (UI/Analyse): the empty Analyse workspace opens the add-series picker by default and preselects the first zone, so the chart-creation flow (zone → equipment → metric) is visible immediately on `/analyse`. The empty-chart placeholder shrinks to a quiet dashed panel pointing at the picker above. Spec 118 F9.
- Change (history): wind direction and gust details (`wind_angle`, `gust_strength`, `gust_angle`) are no longer historized by default. They remain visible live in the `WeatherPanel` (compass arrow, gust hero) but disappear from the Analyse picker on new installs and after redeploy on existing ones. Legacy points already in InfluxDB are harmless and decay with retention. Spec 118 F6.

---

## 1.15.x — Live submeter breakdown

### v1.15.7 — 2026-05-30 { #v1-15-7 }

- Fix (UI/Analyse): in the Année / Mois views, the X axis repeated the same month label many times ("mars mars mars … avr. avr. avr."). Root cause: the X axis was wired as categorical strings so every daily data point became its own X position. Switch to a continuous time scale (epoch ms + `tickFormatter`) so Recharts spaces ticks evenly by time and the formatter renders "mars" only where a tick actually lands. `minTickGap` is now period-aware (60/70/80/90 px for day/week/month/year).

### v1.15.6 — 2026-05-30 { #v1-15-6 }

- Feat (UI/Analyse): the Analyse page time-range selector is replaced with the same calendar navigator the Energy page uses — period tabs (Jour / Sem / Mois / Année) + prev/next chevrons + an "Aujourd'hui" reset. Users can now scrub to any absolute calendar window (a specific Tuesday, last August, 2025 overall) instead of only "the last N hours/days ending now", which was a blocker for visualising backfilled historical data on a chart. The 4 tabs are equal-width for visual rhythm, and the navigator layout mirrors the Energy header (title left, navigator right).
- Feat (UI/Analyse): mobile burger + saved-charts drawer (`AnalyseMobileNav`) — mirrors the Energy mobile nav. On `/analyse/*` the topbar burger opens a drawer listing the user's saved charts plus a "Nouveau graphique" entry, so users can switch between charts without going through the desktop sidebar. The h1 page title is hidden on mobile (the topbar already shows it), reclaiming vertical space for the chart.
- Feat (UI/Analyse): friendly metric labels everywhere a binding chip or legend appears, even on saved charts. The chart pills, tooltip and legend now show "Température extérieure" / "Batterie Module Extérieur" / etc., rather than the raw alias (`temperature_2`, `battery_3`). Saved charts re-fetch their equipment's bindings at load to enrich the labels.
- Change (mobile UX): drop the redundant `⋮` MoreVertical button in the mobile topbar — it opened the same drawer (Settings / Plugins / Account / Logout) as the bottom-nav "Plus" button. One entry point, no duplicate.
- Fix (UI/Analyse): TZ-correct date arithmetic in the period navigator. The previous shift used `toISOString().slice(0, 10)` (= UTC date string), which silently lost a day when local time was ahead of UTC — the forward arrow appeared stuck and backward skipped days. Replaced with a local-date formatter.

### v1.15.5 — 2026-05-30 { #v1-15-5 }

- Fix (history): outdoor temperature and humidity bindings (`temperature_outdoor` / `humidity_outdoor` categories — typically the Netatmo outdoor module) are now historized by default. The `CATEGORY_DEFAULTS_ON` whitelist in `history-writer.ts` only knew the indoor variants, so on-by-default fell through to OFF and no point was ever written to InfluxDB. Existing equipments pick up the change at next history-writer cache refresh (any `equipment.updated` event, or boot). First `resolveHistorize` unit-test file added to lock the contract for the on-by-default set.
- Feat (UI/history): replace raw binding aliases (`temperature_2`, `humidity_2`, `battery_3`, …) with equipment-level human-readable labels everywhere a binding chip or legend appears — Analyse picker chips, series pills, chart Tooltip / Legend, and the History panel of the equipment detail page. Indoor / outdoor disambiguation comes from the data category itself (`Température intérieure` vs `Température extérieure`); only multi-instance categories with no semantic sibling (typically multiple batteries on a multi-module weather station) leak a device name as a disambiguator (`Batterie Module Extérieur` / `Anémomètre` / `Pluviomètre`). Hovering a chip still shows the raw alias as a tooltip for power users.

### v1.15.4 — 2026-05-29 { #v1-15-4 }

- Fix (UI/weather): the Netatmo outdoor module (NAModule1) is now bindable on a `weather` equipment. The category filter in the device selector only listed `temperature` / `humidity` (indoor variants), so the outdoor module — the only one carrying the _outdoor_ temperature, ironically — was hidden from the compatible-devices list and silently skipped by the auto-binding loop. Add `temperature_outdoor` and `humidity_outdoor` to the filter, and to `SENSOR_DATA_CATEGORIES` so the bottom-sheet detail view picks them up too. Locked with unit tests.
- Feat (UI/weather): rework the dashboard weather widget to surface **outdoor and indoor temperatures side by side** when both modules are bound. Humidity is dropped from the compact view (the second temperature is the more useful comparison). When only one of the two is bound, the single temperature carries its explicit `Extérieur` / `Intérieur` caption — never implicit, since reading just `20.5°` left the user wondering which it was. Lookup is by category, not by alias, so the Netatmo key collision (both modules send `key: "temperature"`) is handled correctly.
- Feat (UI/weather): the bottom sheet (tap the widget) is reorganised by physical module — one compact section per device (Outdoor Module, Indoor Station, Rain Gauge, Wind Gauge) with the device name and battery in the section header. Same mental model as the equipment detail page (`WeatherPanel`), rendered as stacked sections instead of a card grid. Per-row `(Intérieur)/(Extérieur)` suffixes are removed: the section header is the disambiguator.

### v1.15.3 — 2026-05-29 { #v1-15-3 }

- Change (deployment): in-app self-update is now **enabled by default**. The official `docker-compose.yml` mounts `/var/run/docker.sock` into the Sowel container, so the "Update now" button in the Admin UI works out of the box on a fresh install. The `docker-compose.override.example.yml` opt-in template is gone. **Security trade-off**: mounting the Docker socket gives the Sowel container effective control over the host's Docker daemon, so a successful RCE against Sowel would escalate to host root. For hardened or multi-tenant deployments, remove the `docker.sock` line from the compose file to opt back out — the rest of Sowel keeps working, only the in-app updater is disabled. This reverses the v1.7.0 (spec 105) decision after field feedback: nearly every install hit the "update unavailable" message without guessing they had to copy an override template. Existing installs are NOT touched; the new default only applies to compose files freshly fetched from the repo.

### v1.15.2 — 2026-05-28 { #v1-15-2 }

- Fix (core): the official `docker-compose.yml` now declares `extra_hosts: ["host.docker.internal:host-gateway"]` on the `sowel` service. MQTT-based plugins (Zigbee2MQTT, LoRa2MQTT, Tasmota, Shelly, Somfy RTS bridge...) can now reach a broker hosted on the same machine via `host.docker.internal:1883` — no need to hard-code the host's LAN IP (fragile under DHCP). Existing installs pick up the change after refreshing their compose file or pulling the new image with the manual block added (see `docs/user/host-setup.md`).
- Fix (UI/PWA): removed an unconditional service-worker unregister loop that ran on every page load and killed the PWA registration as soon as `vite-plugin-pwa` installed it. Chrome on Android refused to show the install prompt because no controlling SW existed at evaluation time. Install banners now appear again on HTTPS deployments; existing visitors should clear site data once so the previous wipe doesn't replay.
- Fix (UI/weather forecast): creating a `weather_forecast` equipment from the UI now auto-binds the 25 data points emitted by the Open-Meteo plugin. The frontend auto-binding map had no entry for `weather_forecast`, so every `j1_*`..`j5_*` key was silently filtered out and the resulting equipment displayed an empty forecast panel. The relevant Sowel categories (`weather_condition`, `temperature_outdoor`, `rain`, `wind`) are now declared and locked by a unit test.

### v1.15.1 — 2026-05-27 { #v1-15-1 }

- Feature (API): new optional `?type=<EquipmentType>` query parameter on `GET /api/v1/equipments`. Returns only equipments of the requested type (e.g. `?type=energy_meter`). Unknown values return an empty list rather than a 400 so callers can safely forward user input. Lets memory-constrained clients (like the sowel-energy-display ESP32 firmware) drop a 100 KB payload to a few KB by asking only for the entries they need.

### v1.15.0 — 2026-05-27 { #v1-15-0 }

- Feature (Energy UI): a "Consumption breakdown" donut now sits below the Maison/Réseau/Solaire diagram on the Live page (spec 117). One segment per `energy_meter` submeter and an "Other" residual for what no clamp measures, sized by instantaneous power (W). Updates reactively from the existing equipments WebSocket stream, no new endpoint or DB change. Colors match the historical By-usage chart so a given clamp keeps the same color in both views. Offline submeters drop out of the donut but stay listed greyed in the legend.

## 1.14.x — Equipment availability

### v1.14.1 — 2026-05-26 { #v1-14-1 }

- Fix (UI): the "Total" label under the Production solar chart now equals the sum of the stacked bars (autoconsumption + grid injection). Previously the label was sourced from the raw inverter `energy` series while the bars summed the per-minute `autoconso` and `injection` series, and the two could drift by ~1 kWh per day because of cross-meter timing skew. Visual only, no data lost.

### v1.14.0 — 2026-05-26 { #v1-14-0 }

- Equipments: every equipment now exposes a derived `status` field (`online` / `degraded` / `offline`) computed in memory from the backing devices' `status` and the freshness of streaming bindings (spec 116). The UI ships ambre "Degraded" and red "Disconnected" badges on every surface where users see equipment values: compact zone rows (badge replaces controls when fully offline), equipment detail header, energy cumuls panel (with last-update caption), zone aggregation pills (`(N unavailable)` hint when an offline equipment was excluded from a metric). The Live Energy page gains a top banner that flags stale or disconnected meters explicitly. Triggered by a real bug: a Shelly Pro 3EM coupé au tableau kept the live energy graph displaying its last value as if it was live, with zero indication of staleness.
- Plugin contract: a new mandatory section in `plugin-development.md` documents that every plugin MUST keep `device.status` truthful via `updateDeviceStatus()`. A prod audit found 24 devices stuck at "online" with `lastSeen` between 1 hour and 49 days; those are upstream plugin bugs to fix (Z2M `availability` topic, MCZ Socket.IO disconnect, etc.), not Sowel core gaps. Sowel intentionally does not add a generic `device.lastSeen > timeout` watchdog because battery-powered Zigbee endpoints can stay silent for days without being offline.
- API: new `GET /api/v1/system/sunlight` endpoint exposing sunrise / sunset / isDaylight (#218). Also: `GET /equipments` and `GET /equipments/:id` payloads gain `status` + optional `statusReason`; `GET /zones/:id/aggregated` payload gains `unavailableEquipmentsByCategory`; WebSocket gains a new `equipment.status.changed` event broadcast on every transition.

## 1.13.x — Awning equipment

### v1.13.2 — 2026-05-24 { #v1-13-2 }

- Fix (zones): excluded `pool_cover` equipments from the shutter zone aggregates (`shuttersOpen` / `shuttersTotal` / `averageShutterPosition`). Pool covers share the `shutter_position` data category with shutters and were being counted, which surfaced phantom "all shutters" pills and bulk commands on Piscine zones (and their parent zones — e.g. an Outdoor → Pool subtree inherited them recursively). The `allShuttersOpen/Stop/Close` zone orders already targeted `type=shutter` only so executing the phantom command was a no-op — only the UI lied. The fix also makes awning and pool_cover exclusions uniform (positive `type === "shutter"` check).

### v1.13.1 — 2026-05-24 { #v1-13-1 }

- Fix (zones): dropped the `awningsDeployed` / `awningsTotal` zone aggregates that shipped by mistake with v1.13.0. Awnings reuse the `shutter_position` data category but are intentionally not aggregated at the zone level — the dashboard awning widgets compute their counts locally. The "Stores bannes X/Y" pill is removed from the zone view, and a regression assertion now guarantees awnings don't pollute the shutter aggregates either. Bulk zone commands (`allAwningsExtend/Stop/Retract`) are untouched.

### v1.13.0 — 2026-05-23 { #v1-13-0 }

- Equipments: new `awning` equipment type (spec 115), sibling of `shutter`. Same control surface (position 0–100 + OPEN/STOP/CLOSE), with awning-specific vocabulary throughout the UI: "Déployer / Rétracter" buttons, "Déployé / Rétracté" state pills, and a dedicated "Stores bannes" group in the zone view. The mapping is RF-up = retract (position 0), RF-down = deploy (position 100).
- UI: V3 awning illustration shipped across the dashboard (single-equipment widget, family widget, zone-family widget, mobile widget card, detail sheet slider) and the home view (compact card, hero icon, aggregation pills, group header). Open state = window + cassette + 10 trapezoidal scalloped stripes in Sowel primary blue / primary-light. Closed state = window + cassette + small retracted fringe. Two icon components: `AwningIcon` (24 viewBox, state-aware) for icon contexts, `AwningWidgetIcon` (56 viewBox, 120 px, gradient polish) for dashboard widgets.
- Fix: the awning detail page used to render an empty card — controls were gated on `isShutter` only, so `Extend/Stop/Retract` never showed. Same gate was missing on the single-equipment dashboard widget (showed only the position number, no icon). Both fixed.
- Plugin: new `somfy-rts` integration in the registry ([repo](https://github.com/mchacher/sowel-plugin-somfy-rts), v1.0.3). Bridges the open-source [somfyrts2mqtt](https://github.com/mchacher/somfyrts2mqtt) ESP32 + CC1101 hardware (v0.2.0+) into Sowel: auto-discovers Somfy RTS shutters and awnings from retained Tasmota SENSOR topics, parses position/direction/target, and dispatches OPEN/STOP/CLOSE + percentage to `cmnd/<root>/<remote>/...`.

## 1.12.x — Weather station UX

### v1.12.1 — 2026-05-20 { #v1-12-1 }

- Build: raised the PWA workbox precache cap to 5 MiB. The main UI bundle crossed the 2 MiB default after the spec 114 rework, which broke the v1.12.0 Docker build. No runtime change. A follow-up will split the bundle via `manualChunks` so the cap can come back down.

### v1.12.0 — 2026-05-20 { #v1-12-0 }

- UI: weather station rework (spec 114). The "Station Météo" widget now renders a clean 1×1 tile on both PC and mobile — outdoor temperature in big mono font + humidity below, nothing else — and a tap (or click on desktop) opens a drawer with the full reading. The drawer also surfaces the Sowel-computed `rain_24h` / `rain_1h` totals, so users whose Netatmo plugin only auto-bound the bare `rain` (mm/h) device-side still see the actual 24 h rainfall. The compact zone row now shows 4 values (temp / humidity / `mm/24h` rain / wind) with the same computed-data fallback. The equipment detail `WeatherPanel` injects the computed values into the rain module card too, and the wind module gained a small directional arrow + compass abbreviation derived from `wind_angle`.
- UI: history bar chart readability. On 7 d / 30 d ranges, raw hourly samples are now bucketed into daily totals (so a single rainy afternoon shows as one Thursday bar rather than two detached spikes labelled "jeu. 14" twice). Per-range tick cap (7 d → 7 labels, 30 d → 10), two-line X labels on 7 d (weekday + day), compact `DD/MM` on 30 d, responsive font size on mobile widths. Tooltip switches to "Thursday 14 May" on daily buckets.
- UI: PWA. Added the standard `mobile-web-app-capable` meta alongside the Apple-specific one to silence the Chrome deprecation warning in DevTools.

## 1.11.x — Plugin soft isolation

### v1.11.1 — 2026-05-19 { #v1-11-1 }

- Reliability: Sowel now installs process-wide handlers for `uncaughtException` and `unhandledRejection` (spec 112). When a throw escapes every other guard (a `setInterval` callback in the core, an unawaited promise in an MQTT publish, a native module surprise), the new handlers log a `fatal` entry with the full stack to stdout and to `data/logs/sowel.N.log`, then exit cleanly so Docker's restart policy reboots the container. Before, an uncaught crash left no trace and Docker just looped silently. After, every post-incident investigation has at minimum one log line to start from. No behavior change in the nominal path; the handlers are pure safety net.
- Security: new audit log persists every security-sensitive action in the new `audit_log` SQLite table (spec 113). Captured events cover authentication (login success/failure, logout, API token create/delete), user management (create/update/delete/password change), settings updates, mode activation/deactivation, backup export/restore, and plugin install/uninstall/update/enable/disable. Each entry records the actor (user id + username + token kind), source IP, action, target, and a JSON `meta` blob with redacted values for sensitive keys (`password`, `token`, `secret`, `apiKey`). A new admin-only endpoint `GET /api/v1/audit` exposes the trail with filters by actor, action prefix, and date range. Retention is 365 days, purged at boot.

### v1.11.0 — 2026-05-19 { #v1-11-0 }

- Security hardening: every integration plugin now runs with scoped Proxies on its `PluginDeps` (spec 111). Four invariants are enforced at the JS layer: a plugin can only read or write settings under its own `integration.<own-id>.` prefix (plus a small allowlist of globals like `home.latitude`), can only emit events from a `system.*` whitelist (no domain-event impersonation), can only mutate devices belonging to its own integration, and lifecycle method errors (`refresh`, `getStatus`, etc.) are confined with typed fallbacks instead of crashing the core. Validated locally against the 13 plugins of the registry with zero false positives. No breaking change for plugin authors: the `PluginDeps` shape and method signatures are bit-for-bit identical, so existing plugins keep working without modification. The isolation is unconditional in this release; there is no opt-out. Rollback is via Docker image downgrade.
- Audit: spec 089 (plugin supply-chain SHA256) plus spec 111 together close the dominant plugin threat vectors. Residual gaps (direct `better-sqlite3` access from a plugin, arbitrary `fetch`, infinite loops, `process.exit`) require hard isolation via worker threads and are documented as out of scope until the registry grows past trusted owners.
- Docs: new "Plugin scoping" section in `plugin-development.md` (EN+FR) explaining the four invariants for plugin authors, the explicit allowlists in `scoped-deps.ts`, and what the Proxy does not protect against.

## 1.10.x — Changelog at your fingertips

### v1.10.3 — 2026-05-17 { #v1-10-3 }

- Refactor: every binding resolution across the UI and the recipe engine now goes through a shared category-first resolver. Manually re-bound equipments (where the alias defaults to the device key) keep working everywhere: zone view, equipment detail, mobile dashboard sheet, mobile direct toggle, close-all-valves, and recipe-driven dispatch (motion-light, switch-light, presence-heater, state-trigger-light). Closes the latent bug class behind the v1.10.2 pool-cover incident. Spec 110.

### v1.10.2 — 2026-05-17 { #v1-10-2 }

- Fix: the pool pump's ON/OFF toggle no longer wraps to a second line under the icon in the compact zone view.
- Fix: pool cover (and any shutter) OPEN/STOP/CLOSE buttons reappear in the zone compact view, the mobile dashboard sheet, and the equipment detail page when the binding was created with the device key as alias (e.g. after a manual re-bind through the UI). The controls now resolve the move/position bindings by category, mirroring the dashboard widget's existing logic.

### v1.10.1 — 2026-05-17 { #v1-10-1 }

- Fix: a partial discovery announcement from an integration plugin no longer silently destroys equipment bindings. Before, if a Tasmota / Zigbee2MQTT / etc. device temporarily failed to advertise one of its keys on reconnect, the `device_data` / `device_orders` row was deleted and the FK CASCADE wiped any equipment binding to it. The pool cover lost its open/close command this way after the v1.10.0 restart. Bound rows are now preserved across partial re-discoveries; only truly orphaned rows are still cleaned up (spec 109).

### v1.10.0 — 2026-05-17 { #v1-10-0 }

- Each row of the topbar updates sheet now exposes a discreet changelog icon next to the Update button. Click it to open the matching release notes (this page for Sowel core, the plugin's GitHub release page for plugins) in a new tab. No more clicking blindly through versions (spec 107).
- Release Notes moved into the User Guide table of contents.
- CI now refuses to publish a release unless this page has an entry for the new version in both EN and FR (spec 108). Side effect: every in-app "View changes" link is guaranteed to land on a populated section.

---

## 1.9.x — Actionable updates pill

### v1.9.0 — 2026-05-17 { #v1-9-0 }

- Topbar updates pill now opens an `UpdatesSheet` listing Sowel core + outdated plugins, with a one-click `Update` button per row (spec 106). Replaces the old blind redirect to `/plugins`, which left core updates invisible.

---

## 1.8.x — Charts & activity feed

### v1.8.1 — 2026-05-17 { #v1-8-1 }

- Time-series charts now use a linear time scale on the X axis. Motion / contact / sparse weather data is no longer visually compressed when events are bunched in time.

### v1.8.0 — 2026-05-16 { #v1-8-0 }

- New activity feed in zone view (spec 101). Shows the last 24 h of events with a responsive cap (10 on mobile, 100 on desktop), filtered by binding category and scoped to the current zone.

---

## 1.7.x — WAN hardening

### v1.7.0 — 2026-05-15 { #v1-7-0 }

- WAN hardening (spec 105): CSP and WebSocket Origin check tightened for safe public exposure behind a Cloudflare tunnel. Google Fonts allow-listed for the Nunito heading font. Docker socket accessible to the non-root `sowel` user.
- CI: native ARM64 GitHub runner with parallel builds — multi-arch release time dropped from ~15 min to ~3 min.

---

## 1.6.x — Design system + plugin supply chain

### v1.6.6 — 2026-05-15 { #v1-6-6 }

- Setup wizard auto-triggers the restart after submit; unified decimal separator for latitude/longitude inputs.
- CI: GHCR retention policy — old container versions auto-pruned on each release.

### v1.6.5 — 2026-05-15 { #v1-6-5 }

- First-login Home setup wizard. Restart helper now passes `--force-recreate` so it actually restarts.

### v1.6.4 — 2026-05-15 { #v1-6-4 }

- Plugin install only refuses _escaping_ symlinks now; internal symlinks are allowed (spec 089 C1).

### v1.6.3 — 2026-05-14 { #v1-6-3 }

- Self-update normalises the compose file to `:latest`, force-recreates the container, and verifies the new version (spec 104).
- CI: GitHub Release creation gated behind successful ARM64 build.

### v1.6.2 — 2026-05-14 { #v1-6-2 }

- Plugin supply chain hardening (spec 089 C1+C2): SHA256 hashes pinned in the registry, community-namespace install confirmation, restore path confinement, extension whitelist, symlink refusal, size cap.

### v1.6.1 — 2026-05-14 { #v1-6-1 }

- Docker build fix — `design-system/` is now copied into the UI build stage.

### v1.6.0 — 2026-05-14 { #v1-6-0 }

- Major UI overhaul to design-system parity (specs 094–100):
  - New design-system palette and tokens
  - Sidebar refactored into reusable components
  - Zone view 2-column layout on desktop with cluster aggregation strip and variant pills
  - Icon-only zone command toolbar
  - Dashboard widget chrome unified
  - Typography polish (letter-spacing, H1 standardisation, tabular nums by default)
  - Equipment row chrome refactor and light-on glow
  - Strict mock alignment on zone panels, mobile parity with mockup
- One-command installer (`install.sh`) added.

---

## 1.5.x — Energy & recipes expansion

### v1.5.10 — 2026-05-10 { #v1-5-10 }

- Internal docs revert.

### v1.5.9 — 2026-05-09 { #v1-5-9 }

- Recipe picker rewritten as a compact popover (side-positioned on desktop, bottom sheet on mobile). Pastel palette + rounded corners on the by-usage energy chart.

### v1.5.8 — 2026-05-08 { #v1-5-8 }

- New `state-trigger-light` recipe (spec 092). Recipe slots gain `crossZone` and `includeDescendants` constraints, plus a zone-first picker for single-equipment slots.

### v1.5.7 — 2026-05-08 { #v1-5-7 }

- Power-only submeters and a by-usage energy breakdown chart (spec 091). Submeter cumulative Wh exposed as computed equipment data.

### v1.5.6 — 2026-05-03 { #v1-5-6 }

- Per-mapping enable/disable toggle on MQTT publishers (spec 090).

### v1.5.5 — 2026-05-03 { #v1-5-5 }

- Plugin hot-load: transitive imports cache-busted.

### v1.5.4 — 2026-05-03 { #v1-5-4 }

- Plugin API: `getDeviceDataLastUpdated` getter exposed; `shelly_mqtt` registry bump.

### v1.5.3 — 2026-05-03 { #v1-5-3 }

- Energy production query falls back to the hourly bucket when raw is missing. Consumption tooltip splits HP/HC into grid-only + autoconsumption.

### v1.5.2 — 2026-05-03 { #v1-5-2 }

- Compact header pills replace the alarm banner and integration warning. Live-energy status splits by which source dominates the supply. Plugin unload always calls `stop()`.

### v1.5.1 — 2026-05-03 { #v1-5-1 }

- Self-consumption writer (spec 086 steps E+F), plus aggregator/history bug fixes. New `getDeviceDataValue` getter for plugin baseline hydration.

### v1.5.0 — 2026-05-02 { #v1-5-0 }

- Live power-flow page (`/energy/live`) with auto-detection of sources. Shelly MQTT plugin added to the registry. History migration tool for orphaned equipments.

---

## 1.4.x — Pool heat pump

### v1.4.2 — 2026-05-01 { #v1-4-2 }

- Mobile dashboard renders pool heat pump like a thermostat. Disabled integrations stay visible on the Integrations page. Enable/disable toggle surfaced directly on the row.

### v1.4.1 — 2026-05-01 { #v1-4-1 }

- Persistent Disable/Enable toggle on the integration drawer. Old `ghcr.io/mchacher/sowel` images auto-pruned after self-update.

### v1.4.0 — 2026-05-01 { #v1-4-0 }

- New `pool_heat_pump` equipment type plus the Modbus plugin scaffolding it relies on.

---

## 1.3.x — Pool equipments

### v1.3.2 — 2026-04-19 { #v1-3-2 }

- Alarm reminder logic moved into the Telegram notification publisher (spec 083). Theme-aware fills for the pool pump icon (dark mode). Open/Closed pill in compact shutter and pool cover cards.

### v1.3.1 — 2026-04-19 { #v1-3-1 }

- Recipe slot layout: equal-width columns for homogeneous pairs.

### v1.3.0 — 2026-04-19 { #v1-3-0 }

- New `pool_pump` and `pool_cover` equipment types (spec 081), with inline controls in the compact zone view and a dedicated channel picker on the device side. Multi-channel devices can now back multiple equipments. Plugin registry can be reloaded on demand from the UI.

---

## 1.2.x — Equipment dispatch v2 + domain categories

### v1.2.15 — 2026-04-19 { #v1-2-15 }

- Tasmota plugin registered v1.0.0 (spec 080). Plugin `install()` redirects to `update()` on reinstall.

### v1.2.14 — 2026-04-18 { #v1-2-14 }

- Devices store enum values; UI surfaces dynamic action values (spec 079). New `zone_order` button effect type with zone-first equipment selection (spec 078).

### v1.2.13 — 2026-04-18 { #v1-2-13 }

- Refactor: `dispatchConfig`, `apiVersion`, brute-force fallback removed (spec 074). v2 dispatch is now the only path.

### v1.2.12 — 2026-04-18 { #v1-2-12 }

- Order categories for zone-order resolution (spec 077). New outdoor temperature/humidity categories and updated `netatmo-weather` plugin (spec 076).

### v1.2.11 — 2026-04-18 { #v1-2-11 }

- New domain categories for `media_player`, `appliance`, and `thermostat` (spec 073).

### v1.2.10 — 2026-04-18 { #v1-2-10 }

- Thermostat zone order resolves through the setpoint category (spec 070).

### v1.2.9 — 2026-04-18 { #v1-2-9 }

- Zone orders resolve aliases by category instead of hardcoded names (spec 069).

### v1.2.8 — 2026-04-18 { #v1-2-8 }

- Order dispatch v2 — plugins receive `orderKey` directly instead of a `dispatchConfig` blob (spec 067).

### v1.2.7 — 2026-04-15 { #v1-2-7 }

- Shutter zone orders use the OPEN/CLOSE state instead of a position.

### v1.2.6 — 2026-04-12 { #v1-2-6 }

- New `onChangeOnly` option on MQTT publishers.

### v1.2.5 — 2026-04-12 { #v1-2-5 }

- Restore snapshot on every reconnect — reverts the v1.2.4 change after side effects.

### v1.2.4 — 2026-04-12 { #v1-2-4 }

- MQTT publishers no longer loop on snapshot when the broker reconnects; re-publish on mapping change.

### v1.2.3 — 2026-04-12 { #v1-2-3 }

- Removed the PID file lock — it caused a Docker crash loop on container restart.

### v1.2.2 — 2026-04-12 { #v1-2-2 }

- Internal cleanup.

### v1.2.1 — 2026-04-12 { #v1-2-1 }

- Self-update helper container preserves the host compose `working_dir`.

### v1.2.0 — 2026-04-12 { #v1-2-0 }

- Plugin registry decoupled from the Sowel release cadence + `sowelVersion` compatibility field (spec 066).

---

## 1.1.x — Water + freecooling

### v1.1.7 — 2026-04-12 { #v1-1-7 }

- Update badges and buttons now use red instead of amber.

### v1.1.6 — 2026-04-12 { #v1-1-6 }

- Internal cleanup.

### v1.1.5 — 2026-04-12 { #v1-1-5 }

- Self-update helper container keeps `AutoRemove` off temporarily for debugging.

### v1.1.4 — 2026-04-12 { #v1-1-4 }

- Internal cleanup.

### v1.1.3 — 2026-04-12 { #v1-1-3 }

- Self-update pulls by version tag instead of `:latest` (avoids racing with concurrent releases).

### v1.1.2 — 2026-04-12 { #v1-1-2 }

- New freecooling recipe — closes shutters before sunrise (spec 065).

### v1.1.1 — 2026-04-12 { #v1-1-1 }

- Recipe packages can hot-install and hot-update without engine restart.

### v1.1.0 — 2026-04-12 { #v1-1-0 }

- New `water_valve` equipment type (spec 062) and auto-watering recipe (spec 063).
- Computed weather data: rain-1h / rain-24h plus cumulative bar charts (spec 064).
- Timezone is now auto-derived from the home location (spec 061), with a safe fallback when the settings table is missing on a fresh install.
- Recipe UX polish, clock seconds, plugin auto-start after install/update.

---

## 1.0.x — First versioned releases

### v1.0.8 — 2026-04-11 { #v1-0-8 }

- Internal cleanup.

### v1.0.7 — 2026-04-11 { #v1-0-7 }

- Self-update helper container pattern + detection improvements (spec 060).

### v1.0.6 — 2026-04-11 { #v1-0-6 }

- Internal cleanup.

### v1.0.5 — 2026-04-06 { #v1-0-5 }

- Remote plugin registry, fetched at runtime with local fallback (spec 059).
- Docker base image switched to Debian Trixie for Python 3.13+ (Panasonic Comfort Cloud bridge compatibility).
- CI builds `amd64` only at this stage (~5 min vs ~15 min), with ARM64 added back later.
- Semver-aware comparison for plugin updates.

### v1.0.4 — 2026-04-06 { #v1-0-4 }

- Internal cleanup.

### v1.0.3 — 2026-04-06 { #v1-0-3 }

- Backup line-protocol export handles non-string InfluxDB values. Restore clears `recipe_log` to avoid orphan FK refs. Docker runtime keeps `python3` for the Panasonic Comfort Cloud plugin bridge.

### v1.0.2 — 2026-04-06 { #v1-0-2 }

- Backup now includes `refresh_tokens` so a restored instance keeps users logged in.

### v1.0.1 — 2026-04-06 { #v1-0-1 }

- Backup `PRAGMA foreign_keys` moved outside the SQLite transaction (it had no effect inside).

### v1.0.0 — 2026-04-06 { #v1-0-0 }

- First versioned release. Adds `package.json` versioning, the Dockerfile, the GitHub Actions release pipeline, and the reference `docker-compose.yml` (spec 055). Everything before this point lives in pre-release git history only.
