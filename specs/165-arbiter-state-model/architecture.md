# Architecture — spec 165

## Where the state is decided today, and where it moves

Today the same six situations are resolved twice, in two languages, on two
sides of the wire:

|             | Roster                                            | Ribbon                                          |
| ----------- | ------------------------------------------------- | ----------------------------------------------- |
| Resolved in | `ui/src/components/energy/ArbitrationSurface.tsx` | `src/energy/arbiter-timeline.ts`                |
| From        | four arrays of `ArbiterPublicState`               | the persisted decision journal                  |
| Into        | `RosterRow["stateKey"]`                           | `ArbiterQuarterState`                           |
| Colour      | `STATE_COLOR`                                     | `cellColor`                                     |
| Words       | `arbiter.rosterState.*`                           | `arbiter.timeline.state.*` + `arbiter.legend.*` |

The ribbon's model is the right one to keep: it is already in the engine, it is
already exhaustive over the journal, and it is what spec 164 extended. The
roster's model is the one that goes away — it is UI-side business logic that
happens to be a state machine.

So the direction is: **`ArbiterQuarterState` is promoted to
`ArbiterLoadState`, and `getPublicState()` resolves each load's current state
into it.** The ribbon keeps replaying the journal (it has to; it is history),
but both now speak one vocabulary and share one colour source.

## Data model

### `src/shared/types.ts`

```ts
/** Spec 165 — the state of one flexible load, now or in a past time step.
 *  Shared by the roster table and the timeline ribbon. */
export type ArbiterLoadState =
  | "granted"
  | "granted-idle" // spec 164 — granted, measured not consuming
  | "pending"
  | "unmanaged"
  | "suspended"
  | "idle";

/** A time step additionally carries `revoked`: an EVENT inside the step, which
 *  wins the cell over the sustained state. It is never a current state. */
export type ArbiterQuarterState = ArbiterLoadState | "revoked";
// The union is shared; the ribbon simply never emits `suspended` (a
// suspension still paints idle/unmanaged there, see the spec's non-goals).

/** Spec 165 — one roster row, resolved by the engine. Replaces the browser-side
 *  flattening of grants/pending/suspensions/idle. */
export interface ArbiterLoadInfo {
  equipmentId: string;
  equipmentName: string;
  state: ArbiterLoadState;
  /** Granted: the reserved watts. Pending/idle: what it draws when it runs. */
  watts: number | null;
  /** Pending only: `watts + engageMarginW - toleratedImportW`. */
  needW: number | null;
  toleratedImportW: number | null;
  /** Granted: since when. */
  sinceIso?: string;
  /** Pending: the stable reason code the UI translates. */
  reasonWaiting?: string;
  /** Suspended: when the arbiter takes the load back. */
  untilIso?: string;
  instanceId?: string;
  note?: string;
}
```

`ArbiterPublicState` gains `loads: ArbiterLoadInfo[]` (priority order, FR-2) and
`dormant: boolean` (FR-4). The four existing arrays stay, byte-identical,
marked `@deprecated` with the removal spec named in the comment (FR-7).

## State resolution

One function in `capacity-arbiter.ts`, next to `getPublicState()`, applied to
every id in `config.priority` that still has a profile:

```
resolveLoadState(id, dormant):
  suspended?                         -> "suspended"
  granted claim?                     -> drawState.get(id) === false
                                          ? "granted-idle" : "granted"
  pending claim?
      unclaimedRunning.has(id)       -> "unmanaged"
      dormant                        -> "idle"
      else                           -> "pending"
  unclaimedRunning.has(id)           -> "unmanaged"
  else                               -> "idle"
```

Three things worth spelling out.

**The granted split reads `drawState`, not the measurement** (FR-3). `drawState`
is what spec 164 defined as "what the ribbon currently shows": seeded `true` on
grant, flipped only by a confirmed five-minute observation. Reading the live
measurement here instead would make the roster flicker on a reading the ribbon
has not yet accepted, which is precisely the class of divergence this spec
exists to remove. Absent from the map (no grant yet observed, or no measurement)
means `granted`, matching the ribbon's optimistic start.

**Ordering of the branches is the current behaviour, preserved.** Suspension
first: `getPublicState` already excludes suspended ids from `pending` and
`idle`, on the argument that a suspension is the truthful dominant state for a
load that cannot be granted while suspended. `unmanaged` before `dormant`:
#491's "running (no surplus)" beats #577's night calm, because a load that is
drawing power is never at rest whatever the hour.

**`running` on a pending claim becomes `unmanaged`, not a separate state.** The
roster's current `running` pill ("Hors surplus") and the ribbon's `unmanaged`
("Marche hors arbitrage") describe the same thing: the load is drawing outside
any grant. The distinction the roster was drawing — whether a claim happens to
exist behind it — is visible in the row's figures and in the journal, and does
not deserve a state of its own. This is the one user-visible relabel in the
spec.

## Dormancy

`isArbiterDormant` (`ui/src/components/energy/arbiterColors.ts`) moves into the
engine. It needs `isDaylight`, which the arbiter does not have today; the
`SunlightManager` already exposes `getSunlightData()` and is constructed at
`src/index.ts:295`, before the arbiter at `:363`, so it is injected as a further
optional constructor dependency, following the `journalStore` / `surplusStore`
precedent:

```ts
constructor(..., surplusStore?: ArbiterSurplusStore, sunlight?: SunlightManager)
```

Optional, because the arbiter is constructed without it in a hundred tests and
in no case should a missing sun source change arbitration. Absent sunlight, or
`isDaylight === null` (no home coordinates), means never dormant — the current
fallback, unchanged.

The ribbon applies dormancy to the **current quarter only** (FR-4). Past
quarters are a journal replay and must stay a faithful record: a claim that was
genuinely waiting at 14:00 stays yellow at 14:00 forever, whatever the sun is
doing at render time. Concretely `buildLoadTimelines` takes an optional
`dormant` flag and rewrites the last cell only, when it is `pending`.

## UI

`ArbitrationSurface` loses `RosterRow`, `STATE_COLOR`, the flattening of the
four arrays and the `p.running ? ... : dormant ? ... : ...` expression. It maps
`state.loads` to rows and renders. `isArbiterDormant` and its test are deleted
along with the `useZoneAggregation` dependency the surface only had in order to
compute it.

`arbiterColors.ts` keeps one state->colour source, in two tables:

```ts
const HUE: Record<ArbiterQuarterState, string>; // solid — the pill's text and dot
const CELL_FILL: Record<ArbiterQuarterState, string>; // the ribbon's blocks
export function loadStateColor(s: ArbiterQuarterState): string; // HUE
export function cellColor(s: ArbiterQuarterState): string; // CELL_FILL
```

The split is not cosmetic: the pill uses its colour as TEXT and re-mixes it at
15% for its own background, so a pre-blended fill (`PENDING_FILL` and friends)
would render the word at ~15% alpha on a ~2% background. `CELL_FILL` reads the
same hues and dims only the background states, so nothing is declared twice.
`journalDotColor` stays as it is: it maps decision kinds, not states.

### Copy

One root per state (FR-6), replacing three families:

| Key                              | FR                        | EN                      |
| -------------------------------- | ------------------------- | ----------------------- |
| `arbiter.loadState.granted`      | Accordé                   | Granted                 |
| `arbiter.loadState.granted-idle` | Accordé (ne consomme pas) | Granted (not consuming) |
| `arbiter.loadState.pending`      | En attente                | Waiting                 |
| `arbiter.loadState.unmanaged`    | Marche (hors arbitrage)   | Running (unmanaged)     |
| `arbiter.loadState.suspended`    | Suspendu                  | Suspended               |
| `arbiter.loadState.idle`         | Au repos                  | At rest                 |
| `arbiter.loadState.revoked`      | Surplus retiré            | Surplus withdrawn       |

Two arbitrations settled here: `idle` is "Au repos" everywhere ("Éteint" claimed
knowledge of the load's power state that `idle` does not carry), and the granted
legend loses its "(surplus)" qualifier, which existed only to disambiguate it
from the roster's identically-worded pill.

`arbiter.rosterState.*`, `arbiter.timeline.state.*`, `arbiter.legend.granted`,
`arbiter.legend.grantedIdle`, `arbiter.legend.grantedShort`,
`arbiter.legend.pending`, `arbiter.legend.revoked` and `arbiter.legend.unmanaged`
are removed from both locales. `arbiter.legend.surplusDeficit` stays — it labels
the curve, not a state. `locale-completeness.test.ts` gets one exhaustive map
instead of two.

## Metrics, API and compatibility

No metric changes: `sustainedAfter` is untouched, so no time moves between the
spec 158 buckets.

`GET /api/v1/energy/arbiter/state` gains two fields and loses none (FR-7). No
new endpoint, no migration, no persisted-shape change: `ArbiterLoadState` is a
render-time union over rows the journal already contains, so history written
before this spec replays identically.
