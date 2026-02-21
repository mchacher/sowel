# Implementation Plan: V0.9 Modes

## Dependencies

- V0.8 Recipes must be complete (mode impacts interact with recipe instances) ✅
- Cron scheduler library: `croner` (lightweight, ESM-compatible)

## Tasks

### Phase 1: Backend — Types & Database

1. [ ] Add Mode types to `src/shared/types.ts` (Mode, ModeEventTrigger, ZoneModeImpact, Calendar types, events)
2. [ ] Create migration `migrations/005-modes.sql` (modes, mode_event_triggers, zone_mode_impacts, calendar_profiles, calendar_slots)
3. [ ] Register migration in `src/core/database.ts`
4. [ ] Install `croner` cron scheduler

### Phase 2: Backend — Mode Manager

5. [ ] Create `src/modes/mode-manager.ts` — Mode CRUD + activation logic
6. [ ] Implement event trigger listener (match equipment.data.changed → activate mode)
7. [ ] Implement zone impact execution (orders, recipe toggles, recipe params)

### Phase 3: Backend — Calendar Manager

8. [ ] Create `src/modes/calendar-manager.ts` — Profile/slot CRUD + cron scheduling
9. [ ] Implement cron job registration from active profile slots
10. [ ] Implement profile switch (unschedule old, schedule new)

### Phase 4: Backend — API & WebSocket

11. [ ] Create `src/api/routes/modes.ts` — REST endpoints for modes + triggers + impacts
12. [ ] Create `src/api/routes/calendar.ts` — REST endpoints for calendar profiles + slots
13. [ ] Register routes in `src/api/server.ts`
14. [ ] Add mode + calendar events to WebSocket broadcast in `src/api/websocket.ts`
15. [ ] Wire ModeManager + CalendarManager into `src/index.ts`

### Phase 5: UI — Mode Display in Behaviors

16. [ ] Create `ui/src/store/useModes.ts` — Zustand store
17. [ ] Create `ui/src/components/home/ZoneModesCard.tsx` — Modes ID card
18. [ ] Add active mode indicators to zone status bar

### Phase 6: UI — Mode Management

19. [ ] Create mode management page (list, create, edit, delete)
20. [ ] Event trigger editor (select equipment + alias + value)
21. [ ] Zone impact editor (configure orders, recipe toggles, param overrides per zone)

### Phase 7: UI — Calendar

22. [ ] Create `ui/src/store/useCalendar.ts` — Zustand store
23. [ ] Create visual weekly calendar component (7 days × 24h timeline)
24. [ ] Profile selector (Travail / Vacances tabs)
25. [ ] Slot editor (add/edit/remove time slots with mode selection)

### Phase 8: Testing

26. [ ] Unit tests for ModeManager (CRUD, activation, event trigger matching)
27. [ ] Unit tests for CalendarManager (slot scheduling, profile switch)
28. [ ] TypeScript compilation (zero errors backend + frontend)
29. [ ] Manual testing with real MQTT (button trigger activates mode)

## Testing

### Manual verification

1. Create modes "Confort Chauffage" and "Cocoon" via API
2. Add event trigger on "Cocoon" (button press)
3. Add zone impacts for Salon (heating setpoint, recipe toggle)
4. Create calendar slot: Lun-Ven 08:00 → "Confort Chauffage"
5. Wait for cron to fire → verify heating setpoint changes via MQTT
6. Press button → verify "Cocoon" activates and impacts execute
7. Switch profile Travail → Vacances → verify schedule changes
8. Verify modes appear in UI Behaviors section
9. Verify calendar visual editor works
10. Activate/deactivate from UI → verify equipment orders execute
