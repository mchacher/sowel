# Technical Guide

This section covers the architecture, APIs, and development guides for Sowel.

## Overview

Sowel follows a **reactive event-driven pipeline**:

```
Integration message (MQTT, cloud API poll, plugin)
  → Integration Plugin (receives + parses)
    → Device Manager (updates DeviceData)
      → Event Bus: "device.data.updated"
        → Equipment Manager (re-evaluates bindings + computed Data)
          → Event Bus: "equipment.data.changed"
            → Zone Manager (re-evaluates aggregations)
              → Event Bus: "zone.data.changed"
                → Scenario Engine (triggers → conditions → actions)
                  → Actions may emit Orders → Integration Plugin → device
            → WebSocket pushes to UI clients
```

## Sections

| Section                                     | Description                                       |
| ------------------------------------------- | ------------------------------------------------- |
| [Architecture](architecture.md)             | System design, tech stack, project structure      |
| [API Reference](api-reference.md)           | REST API endpoints and WebSocket events           |
| [Plugin Development](plugin-development.md) | How to create third-party plugins                 |
| [Recipe Development](recipe-development.md) | How to create automation recipe templates         |
| [Data Model](data-model.md)                 | SQLite schema, TypeScript types, event bus events |
| [Contributing](contributing.md)             | Development setup, conventions, and workflow      |
