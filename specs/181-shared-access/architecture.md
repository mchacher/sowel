# Spec 181 — Architecture

## Where it sits

```
 phone ── /access/ (static page) ── /api/v1/shared-access/public/*  (no session)
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
| `codes.ts`                 | The code alphabet and folding, the link and phone tokens and their hashes                           |
| `guessing.ts`              | The failure budget, the held answer, the cap on answers held at once, the alert (R6)                |
| `phones.ts`                | How the owner tells phones apart: platform from the user agent, a tag drawn from the id (R5.19)     |
| `gate-queue.ts`            | Per-gate queue, double-press window, 15 s order timeout, at most 5 presses waiting (R4.14)          |
| `guest-page.ts`            | The public page's HTML, CSS, JS and manifest, as strings — including the pull-to-open disc (R5.20)  |
| `plugin-api.ts`            | `deps.sharedAccess`, scoped to the calling plugin (R9)                                              |

The house's wall clock (`home.timezone`) reuses the core's existing time-zone helpers (spec 061).

## Data model

`migrations/035_shared_access.sql`:

```sql
-- Spec 181 — shared access: let someone who is not a Sowel user open a gate,
-- for a while, with a code or a link.
--
-- Nothing is added to `equipments` (review [1]): a gate carries no
-- configuration of its own. What a press sends is on the access–gate link, and
-- whether a gate is armed is a row in `shared_access_disarmed`. Every link to an
-- equipment cascades on its deletion, which is R2.6's cleanup.

-- R9 — what a plugin's accesses open. The owner decides, the plugin only picks.
CREATE TABLE shared_access_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  plugin_id     TEXT,                          -- the one plugin it is granted to; NULL = none
  is_default    INTEGER NOT NULL DEFAULT 0,    -- R9.33: exactly one, never deleted
  valid_from    INTEGER,                       -- epoch ms; NULL/NULL = « Tout le temps »
  valid_until   INTEGER,
  time_windows  TEXT NOT NULL DEFAULT '[]',    -- JSON [{from,to}] 'HH:MM'; [] = « Toute la journée »
  with_code     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

-- A profile's gates. A table rather than a JSON column so that deleting the
-- equipment cascades here too (R2.6), like it does on an access.
CREATE TABLE shared_access_profile_gates (
  profile_id    TEXT NOT NULL REFERENCES shared_access_profiles(id) ON DELETE CASCADE,
  equipment_id  TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  value         TEXT,                          -- JSON; NULL = what the gate's button sends (R2.5)
  PRIMARY KEY (profile_id, equipment_id)
);

CREATE TABLE shared_accesses (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('manual', 'external')),
  label           TEXT NOT NULL,
  code            TEXT,                        -- clear, optional, nulled 7 days after the end (R3.8)
  link_version    INTEGER NOT NULL DEFAULT 1,  -- bumped by « Change the code »
  link_token_hash TEXT NOT NULL UNIQUE,        -- SHA-256 of the link's own token (R3.8)
  valid_from      INTEGER,                     -- epoch ms, in force; NULL = open-ended
  valid_until     INTEGER,
  source_plugin   TEXT,                        -- external only
  external_id     TEXT,
  profile_id      TEXT REFERENCES shared_access_profiles(id) ON DELETE SET NULL,
  source_from     INTEGER,                     -- the source's dates, external only
  source_until    INTEGER,
  early_open_at   INTEGER,                     -- owner's widening of an external access
  extended_until  INTEGER,
  time_windows    TEXT NOT NULL DEFAULT '[]',
  suspended_at    INTEGER,
  revoked_at      INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT NOT NULL,
  last_used_at    INTEGER,
  use_count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_plugin, external_id)
);
-- R3.8: a code identifies its access on its own.
CREATE UNIQUE INDEX idx_shared_accesses_code ON shared_accesses(code) WHERE code IS NOT NULL;

CREATE TABLE shared_access_gates (
  access_id     TEXT NOT NULL REFERENCES shared_accesses(id) ON DELETE CASCADE,
  equipment_id  TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  value         TEXT,                          -- JSON; NULL = what the gate's button sends (R2.5)
  PRIMARY KEY (access_id, equipment_id)
);

-- R2.4: a row = that gate refuses every press.
CREATE TABLE shared_access_disarmed (
  equipment_id  TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  disarmed_at   INTEGER NOT NULL,
  disarmed_by   TEXT NOT NULL
);

CREATE TABLE shared_access_phones (
  id            TEXT PRIMARY KEY,
  access_id     TEXT NOT NULL REFERENCES shared_accesses(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT NOT NULL
);

-- No foreign keys: « who came in that night » outlives the access (R3.11).
CREATE TABLE shared_access_journal (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  access_id     TEXT,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- opened, refused, enrolled, created, ...
  reason        TEXT,
  actor         TEXT,
  equipment_id  TEXT,
  phone_id      TEXT                           -- R5.22: « Vos commandes » are this phone's own
);
CREATE INDEX idx_sa_journal_at ON shared_access_journal(at);
CREATE INDEX idx_sa_journal_access ON shared_access_journal(access_id, at);
CREATE INDEX idx_sa_journal_phone ON shared_access_journal(phone_id, at);
```

Nothing is added to `equipments`. A gate has no configuration of its own: what a press sends is on
the access (`shared_access_gates.value`, NULL on an impulse gate), and whether the gate is armed is a
row in `shared_access_disarmed`. A profile's gates are a table too rather than a JSON column, so that
`ON DELETE CASCADE` gives R2.6's cleanup for free on accesses and profiles alike.

**Why the code is in clear.** R3.8. The phone's token and the link's token, which nobody dictates,
are the hashed secrets.

**How the link can be shown again.** The owner copies an access's link from its line at any time,
and a plugin reads its invitation back — so the raw token must be recoverable, while R3.8 stores
only its hash. The token is therefore derived, not random:
`HMAC-SHA256(sharedAccess.linkSecret, "<accessId>:<linkVersion>")` sliced to 22 base64url
characters (`deriveLinkToken` in `codes.ts`), from a per-house secret generated on first use. The
secret lives in the `settings` table but is **never returned** by `GET /api/v1/settings`, **cannot
be written** through `PUT /api/v1/settings`, and is out of every plugin's settings scope. It rides
in the backup like every setting, so **a backup can rebuild every live link**: it is to be kept
like a key. The table keeps `link_token_hash` for the lookup; « Change the code » bumps
`link_version`, which changes the token and kills the old link.

`migrations/036_shared_access_tombstones.sql` adds `shared_access_tombstones (plugin_id,
external_id, deleted_at)`: deleting an external access keeps its key, so a later upsert of the same
stay answers `revoked` instead of creating a fresh access (R9.34). Purged with the journal, after a
year. The same migration indexes the journal by gate and by access for the ceilings of R4.13.

## Events

On the bus: `shared_access.opened`, `shared_access.refused`, `shared_access.changed` (any owner or
plugin write, for the SPA over WebSocket). `system.alarm.raised` under source `shared-access` for the
guessing alert (R6) and the phone count (R5.19), which is what reaches notifications.

`OrderSource` (spec 101) gains `{ kind: "shared_access"; accessId: string; label: string }`, so the
Activity feed names the access without a lookup and keeps naming it once the access is deleted.

## API

Admin (`/api/v1/shared-access`, 404 while disabled, like an unknown route):

| Method | Path                                    |                                                                                                 |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/state`                                | accesses shaped for the page, groups, gates, sources                                            |
| GET    | `/journal?accessId=`                    |                                                                                                 |
| POST   | `/accesses`                             | `{ label, gates: [{ equipmentId, value? }], withCode?, validFrom?, validUntil?, timeWindows? }` |
| PATCH  | `/accesses/:id`                         | same fields; external: `earlyOpenAt`, `extendedUntil`                                           |
| POST   | `/accesses/:id/{suspend,resume,revoke}` |                                                                                                 |
| POST   | `/accesses/:id/code`                    | `{ cutPhones }` — a new code (if it has one) and a new link                                     |
| DELETE | `/accesses/:id`                         | 422 `still_live` unless revoked or ended                                                        |
| GET    | `/equipment/:id`                        | the panel's line: armed, count of people able to open                                           |
| PUT    | `/equipment/:id`                        | `{ armed }`                                                                                     |
| GET    | `/profiles`                             | the profiles and the plugin each is granted to                                                  |
| POST   | `/profiles`                             | `{ name, gates, validFrom?, validUntil?, timeWindows?, withCode?, pluginId? }`                  |
| PATCH  | `/profiles/:id`                         | same fields                                                                                     |
| DELETE | `/profiles/:id`                         | the accesses made from it keep their gates                                                      |

Public (`/api/v1/shared-access/public`, no session, added to `isPublicRoute`; while disabled it
answers an anonymous caller 401, which is what any unknown `/api` route answers to one, and with a
`Bearer` header the auth middleware's own answer, so the build cannot be told apart from one
without shared access;
the same handlers are also served under the page as `/access/api/*`, which the page calls by a
relative path so that an alias host rewriting everything to `/access/` needs no second rule):
`POST /enrol { code } | { link }`, `GET /session`, `POST /open { gate }`, `GET /share` (the
invitation link and its QR code, drawn server-side with the backend's existing `qrcode`
dependency) — the phone's token as a bearer. An enrolment on an access that already has 50 phones
answers `409 too_many_phones` (R5.19).
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
  /** The profiles the owner granted to this plugin — names only, never the gates. */
  profiles(): Array<{ id: string; name: string; isDefault: boolean; complete: boolean }>;
  upsert(
    externalId: string,
    input: {
      profileId?: string; // the default profile when omitted (R9.33)
      label: string;
      from: string | null; // date and hour, house clock: "2026-10-03T16:00"
      until: string; // required: a plugin's key always ends (R9.34)
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

Throws `SharedAccessDisabledError` while the setting is off, `UnknownProfileError` for a profile not
granted to this plugin, `ProfileIncompleteError` while the profile lists no gate, `NoEndError`
without `until`, and a `SharedAccessError` with code `revoked` (409) on a stay the owner revoked,
or deleted (the tombstone of R9.34). Scoped: another plugin's accesses and profiles do not exist for this one.

## UI

| File                                                 |                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ui/src/pages/SharedAccessPage.tsx`                  | the page (tabs, lines, menu, dialogs)                                                                        |
| `ui/src/components/shared-access/*`                  | line, editor, date-time picker, gate picker, change-code dialog, profile editor, invitation with its QR code |
| `ui/src/components/equipments/SharedAccessPanel.tsx` | R8, mounted beside `GateConfirmationPanel`                                                                   |
| `ui/src/pages/SettingsPage.tsx`                      | the opt-in switch and the public address                                                                     |
| Sidebar / mobile drawer                              | the entry, shown only while enabled                                                                          |

« Créer un accès » stands next to the tabs (R7.27): on a gate's tab it creates on that gate, with a
single gate in the house on it, otherwise it opens the gate picker first.

The invitation (`Invitation.tsx`: editor, after creation, after a code change) draws the link as a
QR code in the browser with the `qrcode` package, the one new runtime dependency of the UI: small,
no network, and the link carries the access's token, so it must never go to a third-party
renderer.

EN/FR strings in the locale files, like every other page.

## Shutdown

Pending held answers and queued presses are released with `gate_error`; nothing is persisted from
them. No timer survives. The same `gate_error` ends a press whose gate order has not answered within
15 s, and a press finding 5 already waiting on its gate is refused with `busy` (R4.14).
