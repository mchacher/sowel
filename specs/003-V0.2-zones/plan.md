# Implementation Plan: V0.2 Zones + Equipment Groups

## Tasks

### Backend

1. [ ] **Types** — Add Zone, EquipmentGroup, ZoneWithChildren interfaces and EngineEvent types to `src/shared/types.ts`
2. [ ] **Migration** — Create `migrations/002_zones.sql` (zones + equipment_groups tables)
3. [ ] **Database** — Update `src/core/database.ts` to load new migration
4. [ ] **Zone Manager** — Create `src/zones/zone-manager.ts`:
   - CRUD operations (create, getById, getAll, update, delete)
   - Build tree structure from flat list
   - Circular reference detection on parentId update
   - Delete guards (no children, no groups)
5. [ ] **Group Manager** — Create `src/zones/group-manager.ts`:
   - CRUD operations (create, getByZoneId, getById, update, delete)
   - Delete guard (no equipments — placeholder for V0.3)
6. [ ] **Zone API routes** — Create `src/api/routes/zones.ts`:
   - GET /zones, GET /zones/:id, POST /zones, PUT /zones/:id, DELETE /zones/:id
   - GET /zones/:zoneId/groups, POST /zones/:zoneId/groups
7. [ ] **Group API routes** — Create `src/api/routes/groups.ts`:
   - PUT /groups/:id, DELETE /groups/:id
8. [ ] **Register routes** — Update `src/api/server.ts` to register zone and group routes
9. [ ] **Initialize** — Update `src/index.ts` to create zone manager on startup
10. [ ] **WebSocket** — Update `src/api/websocket.ts` to broadcast zone/group events

### Frontend

11. [ ] **Types** — Add Zone, EquipmentGroup, ZoneWithChildren to `ui/src/types.ts`
12. [ ] **API functions** — Add zone/group API calls to `ui/src/api.ts`
13. [ ] **Zustand store** — Create `ui/src/store/useZones.ts`
14. [ ] **WebSocket** — Update `ui/src/store/useWebSocket.ts` to handle zone/group events
15. [ ] **Zone tree components** — Create `ui/src/components/zones/ZoneTree.tsx` + `ZoneTreeNode.tsx`
16. [ ] **Zone form** — Create `ui/src/components/zones/ZoneForm.tsx` (create/edit modal)
17. [ ] **Group components** — Create `ui/src/components/zones/GroupList.tsx` + `GroupForm.tsx`
18. [ ] **Zones page** — Create `ui/src/pages/ZonesPage.tsx`
19. [ ] **Zone detail page** — Create `ui/src/pages/ZoneDetailPage.tsx`
20. [ ] **Routes** — Update `ui/src/App.tsx` with zone routes
21. [ ] **Sidebar** — Enable Zones nav item in `ui/src/components/layout/Sidebar.tsx`

### Testing & Validation

22. [ ] **Unit tests** — Zone manager tests (CRUD, tree, circular ref, delete guards)
23. [ ] **Unit tests** — Group manager tests (CRUD, delete guard)
24. [ ] **TypeScript** — `npx tsc --noEmit` passes (zero errors, backend)
25. [ ] **TypeScript** — `cd ui && npx tsc --noEmit` passes (zero errors, frontend)
26. [ ] **All tests** — `npm test` passes

### Documentation

27. [ ] Update `specs/003-V0.2-zones/spec.md` — mark acceptance criteria
28. [ ] Update `docs/implementation-status.md` — mark V0.2 done

## Dependencies

- Requires V0.1 to be completed (✅ done)
- No external dependencies

## Testing

### Manual verification

1. Start engine: `npm run dev`
2. Start UI: `cd ui && npm run dev`
3. Navigate to `/zones`
4. Create root zone "Maison"
5. Create child zones: "RDC", "Étage" under "Maison"
6. Create rooms: "Salon", "Cuisine" under "RDC"
7. Create a group "Volets Sud" in "Salon"
8. Verify tree displays correctly
9. Edit zone name, icon, description
10. Try deleting zone with children → should fail
11. Delete empty zone → should succeed
12. Open second browser tab → verify WebSocket sync
