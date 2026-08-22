# Spec 157 — Shared FlowDiagram, and the UPS panel rebuilt on it

## Context

Spec 156 shipped a `ups` equipment type whose detail panel was a flat list: 29
rows of equal weight, labelled with the integration's raw aliases, five boolean
flags permanently reading `false`, and the remaining autonomy given the same
visual weight as the firmware date. It was complete and unreadable.

Meanwhile Energy · Live (spec 148) already owns a diagram that answers exactly
the question a UPS asks. It routes power between a load and two sources, keeps
the whole circuit faintly visible, lights only the branches carrying energy,
and names the state in one word. That surface is good, tested in production —
and inlined in a single page component, so nothing else can use it.

## The mapping

A UPS and a solar installation pose the same problem: **two sources, one load,
and a path that switches.** The topology transfers term for term.

| Energy · Live                     | UPS panel                  |
| --------------------------------- | -------------------------- |
| Maison — focal, top               | Protected load             |
| Réseau — left                     | Mains                      |
| Production — right                | Battery                    |
| Réseau → Maison                   | Mains → load (normal)      |
| Production → Maison               | Battery → load (outage)    |
| Production → Réseau — bottom loop | Mains → battery (charging) |

The last row is the one that settles it. The bottom loop carries solar export
one way; it carries the battery charge the other. The NUT plugin already
reports a `charging` flag, so the branch has a real signal to light.

## Goals

1. Extract the Live diagram into a reusable `FlowDiagram` component, with the
   Energy page rendering **identically** afterwards.
2. Rebuild the UPS panel on it.
3. Keep spec 156's non-redundancy rule: every value appears exactly once.

## Non-Goals

- Changing anything the Energy page shows. This is an extraction, not a
  redesign of that surface.
- Orders on the UPS. Still read-only, for the reasons spec 156 gives.
- A third consumer. The component is shaped by two real cases, not speculation.

## Functional Requirements

### FR1 — FlowDiagram owns the shape, callers own the meaning

The component owns the viewBox, the three node slots, the Manhattan routes, the
always-visible skeleton, the active overlay, the bubbles, the pill placement
and the status tag. Callers supply formatted values, colours, which edges are
active and in which direction. **The diagram never formats a number.**

The bottom edge exists in both directions (`rightToLeft`, `leftToRight`): same
drawn shape, opposite traversal, so the bubbles run the right way for each
surface.

Motion-path ids are per-instance (`useId`). They were hardcoded while the
diagram lived in one page; two diagrams on a page would have collided.

### FR2 — The Energy page is unchanged

Byte-for-byte identical rendering: same paths, same strokes, same labels, same
formatting, same pills, same status tag. A characterization test written
against the pre-extraction implementation is the judge.

### FR3 — The UPS panel

Three stacked cards, matching the Live page's own rhythm:

1. **The diagram.** Mains voltage, load in watts, battery percentage — one live
   value per node, plus the autonomy as the battery's sub-line. During an
   outage the mains node reads _absent_ and dims, the battery branch lights in
   the status severity colour, and the autonomy moves onto that branch as a
   pill — where the solar page puts its share-of-supply percentage.
2. **Margins & thresholds.** Only scales and limits, none of which appear in
   the diagram: the transfer window with the live reading's position, the
   output capacity with the load fill, and the shutdown thresholds. A one-word
   summary in the header — comfortable / tight / critical.
3. **Technical sheet.** The nameplate, collapsed, with translated labels.

### FR4 — Labels, not aliases

Every field is translated EN/FR. An unknown alias falls back to itself rather
than rendering blank, so a UPS exposing a field Sowel has no label for still
shows its value.

### FR5 — Flags are conditional, not permanent

A boolean reads `✓` when true and `—` when false, and never the word `false`.

## Acceptance Criteria

1. The Energy · Live page renders identically before and after the extraction,
   proven by a test written before it.
2. A UPS on mains lights the mains branch only; during an outage it lights the
   battery branch only.
3. The charge loop lights only when the UPS reports `charging`.
4. Autonomy renders as a duration everywhere, never a second count.
5. No value shown in the diagram or the margins card reappears in the sheet.
6. A UPS reporting no thresholds hides the margins card rather than showing an
   empty one.
7. Two FlowDiagrams on one page do not share motion-path ids.

## Edge Cases

| Case                                    | Expected behaviour                             |
| --------------------------------------- | ---------------------------------------------- |
| Unit reports load in % but not in watts | Focal node shows the percentage                |
| Unit reports no transfer window         | That row is dropped, the card keeps the others |
| Unit reports no thresholds at all       | Margins card is not rendered                   |
| Flow below the animation floor          | Route stays lit, no bubbles                    |
| Status outside the enum                 | Raw value shown in the tag, neutral colour     |
