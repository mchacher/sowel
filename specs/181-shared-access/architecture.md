# Spec 181 — Architecture

## Where it sits

```
 phone ── /access/ (static page) ── /api/v1/shared-access/public/*  (no session, rate-limited)
                                              │
                                              ▼
 owner ── SPA « Accès partagés » ── /api/v1/shared-access/*  (admin)
                                              │
 plugin ── deps.sharedAccess ─────────────────┤
                                              ▼
                                   SharedAccessManager  ── every rule, once
                                    │            │
                     SharedAccessStore           └──► EquipmentManager.executeOrder()
                     (SQLite, migration 035)            (spec 154 inversion, 150 resolution,
                                                         141 confirmation, Activity attribution)
```

One manager holds every rule, for the three callers alike — the owner's routes, the public routes
and the plugin API never touch the store. That is what keeps « a suspended access cannot open » true
in all three at once.

## Module layout

`src/shared-access/`

| File                       | Responsibility                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `shared-access-manager.ts` | The rules: create, edit, hold, revoke, delete, change the code, enrol a phone, decide, press, purge |
| `shared-access-store.ts`   | SQLite reads and writes; no rule                                                                    |
| `validity.ts`              | The window in force, the decision (R4.12), what the owner may write                                 |
| `codes.ts`                 | The code alphabet and folding, the phone token and its hash                                         |
| `guessing.ts`              | The failure budget, the held answer, the per-code lock, the alert (R6)                              |
| `gate-queue.ts`            | Per-gate queue and double-press window (R4.14)                                                      |
| `guest-page.ts`            | The public page's HTML, CSS, JS and manifest, as strings                                            |
| `plugin-api.ts`            | `deps.sharedAccess`, scoped to the calling plugin (R9)                                              |

The Paris wall clock reuses the core's existing time-zone helpers (spec 061).

## Data model

`migrations/035_shared_access.sql`:

```sql
ALTER TABLE equipments ADD COLUMN shared_access TEXT;   -- JSON, NULL = off (R2)

CREATE TABLE shared_accesses (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('manual', 'external')),
  label           TEXT NOT NULL,
  code            TEXT,                 -- clear, nulled 7 days after the end (R3.8)
  valid_from      INTEGER,              -- epoch ms, NULL = open-ended
  valid_until     INTEGER,
  source_plugin   TEXT,                 -- external only
  external_id     TEXT,
  source_from     INTEGER,              -- the source's window, external only
  source_until    INTEGER,
  early_open_at   INTEGER,              -- owner's widening of an external window
  extended_until  INTEGER,
  time_windows    TEXT NOT NULL DEFAULT '[]',   -- JSON [{from,to}] 'HH:MM'
  suspended_at    INTEGER,
  revoked_at      INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT NOT NULL,
  last_used_at    INTEGER,
  use_count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_plugin, external_id)
);

CREATE TABLE shared_access_gates (
  access_id     TEXT NOT NULL REFERENCES shared_accesses(id) ON DELETE CASCADE,
  equipment_id  TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  PRIMARY KEY (access_id, equipment_id)
);

CREATE TABLE shared_access_phones (
  id            TEXT PRIMARY KEY,
  access_id     TEXT NOT NULL REFERENCES shared_accesses(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT NOT NULL
);

CREATE TABLE shared_access_journal (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  access_id     TEXT,                  -- kept after the access is deleted
  label         TEXT NOT NULL,         -- copied: « who came in that night » outlives the access
  kind          TEXT NOT NULL,
  reason        TEXT,
  actor         TEXT,
  equipment_id  TEXT
);
CREATE INDEX idx_sa_journal_at ON shared_access_journal(at);
```

`equipments.shared_access` holds `{ "armed": true, "alias": "command", "value": "pulse" }` — the
shape `timed_command` already uses: absence means off, no default to invent.

**Why a gate is an equipment column and not a table.** A gate _is_ the equipment; its lifetime is
the equipment's, and `ON DELETE CASCADE` on `shared_access_gates` gives R2.6's cleanup for free.

**Why the code is in clear.** R3.8. The phone's token, which nobody dictates, is the hashed secret.

## Events

On the bus: `shared_access.opened`, `shared_access.refused`, `shared_access.changed` (any owner or
plugin write, for the SPA over WebSocket). `system.alarm.raised` under source `shared-access` for the
guessing alert (R6) and the phone count (R5.19), which is what reaches notifications.

## API

Admin (`/api/v1/shared-access`, 404 while disabled):

| Method | Path                                    |                                                                |
| ------ | --------------------------------------- | -------------------------------------------------------------- |
| GET    | `/state`                                | accesses shaped for the page, groups, gates, sources           |
| GET    | `/journal?accessId=`                    |                                                                |
| POST   | `/accesses`                             | `{ label, gates, validFrom?, validUntil?, timeWindows? }`      |
| PATCH  | `/accesses/:id`                         | same fields; external: `earlyOpenAt`, `extendedUntil`          |
| POST   | `/accesses/:id/{suspend,resume,revoke}` |                                                                |
| POST   | `/accesses/:id/code`                    | `{ cutPhones }`                                                |
| DELETE | `/accesses/:id`                         | 422 `still_live` unless revoked or ended                       |
| GET    | `/equipment/:id`                        | the panel's line: armed, command, count of people able to open |
| PUT    | `/equipment/:id`                        | `{ enabled, armed?, alias?, value? }` — 422 `gate_in_use`      |

Public (`/api/v1/shared-access/public`, no session, added to `isPublicRoute`, 404 while disabled):
`POST /enrol { code }`, `GET /session`, `POST /open { gate }` — the phone's token as a bearer.
Failures are held back per R6 before they are answered, never the request before it is handled.

Static: `GET /access/`, `/access/app.js`, `/access/style.css`, `/access/manifest.webmanifest`,
`/access/icon.svg` — served from strings, CSP `default-src 'none'; script-src 'self'; style-src
'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'`.

Setting: `sharedAccess.enabled`, `sharedAccess.publicBaseUrl`, `sharedAccess.publicPath` through the
existing settings route; enabling is audit-logged (spec 113).

## Plugin API (R9)

`PluginDeps` grows one member, created per plugin so the plugin id is bound, not passed:

```ts
interface SharedAccessApi {
  upsert(
    externalId: string,
    input: {
      label: string;
      from: string | null;
      until: string | null;
      gates?: string[];
    },
  ): { id: string; code: string | null; invitationUrl: string | null };
  revoke(externalId: string): void;
  list(): Array<{
    externalId: string;
    state: string;
    code: string | null;
    invitationUrl: string | null;
  }>;
}
```

Throws `SharedAccessDisabledError` while the setting is off. Scoped: another plugin's accesses do not
exist for this one.

## UI

| File                                                 |                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `ui/src/pages/SharedAccessPage.tsx`                  | the page (tabs, lines, menu, dialogs)                               |
| `ui/src/components/shared-access/*`                  | line, editor, date-time picker, add-gate dialog, change-code dialog |
| `ui/src/components/equipments/SharedAccessPanel.tsx` | R8, mounted beside `GateConfirmationPanel`                          |
| `ui/src/pages/SettingsPage.tsx`                      | the opt-in switch and the public address                            |
| Sidebar / mobile drawer                              | the entry, shown only while enabled                                 |

EN/FR strings in the locale files, like every other page.

## Shutdown

Pending held answers and queued presses are released with `gate_error`; nothing is persisted from
them. No timer survives.
