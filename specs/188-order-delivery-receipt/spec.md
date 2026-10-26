# Spec 188: Order outcome from reported state

**Status**: Approved (2026-10-26) — implemented on PR #1088
**Depends on**: spec 141 (order confirmation tracker), spec 181 (shared access), spec 146 (gate)
**System spec**: `domotique-lora/specs/command-confirmation.md` (what each LoRa node reports)
**Replaces**: the first version of this spec (a `device.order.receipt` plugin event fed by new
LoRa receipt frames). Rejected on 2026-10-26: it changed the nodes, the dongle, the bridge and the
plugin. This version changes the core only.

## Problem

`executeOrder` resolving means the order reached the integration. Spec 141 then watches the
equipment's state for the ordered value, but two common orders are exempt and therefore silent:

- **A gate impulse** (`command` = `pulse`) has no mirror value: nothing says "pulse happened".
  A lost gate command is invisible end to end. The guest who presses the gate in the
  shared-access PWA reads « Commande envoyée » either way, and the journal records `opened`.
- **A cover order whose state speaks another vocabulary** (`CLOSE` ordered, `CLOSED` reported) is
  exempt on purpose, so that covers reporting only `OPEN` / `CLOSE` never false-alarm. The LoRa
  coop door reports `OPENING` / `OPEN` / `CLOSING` / `CLOSED` / `FAULT`, which is exactly what
  would prove the order, and it is ignored.

Both devices already report the state that proves the order moved something: the gate's
position sensor (`closed`; on Adrien's gate an inductive sensor behind an optocoupler), the
coop's limit switches (`door`, `pos`). The core only has to read it.

## Goals

1. Confirm a gate impulse from the transition it must cause, and a cover order from the end
   state it must reach, using data the devices report today.
2. Show the outcome where the person who gave the order looks: the dashboard tile (desktop,
   mobile, timed tile), the detail page, an alarm with a push, and for a guest press, the guest
   PWA and the shared-access journal.
3. Zero change to nodes, dongle, bridge or plugins.

## Non-goals

- **No automatic resend, ever**, for the orders this spec tracks. A second impulse reverses a
  gate. This also takes them out of spec 141's reconnect re-dispatch and out of the #702
  integration-connect replay (O9).
- No distinction between "command lost" and "command applied but nothing moved": the state
  cannot tell them apart (see Limits).
- No persistence across a restart: an outcome pending at restart is dropped, as in spec 141.
- No travel time setting for gates: the windows below are constants.

## Functional design

### O1 — Two new tracking kinds in the spec 141 tracker

The tracker today knows one kind: _mirror_ (the ordered value must appear on the mirror). It
gains two, chosen at dispatch, before the existing confirmability test:

| Kind         | Applies to                                                                           | Proof expected                                                    |
| ------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `transition` | equipment type `gate`, order value `pulse` (case-insensitive), gate state known (O2) | the gate state flips: closed → open, or open → closed             |
| `end_state`  | equipment type `shutter`, value `OPEN` or `CLOSE`, end-state vocabulary seen (O4)    | `OPEN` → `OPEN` or position 100; `CLOSE` → `CLOSED` or position 0 |

Any other order keeps spec 141's behaviour unchanged. An order that matches neither new kind and
is exempt today stays exempt.

### O2 — Gate impulse (`transition`)

At dispatch the tracker reads the gate state: the equipment's `closed` binding, or its `state`
binding (`open` / `closed`) when there is no `closed`.

| State at dispatch                                              | Expected                 | Window | Confirmed               | Not confirmed                                                    |
| -------------------------------------------------------------- | ------------------------ | ------ | ----------------------- | ---------------------------------------------------------------- |
| closed                                                         | open (`closed` = false)  | 15 s   | « Ouverture confirmée » | « Pas de mouvement : commande perdue ou portail bloqué »         |
| open                                                           | closed (`closed` = true) | 60 s   | « Fermeture confirmée » | « Toujours ouvert : commande perdue ou portail arrêté en route » |
| unknown (no value, or every device behind the binding offline) | —                        | —      | —                       | exempt: no line, no alarm, today's behaviour                     |

- Only the value `pulse` (case-insensitive) is a gate impulse. Any other value sent to a gate
  (`OPEN`, `CLOSE`, a number) is outside this spec and keeps spec 141's behaviour.
- 15 s: from closed, the gate's sensor reports it open within 1–2 s of the impulse; 15 s covers
  the radio retries and a heartbeat-only report.
- 60 s: from open, a pulse may close, stop or reverse the gate. The real travel is about 34 s;
  60 s covers a reversal followed by a full close. Nothing observable happens before `closed`.
- Only the first flip counts. A gate that opens and closes again inside the window was
  confirmed at the opening.

### O3 — Cover / door (`end_state`)

Reported `door` / state value at the mirror, after the order:

| Report                                                     | Status      | Line                                                           |
| ---------------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| target (`OPEN` / `CLOSED`), or position 100 / 0            | `confirmed` | « Ouverte » / « Fermée » confirmée, then gone                  |
| the moving value toward the target (`OPENING` / `CLOSING`) | `moving`    | « En mouvement… »                                              |
| `FAULT`                                                    | `fault`     | « Défaut » + reason from the `why` key when the device has one |
| anything else (`UNKNOWN`, opposite end, heartbeat)         | unchanged   | the window keeps running                                       |

- **Already at target** at dispatch: confirmed at once (same as spec 141).
- **`STOP`**: exempt, as today.
- **Window 60 s** (the coop motor cut-off is 50 s; a descent is cut at 15 s and latches
  `FAULT` / `BOTTOM`, which arrives well inside the window).
- `fault` is terminal for this order: the device answered and refused to finish.

### O4 — When the end-state mapping is safe (the rule)

`CLOSE` → `CLOSED` is enabled for an equipment **only when its mirror has shown it speaks the
end-state vocabulary**: the mirror (the binding or device key spec 141 resolves for the order)
has reported at least one of `CLOSED`, `OPENING`, `CLOSING` or `FAULT` — words that are never
commands — either as its current value at dispatch or at any time since the tracker started
(kept in memory per device and key).

Consequences:

- A Zigbee2MQTT cover reporting `OPEN` / `CLOSE` never shows one of those words, so it stays
  exempt and nobody starts receiving false alarms.
- A device that reports `CLOSED` (the coop) is tracked from its first such report.
- Position alone is never enough to enable the mapping: some covers invert or never reach 0 / 100
  exactly. Position confirms only once the mapping is enabled by the vocabulary.

### O5 — Statuses

The tracker emits `equipment.order.outcome { equipmentId, orderAlias, value, status, detail?,
source }` on every status change of a tracked order (O1 kinds only), broadcast on the WebSocket.

| Status        | When                               | Tile / detail line                                       | Lasts                 |
| ------------- | ---------------------------------- | -------------------------------------------------------- | --------------------- |
| `pending`     | dispatch                           | spinner « Envoyée… »                                     | until the next status |
| `moving`      | `OPENING` / `CLOSING` (cover only) | spinner « En mouvement… »                                | until the next status |
| `confirmed`   | O2 / O3 proof                      | « ✓ Ouverture confirmée » / « ✓ Fermeture confirmée »    | 4 s, then nothing     |
| `fault`       | `FAULT` reported                   | « Défaut » (+ « : contact bas », « : câblage »…)         | until the next order  |
| `unconfirmed` | window elapsed                     | gate: the O2 wording alone; cover: « Sans confirmation » | until the next order  |

For a gate the unconfirmed line is the O2 wording on its own (« Pas de mouvement : commande
perdue ou portail bloqué » / « Toujours ouvert : commande perdue ou portail arrêté en route »),
which already says it is unconfirmed; « Sans confirmation » is the line of a cover order. A `why`
of `NONE` is no reason: the line reads « Défaut » alone.

The line is live UI state from the WebSocket; a reload shows nothing until the next order. A
spinner with no final status is dropped 70 s after dispatch and on a WebSocket reconnect. On the
mobile card it comes in addition to the state summary (a gate still reads Ouvert / Fermé).

### O6 — Alarm

`unconfirmed` and `fault` raise spec 141's alarm `order-unconfirmed:<equipmentId>:<alias>`,
level `warning`, pushed by the existing pipeline. Wording through `messageKey` /
`messageParams` (`alarms.orderOutcome.*`, e.g. « Portail : toujours ouvert après la commande —
perdue ou arrêtée en route », « Porte du poulailler : défaut (contact bas) »).

Where each surface gets its words:

| Surface                    | Language                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| Banner, Activity feed      | the viewer's UI language, from `messageKey`                                    |
| Web Push                   | each subscription's owner's language preference (`users.preferences.language`) |
| Telegram, logs (`message`) | English: the same specific text (« Portail: still open after the command … »)  |

There is no instance-wide language setting; the per-user preference is the only one, and a
Web Push subscription belongs to a user. Telegram has no recipient user, so it gets the English
`message`, which now says what the gate or door did instead of the generic « Order not
confirmed ». The server holds a copy of the `alarms.orderOutcome.*` strings (EN + FR) for the
push; a test keeps it identical to the UI's. A push from a localized alarm drops the source
prefix (« ⚠️ Portail : … », not « ⚠️ order-confirmation : … »).

Only the core's own `order-confirmation` source is worded from a key: a `messageKey` on any other
alarm is ignored by the UI, the Activity feed and the push, and stripped from plugin-emitted
alarms.

- **Re-wording**: an alarm already standing (inherited from an earlier order, see below) is
  raised again, same id, when the new tracked order meets something it words differently (a
  FAULT after an unconfirmed). The same wording is never raised twice.
- **Fault reason**: a FAULT's alarm waits 1 s for the device's `why`, another key of the same
  report, so that it is pushed once, worded with the reason. A reason landing later re-words it.
- **Recovery**: the resolution of a tracked order's alarm is keyed too
  (`alarms.orderOutcome.recovered`, « Portail : l'état attendu est finalement arrivé »).

Resolution follows spec 141: a later report that reaches the expected state resolves it (the
gate finally opens / closes, the door finally reports the target), including after the window. A
new order supersedes the pending one and inherits its alarm; supersession alone never resolves
it.

A late report confirms the line and the guest's row only within 5 min after the window
(`LATE_OUTCOME_GRACE_MS`): a gate report lost on the radio comes back with the next 60 s
heartbeat, but a flip hours later is someone else's doing. The alarm is resolved by the expected
state whenever it comes.

### O7 — Second order

A second **tracked** order on the same equipment and alias replaces the first: the first's window
is cancelled and its outcome is never shown. For a gate the new order reads the gate state afresh
(it may be moving). The shared-access queue already serialises presses per gate.

A second order that is **exempt** proves nothing, so it does not erase what the first can still
prove:

- **gate** — the engine marks a gate's `state` « unknown » from a pulse until the next sensor
  report, so a second pulse inside the window of the first is exempt when the gate is read
  through `state`. The first order keeps its window, its timer and its alarm; its outcome still
  comes, and its guest row still gets it.
- **cover** — a `STOP` while the door travels: the order it interrupted can no longer reach its
  end state, because of the person who stopped it. Its line ends as `unconfirmed` at once,
  **without** an alarm. One that already has an alarm, or a final status, is left as it is.

### O8 — Shared access

- **The guest page shows the outcome of its own gate press, and nothing else.** It learns it
  through that press's journal row. An outcome for any other equipment (the coop, a light) can
  reach neither the page nor its journal.
- The journal row gains an `outcome` column (`pending` / `confirmed` / `unconfirmed`, plus
  `expected`: `open` / `close`), NULL when the press was exempt (state unknown). A press
  replaced by a newer tracked order on the gate (O7) goes back to NULL instead of staying
  `pending`; one already `unconfirmed` keeps it. Presses are followed by their own id, so an
  exempt press after a tracked one leaves the first one's outcome to land on its row.
- `POST open` returns `{ ok: true, outcome: "pending", expected: "open" | "close", windowS }`
  when tracked; `windowS` is the core's window for that press (15 from closed, 60 from open).
- The guest page reads the session every 2 s for 70 s after the press, as long as its press is
  not `confirmed` (a late state turns an `unconfirmed` into `confirmed`):
  - `confirmed` → pill « Ouverture confirmée » / « Fermeture confirmée », journal the same;
  - `unconfirmed` → pill « Sans confirmation », message « Regardez le portail avant de
    réessayer : il a peut-être bougé. » Never an invitation to press again. Journal:
    « Ouverture demandée · sans confirmation » or « Fermeture demandée · sans confirmation »,
    after the direction the core expected; a press still pending reads « Ouverture demandée » /
    « Fermeture demandée ».
  - exempt → today's « Commande envoyée », journal « Ouverture demandée ».
- **The disc stays locked while the press's outcome is pending.** The travel bar runs over the
  longer of the travel (`travelS`, 30 s) and `windowS`, so from an open gate it runs 60 s and the
  disc is not re-armed at 30 s while the first impulse is still unproven. A confirmation that
  comes once the travel has elapsed ends the bar at once; an outcome still pending when the bar
  ends keeps the disc locked until it comes (at most the 70 s follow).
- A command that failed on the way (`gate_error`, the 15 s queue timeout included) reads « Pas
  de réponse du portail : regardez-le avant de réessayer, il a peut-être bougé. »: the impulse
  may have been dispatched, so the page never simply says « Réessayez ».
- The admin journal shows the same outcome next to each `opened` row.
- `countUse` is unchanged: a press counts when it is sent.

### O9 — No replay for tracked orders

Orders of kind `transition` or `end_state` are created with `retried = true`, so neither spec
141's reconnect re-dispatch nor #702's integration-connect replay can send them again.

An order that failed to reach its integration (#702) is **not held at all** when it is a gate
impulse (whatever the gate state, known or not) or a cover order the state could have proven, or
when a tracked order is still open on the same equipment and alias. It is never replayed, and it
is not surfaced as an outcome either: « no confirmation » 60 s later would read as a command lost
on the way, when it was never sent. Its caller already got the dispatch error (the guest page
shows `gate_error`), and the integration's `order-fail` alarm stands. Whatever was pending on the
equipment — a tracked order still in its window, its alarm — is left exactly as it was.

## Limits (what the state cannot say)

- **Lost vs. applied without motion**: a gate that did not move may have missed the command or
  received it with the motor blocked. Both read the same.
- **Open gate**: a pulse on an open gate may stop it mid-way. It stays open and Sowel cannot tell
  that from a lost command. Only « Toujours ouvert : perdue ou arrêtée en route » is honest.
- **Someone else moved it**: a remote, a button or the auto-close recipe flipping the gate inside
  the window confirms the order. Accepted: the gate did what was asked.
- **The proof is physical motion**: what is confirmed is that the gate or door moved, which is
  what the person wanted to know.

## Edge cases

- Gate state report lost (radio) but the gate moved: the 60 s heartbeat brings the new state; if
  it arrives after the window the order goes `unconfirmed` then is resolved by the late state.
- Gate already moving when pressed (state open): treated as open; 60 s window.
- Coop node answers `UNKNOWN` (stopped mid-way by cut-off): not a target, the window runs out,
  « Sans confirmation ».
- Device offline at dispatch: `transition` is exempt (state unknown); `end_state` follows spec
  141's `device_offline` fast path.
- Core restart with an outcome pending: dropped, nothing shown, guest row stays `pending` →
  shown as « Ouverture demandée » / « Fermeture demandée » in the journal.

## Acceptance criteria

- [x] `transition` kind per O2, `end_state` kind per O3, chosen per O1.
- [x] O4 vocabulary guard: a cover that never reported `CLOSED` / `OPENING` / `CLOSING` / `FAULT`
      is still exempt (test with a Zigbee2MQTT-like cover).
- [x] `equipment.order.outcome` emitted and broadcast on WS.
- [x] Alarm raised on `unconfirmed` / `fault`, resolved by a later expected state, not by
      supersession; localized EN + FR.
- [x] Tile (desktop, mobile, timed) + detail status line per O5, EN + FR.
- [x] Shared-access journal `outcome` column (migration), `open` returns it, guest page per O8,
      served page is the core's `src/shared-access/guest-page.ts`.
- [x] O9: tracked orders never re-dispatched (device reconnect and integration connect).
- [x] No change in behaviour for any order outside O1 (spec 141 suite green unchanged).
- [x] Tests per plan.md.
