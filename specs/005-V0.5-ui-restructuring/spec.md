# V0.5: UI Restructuring

## Summary

Reorganize the UI sidebar into two distinct sections: **Maison** (a dynamic zone treeview for daily use) and **Settings** (configuration pages). When the user selects a zone in the Maison treeview, the main panel displays its equipments as compact cards grouped by type, with live state and controls.

## Reference

- Spec sections: V0.5 (winch-spec.md lines 1241-1257)
- Design system: §15 (winch-spec.md)

## Acceptance Criteria

- [ ] Sidebar has two visually separated sections: "Maison" and "Settings"
- [ ] Maison section shows a dynamic zone treeview loaded from the API
- [ ] Zone treeview supports expand/collapse for nested zones
- [ ] Clicking a zone in the treeview navigates to a zone view in the main panel
- [ ] Zone view displays equipments as compact cards (icon + name + primary value + control)
- [ ] Equipments in zone view are grouped by type (Eclairages, Volets, Capteurs...)
- [ ] Equipment controls work in-place (toggle, slider) with live WebSocket updates
- [ ] Settings section contains: Devices, Equipments, Home Topology
- [ ] Scenarios item appears in Settings section, disabled/grayed
- [ ] Dashboard item is removed from navigation
- [ ] Zone treeview updates in real-time when zones are created/updated/removed via WebSocket
- [ ] Default route redirects to Maison (first zone or empty state)
- [ ] TypeScript compiles with zero errors
- [ ] All existing tests pass

## Scope

### In Scope

- Sidebar restructuring (two sections with visual separator)
- Dynamic zone treeview in sidebar (loaded from zones API, expand/collapse)
- New zone view page (`/maison/:zoneId`) showing equipments
- Compact equipment card component (one-line: icon + name + value + control)
- Equipment grouping by type in zone view
- Live equipment state via existing WebSocket events
- Routing changes: `/maison/:zoneId` for zone views, default redirect
- Existing Settings pages (Devices, Equipments, Home Topology) unchanged

### Out of Scope

- Computed Data / expression engine (deferred to V0.6)
- Internal Rules (deferred)
- Renaming "Data Bindings" / "Order Bindings"
- Dark mode
- Responsive mobile layout
- Backend API changes (filter client-side)
- Zone aggregation data in zone headers (no aggregation engine yet)

## Edge Cases

- Zone with no equipments: show empty state message ("No equipments in this zone yet")
- Zone deleted while viewing it: redirect to parent zone or Maison root
- No zones exist: show empty state in sidebar treeview ("Create your first zone in Settings > Home Topology")
- Equipment with no data bindings: show card with name + type icon, no value
- Sidebar collapsed mode: treeview hidden, show only icons for Settings items
- WebSocket disconnect: equipment values freeze (existing behavior), reconnect restores
