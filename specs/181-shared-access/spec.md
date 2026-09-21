# Spec 181 — Shared access: let someone open a gate, for a while

**Status**: proposed — spec only, for review before any code
**Scope**: an opt-in core feature, off by default. Gates only (`gate` equipments) in this spec.

## Problem

A household regularly needs to let **someone who is not a Sowel user** open a gate or a garage door
for a while: a child coming home from school, a tradesperson on Tuesday, a neighbour watering the
plants in August, the guests of a holiday let. Today the options are to hand over a remote, to give
out a Sowel account (which opens everything), or to open it yourself from your phone.

What is wanted is narrower than an account and safer than a remote: **a code or a link, valid for a
period and at certain hours, that opens only the gates it names, that can be held or revoked in one
click, and that leaves a journal.**

## Why in the core, and not as a plugin

Sowel's rule since spec 053 is that integrations and recipes are plugins. This was first built that
way — a plugin, a recipe and a core PR ([#969](https://github.com/mchacher/sowel/pull/969)) — and
the attempt is the argument:

1. **It needed three new core capabilities with a single consumer**: plugin pages in the SPA, an
   anonymous HTTP tree for plugins, and a card on an equipment's page. Generic in name, justified by
   one plugin.
2. **A plugin may not actuate an equipment**, rightly. So the opening went through a recipe, with a
   hand-made protocol between the two (a request counter, the target gate written just before it, a
   JSON catalogue of the house's gates pushed back down, an answer order). Three packages to install
   and wire for one feature, and a protocol that exists only because of the boundary.
3. **The anonymous surface is the security-sensitive part**, and it is safer written once, in the
   core, with its own rate limiting, headers and tests, than opened generically to any plugin.
4. **It is not specific to anyone.** Children, tradespeople, neighbours, guests: it is the same
   feature, like the timed command (spec 174) and the confirmation before action (spec 146), which
   are core features on the same `gate` equipments.

It is **opt-in and off by default**: an installation that never enables it sees no page, no card
and no public URL, and nothing in its behaviour changes. What stays out of the core is anything
specific to a booking system: a guestFlow connector is a plugin, feeding accesses through the API in
R9 (see _Consumers_).

## Vocabulary

- **Shared access** (_Accès partagés_): the feature.
- **Access**: one person's right to open — a label, a code, the gates it opens, a validity.
- **Gate** (in this spec): a `gate` equipment on which shared access has been turned on.
- **Phone**: a device that has been set up on an access from its code; it keeps a token.

## Functional rules

### R1 — Opt-in

1. A core setting `sharedAccess.enabled`, **false by default**, turned on and off in Settings by an
   admin. Audit-logged.
2. While it is off: no navigation entry, no card on equipment pages, every shared-access API route
   and the public page answer **404** — the same 404 as an unknown route, so the feature cannot be
   probed from outside. The data is kept; turning it back on restores everything as it was.

### R2 — Gates

3. Shared access is turned on **per gate**, from the gate's own page (a panel beside « Confirmation
   avant action ») or from the shared-access page (« + portail », a choice among the house's `gate`
   equipments). Only `gate` equipments are offered in this spec.
4. Each gate carries an **armed switch**, on its own page. Disarmed, a press is refused and the
   phone is told the house refused it; the accesses are kept. Disarming the garage does not affect
   the entrance gate.
5. Each gate carries **the command to send** (alias and value), defaulting to its first `gate`
   order binding — `command` / `pulse` on a standard impulse gate. Per gate, because two gates of
   one house need not take the same order.
6. Turning shared access off on a gate is refused while an access still able to open depends on it
   alone (`gate_in_use`). Deleting the equipment removes the gate and every access forgets it.

### R3 — Accesses

7. An access carries a **label** (required), **the gates it opens** (at least one, `no_gate`
   otherwise), and a **kind**: `manual` (made on the page) or `external` (made by a plugin, R9).
8. **The code** is eight characters of Crockford base32 without I, L, O, U, shown `4K7M-9QT2`,
   compared with dashes, spaces and case stripped and those four letters folded onto what they are
   mistaken for. It is **unique among everything that can still open** — it identifies the access on
   its own. It is **kept in clear**: someone whose phone is flat must be read their code over the
   telephone, which a hash forbids. It is nulled seven days after the access ends.
9. **One « Change the code »**, with a choice: a new code that keeps the phones already set up (the
   lost email), or one that also cuts them off (the lost phone).
10. **Validity**: always, or a period (from, until) on the Paris wall clock — the house's clock.
    Optional **time windows** every day (`08:00–20:00`), not crossing midnight, not overlapping.
    An external access carries its source's window; the owner may **widen** it only — open earlier,
    extend later.
11. **Hold / resume**, **revoke**, and **delete only once revoked or ended** (`still_live`
    otherwise): deleting a live access used to be revoking and erasing the line in one click. The
    journal outlives the access.

### R4 — When a press opens

12. In order: not revoked → not suspended → inside the validity → inside a time window if any →
    the gate is one the access lists (`not_this_gate`) → the gate is armed (`refused_by_house`) →
    under the ceilings. **The decision comes first**: a refused press never reaches the gate.
13. **Ceilings**: 12 opens per hour per access, 30 per hour per gate.
14. Two presses of the same access within two seconds are one press. Presses queue per gate.
15. **The core sends the gate's command itself**, through `EquipmentManager.executeOrder`, so it
    inherits inversion (spec 154), value resolution (spec 150) and delivery confirmation (spec 141).
    The order is attributed in the Activity feed to « Accès partagé — <label> ».
16. **The gate's state never reaches the phone.** The page is pollable by anyone holding a code; a
    button reading « Fermer » is a state display wearing a verb.

### R5 — The public page

17. Served by the core at **`/access/`**, a few kilobytes of HTML, CSS and JavaScript of its own —
    not the SPA, not a framework — with `default-src 'none'`-style CSP, `X-Robots-Tag: noindex`,
    `Cache-Control: no-store` and no cookie. Its API is `/api/v1/shared-access/public/*`, the only
    shared-access routes outside authentication, rate-limited per IP.
18. The invitation link carries the code **in the fragment** (`/access/#i=…`), which no server,
    proxy or log sees; it is consumed once and removed from the address bar. An **alias** (another
    host name rewriting to `/access/`) is supported: a public base URL and path set in Settings build
    the links.
19. A phone keeps its **own token**; only its SHA-256 is stored. More than six phones on one access
    raises an alarm — information, never a block.
20. The control is **Sowel's slide-to-confirm** (spec 146), one per gate the access opens, titled by
    the equipment's name when there are several. Nothing is said on success: the slide turns green
    with a check and returns to rest after two seconds, since the same gesture closes the gate
    behind you. The page speaks only when the gate will not move.
21. French by default, English when the phone asks. Words assume no holiday let. Before a code is
    typed, the title names a door only if the house has one gate.

### R6 — Guessing codes

22. **A correct code is never refused by the anti-guessing budget.** The code is looked up first;
    only failures are counted, **globally** — behind a reverse proxy the core sees the proxy's
    address, not the visitor's, so « N tries per IP » would be N tries for the whole internet.
    Ten failures in ten minutes are free, then each failing answer is held back 1 s, 2, 4, 8, up to
    10 s. Past 25 failures in the window the owner is alerted once. A code tried ten times is locked
    for an hour. Per-visitor counting needs trusted-proxy configuration and is a separate spec.

### R7 — The owner's page

23. **« Accès partagés » in the main navigation**, after Analyse — used day to day, not configured
    once. Admin-only.
24. **A tab per gate**, « Tous » once there are two, « + portail ». On « Tous » each line says which
    gates it opens.
25. Each line: label, code, validity, hours, phones, last use; Sowel's icons for **copy the link**,
    **edit**, **hold / resume**, and **« ⋯ »** for change the code, this access's journal, revoke (or
    delete, once revoked or ended).
26. **The period is picked in order**: « Valable » (always / for a period); the day from a calendar
    where every day before the start is struck; the time from two standard lists, **hours and
    minutes in steps of five**, the values before the start disabled on its day. Moving the start
    past the end carries the end along, keeping the length.
27. A header line says what the owner cannot otherwise know: each gate's contact, whether it is
    armed, whether the public page is reachable (base URL set), and the external sources' state.

### R8 — On the gate's own page

28. A panel **« Accès partagés »** beside « Confirmation avant action », admin-only: turned off, a
    button to turn it on; turned on, the **armed switch**, the **command** (R2.5), and « 3 personnes
    peuvent ouvrir ce portail avec un code » with a link to that gate's tab.

### R9 — Accesses from elsewhere (plugins)

29. A plugin may create, update and revoke **external** accesses through `deps.sharedAccess`, keyed
    by `(pluginId, externalId)` — idempotent, so replaying a feed changes nothing. It sets the label,
    the window and, optionally, the gates (the first gate otherwise); the owner's widening and gate
    choices are never taken back by a later update. A plugin sees and touches **only its own**
    accesses, and reads back the invitation (code and link) of each, to send it through its own
    channel.
30. While the feature is off, `deps.sharedAccess` answers every call with a `disabled` error: the
    plugin can say so on its own page, and nothing is created behind the owner's back.

### R10 — Housekeeping

31. Codes nulled seven days after the access ended; journal lines kept a year, bounded in count.

## Consumers

- **A guestFlow connector plugin** (separate repository and spec) — the first user of R9: a stay
  becomes an external access, and the invitation is sent back to guestFlow for its guest emails.
  It is meant as the start of a broader guestFlow ↔ Sowel link (for instance, reservations of a
  given lodging acting on that lodging's equipments), which is that plugin's business and needs
  nothing more from this spec.

## Out of scope

- Per-visitor anti-guessing (trusted proxies) — its own spec: it concerns all of Sowel.
- Non-admin users managing accesses.
- Equipment types other than `gate` (locks, doors): the model does not depend on the type, the
  offer does.
- A QR code rendered by the core, SMS sending, guest accounts.
- Days of the week on time windows.

## Acceptance criteria

- [ ] With the setting off, no entry, no card, and `/access/` and every route answer 404.
- [ ] A gate is turned on from its page or from « + portail », armed, with its own command.
- [ ] A correct code sets a phone up even after forty wrong codes, without delay.
- [ ] A press on a listed, armed gate inside the validity sends the gate's command through
      `executeOrder`; every refusal of R4.12 sends nothing and tells the phone why.
- [ ] The phone never receives the gate's state.
- [ ] « Jusqu'au » cannot be picked before « À partir du »; the server refuses it too.
- [ ] A plugin's external access is idempotent, and a later update keeps the owner's widening.
- [ ] Nothing is persisted outside SQLite; the data rides in the backup.

## Migration and compatibility

A new migration, a new setting (off), new routes. Nothing existing changes. The plugin and recipe of
the first attempt were never released; there is no data to carry over.
