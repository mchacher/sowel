# Sowel Documentation

**Sowel** is an open-source home automation engine built with Node.js, TypeScript, and React. It provides a reactive pipeline from physical devices to a modern web dashboard, with support for multiple integrations, automation scenarios, and energy monitoring.

## Key Features

- **Multi-protocol support** — Zigbee (via Zigbee2MQTT), cloud APIs (Panasonic, MCZ, Netatmo), and extensible plugins
- **Device → Equipment abstraction** — Separate physical devices from user-facing functional units
- **Zone aggregation** — Automatic temperature averaging, motion detection, and more
- **Scenario engine** — Trigger/condition/action automations with reusable recipe templates
- **Energy monitoring** — InfluxDB-backed tracking with HP/HC tariff classification
- **Plugin system** — Install third-party integrations at runtime from GitHub
- **Responsive UI** — Mobile-first React dashboard with dark mode

## Documentation Sections

<div class="grid cards" markdown>

- :material-cog:{ .lg .middle } **Technical Guide**

  ***

  Architecture, API reference, plugin development, data model, and contributing guidelines.

  [:octicons-arrow-right-24: Technical Guide](technical/)

- :material-account:{ .lg .middle } **User Guide**

  ***

  Installation, configuration, equipment setup, dashboard, modes, and energy monitoring.

  [:octicons-arrow-right-24: User Guide](user/)

</div>

## Quick Links

- [GitHub Repository](https://github.com/mchacher/sowel)
- [Plugin Development Guide](technical/plugin-development.md)
- [Getting Started](user/getting-started.md)

## License

Sowel is licensed under [AGPL-3.0](https://github.com/mchacher/sowel/blob/main/LICENSE).
