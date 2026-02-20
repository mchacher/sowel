# Shutter Equipment Controls & Aggregation

## Summary

Add full shutter (volet) support: UI controls (Open/Stop/Close buttons + position display) in the Home view CompactEquipmentCard, and zone-level aggregation (shuttersOpen/shuttersTotal + average position) displayed in the ZoneAggregationHeader pill.

## Reference

- Spec sections: §5.2 (DataCategory `shutter_position`), §5.3 (EquipmentType `shutter`, order aliases), §3.3 (zone aggregated data), §14.6 (equipment cards), §14.7 (icon: `ArrowUpDown`)
- data-model.md: §3.3 (shuttersOpen, shuttersTotal, averageShutterPosition), §3.4 (zone auto-orders)

## Acceptance Criteria

- [ ] CompactEquipmentCard renders Open/Stop/Close buttons for `shutter` equipment type
- [ ] CompactEquipmentCard displays current position percentage for shutters
- [ ] Open button sends `executeOrder(id, "state", "OPEN")`
- [ ] Close button sends `executeOrder(id, "state", "CLOSE")`
- [ ] Stop button sends `executeOrder(id, "state", "STOP")`
- [ ] Buttons are disabled during order execution (optimistic lock)
- [ ] ZoneAggregatedData includes `shuttersOpen`, `shuttersTotal`, `averageShutterPosition`
- [ ] Zone aggregator computes shutter aggregation from `shutter_position` bindings
- [ ] Open threshold: position > 0 (z2m convention: 0=closed, 100=open)
- [ ] ZoneAggregationHeader displays shutter pill when shuttersTotal > 0
- [ ] Pill format: icon + "X/Y" (open/total) when shutters present, with average position
- [ ] TypeScript compiles with zero errors (backend + frontend)
- [ ] All existing tests pass
- [ ] New unit tests for shutter aggregation

## Scope

### In Scope

- Shutter controls in CompactEquipmentCard (Home view)
- Shutter zone aggregation (backend + frontend)
- Shutter pill in ZoneAggregationHeader

### Out of Scope

- Tilt control (not common on z2m devices, deferred)
- Position slider (user chose buttons only)
- Zone auto-orders (allShuttersOpen/Close — deferred to scenario engine)
- EquipmentDetailPage shutter controls (separate feature)

## Edge Cases

- Shutter equipment with no `state` order binding → hide Open/Close/Stop buttons
- Shutter with no `position` data binding → show buttons only, no percentage
- Position value is null/undefined → display "—" instead of percentage
- Multiple shutters in zone, some with null position → AVG ignores nulls
- Zone with 0 shutters → no pill displayed
