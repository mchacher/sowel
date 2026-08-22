# Spec 157 — Implementation plan

1. **Pin the current behaviour.** Write `LiveDiagram.test.tsx` against the
   v1.53.0 implementation. It must be green before anything moves.
2. **Extract.** `flow-geometry.ts` (routes, slots, cadence, types) then
   `FlowDiagram.tsx` (component only). Per-instance ids via `useId`.
3. **Refactor Live.** Rebuild `LiveDiagram` as a caller. Re-run step 1's test —
   it must still be green, untouched.
4. **Test the component.** `FlowDiagram.test.tsx`: skeletons, overlays, edge
   direction, id uniqueness, bubble staggering, node anatomy, pills, tag.
5. **Read the UPS.** `readUpsBindings` + `upsMarginOf` in `upsStatus.ts`.
6. **Rebuild the panel.** Diagram, margins card, technical sheet.
7. **Translate.** 46 keys, EN + FR.
8. **Test the panel.** On mains, during an outage, margins, sheet.
9. `npm run validate`, then the docs and the PR.
