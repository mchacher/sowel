# Technical Guide

This section covers the architecture, APIs, development, and operations of Sowel.

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
                → Recipe Engine (triggers → conditions → actions)
                  → Actions may emit Orders → Integration Plugin → device
            → WebSocket pushes to UI clients
```

Since spec 053, **everything is a plugin** — integrations and recipes are distributed from GitHub via the `PackageManager` service. There are no built-in integrations in `src/` anymore.

## Sections

| Section                                     | Description                                                     |
| ------------------------------------------- | --------------------------------------------------------------- |
| [Architecture](architecture.md)             | System design, plugin V2, self-update, backup, CI/CD, logging   |
| [Deployment](deployment.md)                 | Production deployment, updates, backup/restore, troubleshooting |
| [API Reference](api-reference.md)           | REST API endpoints and WebSocket events                         |
| [Plugin Development](plugin-development.md) | How to create third-party plugin integrations                   |
| [Recipe Development](recipe-development.md) | How to create automation recipe packages                        |
| [Data Model](data-model.md)                 | SQLite schema, TypeScript types, event bus events               |
| [Contributing](contributing.md)             | Development setup, conventions, and workflow                    |

## Specs index

For a chronological list of every spec with one-line summaries and status, see [../specs-index.md](../specs-index.md).
