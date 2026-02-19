# V0.2: Zones + Equipment Groups

## Summary

Implement the spatial topology layer of Corbel. Users can define hierarchical Zones (Home → Floor → Room) and Equipment Groups within Zones. This establishes the structure into which Equipments will be placed in V0.3.

## Reference

- Data model: [docs/data-model.md](../../docs/data-model.md) — §3 Zone, §4 Equipment Group
- Spec: [docs/corbel-spec.md](../../docs/corbel-spec.md) — §5.4 Zone, §7.5 Zone API

## Acceptance Criteria

### Zone CRUD (Backend)

- [ ] Create a zone with name, parentId (optional), icon, description, displayOrder
- [ ] Read a zone by ID (returns zone with children and groups)
- [ ] List all zones as a tree structure (nested JSON)
- [ ] Update a zone (name, icon, description, displayOrder, parentId)
- [ ] Delete a zone (only if it has no children and no equipments)
- [ ] Moving a zone (changing parentId) validates no circular reference
- [ ] Zone IDs are UUID v4
- [ ] All dates in ISO 8601

### Equipment Group CRUD (Backend)

- [ ] Create a group within a zone (name, icon, description, displayOrder)
- [ ] List groups for a zone
- [ ] Update a group (name, icon, description, displayOrder)
- [ ] Delete a group (only if it has no equipments)
- [ ] Deleting a zone cascades to delete its groups

### API Endpoints

- [ ] `GET /api/v1/zones` — returns full zone tree
- [ ] `GET /api/v1/zones/:id` — returns zone with children and groups
- [ ] `POST /api/v1/zones` — create zone
- [ ] `PUT /api/v1/zones/:id` — update zone
- [ ] `DELETE /api/v1/zones/:id` — delete zone (with guard)
- [ ] `GET /api/v1/zones/:zoneId/groups` — list groups in zone
- [ ] `POST /api/v1/zones/:zoneId/groups` — create group in zone
- [ ] `PUT /api/v1/groups/:id` — update group
- [ ] `DELETE /api/v1/groups/:id` — delete group (with guard)

### Database

- [ ] Migration creates `zones` table
- [ ] Migration creates `equipment_groups` table
- [ ] Foreign keys and constraints enforced

### UI — Zones Page

- [ ] Zones page accessible from sidebar navigation
- [ ] Display zone tree with expand/collapse
- [ ] Show zone name, icon, description, number of children, number of groups
- [ ] Create zone via modal/form (name, parent, icon, description)
- [ ] Edit zone inline or via modal
- [ ] Delete zone with confirmation dialog
- [ ] Drag-and-drop reordering (or up/down arrows for displayOrder)
- [ ] Empty state when no zones exist

### UI — Zone Detail Page

- [ ] Show zone details (name, icon, description, parent breadcrumb)
- [ ] List child zones with navigation
- [ ] List equipment groups with CRUD (create, edit, delete)
- [ ] Edit zone name inline
- [ ] Navigate back to parent zone

### UI — General

- [ ] Sidebar shows "Zones" navigation enabled (currently disabled)
- [ ] WebSocket events for zone/group changes update UI in real-time
- [ ] Loading and error states

### Tests

- [ ] Zone CRUD unit tests (zone-manager)
- [ ] Group CRUD unit tests
- [ ] Circular reference detection test
- [ ] Delete guards (zone with children, zone with groups)
- [ ] API route tests
- [ ] TypeScript compiles with zero errors (backend + frontend)

## Scope

### In Scope

- Zone entity: CRUD, tree hierarchy, persistence
- EquipmentGroup entity: CRUD, belongs to zone, persistence
- REST API for zones and groups
- UI: zones page (tree view), zone detail page, group management
- WebSocket events for real-time sync
- SQLite migration

### Out of Scope (deferred)

- Zone aggregated data (V0.3+ — requires Equipments first)
- Zone auto-orders (allOff, allLightsOff — V0.3+)
- Equipment assignment to zones (V0.3)
- Device.zoneId update from zone UI (stays manual via device edit)
- Zone-based scenario triggers/conditions (V0.7)

## Edge Cases

- **Circular reference**: Moving zone A under zone B when B is a descendant of A → reject
- **Delete zone with children**: Reject with error "Zone has X child zones"
- **Delete zone with groups**: Reject with error "Zone has X groups" (or cascade? → we reject)
- **Delete group with equipments**: Reject (guard for V0.3 when equipments exist)
- **Root zones**: Multiple root zones allowed (parentId: null)
- **Empty tree**: No zones → UI shows empty state with "Create your first zone" CTA
- **Deep nesting**: No hard limit on depth, but UI tree should handle 4-5 levels gracefully
- **Duplicate names**: Allowed (different zones can have the same name)
- **Moving zone changes subtree**: Moving a zone moves all its descendants
