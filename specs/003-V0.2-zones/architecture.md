# Architecture: V0.2 Zones + Equipment Groups

## Data Model Changes

### New types in `src/shared/types.ts`

```typescript
// Zone
interface Zone {
  id: string;
  name: string;
  parentId: string | null;
  icon?: string;
  description?: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ZoneWithChildren extends Zone {
  children: ZoneWithChildren[];
  groups: EquipmentGroup[];
}

// Equipment Group
interface EquipmentGroup {
  id: string;
  name: string;
  zoneId: string;
  icon?: string;
  description?: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

### New EngineEvent types

```typescript
| { type: "zone.created"; zone: Zone }
| { type: "zone.updated"; zone: Zone }
| { type: "zone.removed"; zoneId: string; zoneName: string }
| { type: "group.created"; group: EquipmentGroup }
| { type: "group.updated"; group: EquipmentGroup }
| { type: "group.removed"; groupId: string; groupName: string }
```

### New SQLite tables

```sql
-- Migration: 002_zones.sql

CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE equipment_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Event Bus Events

### New events emitted

| Event | When | Payload |
|---|---|---|
| `zone.created` | Zone created via API | `{ zone }` |
| `zone.updated` | Zone modified via API | `{ zone }` |
| `zone.removed` | Zone deleted via API | `{ zoneId, zoneName }` |
| `group.created` | Group created via API | `{ group }` |
| `group.updated` | Group modified via API | `{ group }` |
| `group.removed` | Group deleted via API | `{ groupId, groupName }` |

### Events consumed

None for V0.2. Zone data aggregation (consuming `equipment.data.changed`) comes in V0.3+.

## API Changes

### New endpoints

| Method | Route | Request Body | Response |
|---|---|---|---|
| GET | `/api/v1/zones` | — | `ZoneWithChildren[]` (tree) |
| GET | `/api/v1/zones/:id` | — | `ZoneWithChildren` |
| POST | `/api/v1/zones` | `{ name, parentId?, icon?, description? }` | `Zone` (201) |
| PUT | `/api/v1/zones/:id` | `{ name?, parentId?, icon?, description?, displayOrder? }` | `Zone` |
| DELETE | `/api/v1/zones/:id` | — | 204 |
| GET | `/api/v1/zones/:zoneId/groups` | — | `EquipmentGroup[]` |
| POST | `/api/v1/zones/:zoneId/groups` | `{ name, icon?, description? }` | `EquipmentGroup` (201) |
| PUT | `/api/v1/groups/:id` | `{ name?, icon?, description?, displayOrder? }` | `EquipmentGroup` |
| DELETE | `/api/v1/groups/:id` | — | 204 |

### Validation Rules

**POST /zones:**
- `name`: required, string, 1-100 chars
- `parentId`: optional, must reference existing zone
- `icon`: optional, string
- `description`: optional, string, max 500 chars

**PUT /zones/:id:**
- `parentId`: if provided, must not create circular reference
- Other fields: same validation as POST

**DELETE /zones/:id:**
- Reject if zone has child zones (400: "Cannot delete zone with child zones")
- Reject if zone has equipment groups (400: "Cannot delete zone with groups")

**DELETE /groups/:id:**
- In V0.2: always allowed (no equipments yet)
- In V0.3+: reject if group has equipments

## UI Changes

### New Zustand store: `ui/src/store/useZones.ts`

```typescript
interface ZonesState {
  zones: Record<string, Zone>;
  tree: ZoneWithChildren[];         // Cached tree structure
  groups: Record<string, EquipmentGroup>;
  loading: boolean;
  error: string | null;

  fetchZones: () => Promise<void>;
  createZone: (data: CreateZoneInput) => Promise<Zone>;
  updateZone: (id: string, data: UpdateZoneInput) => Promise<void>;
  deleteZone: (id: string) => Promise<void>;
  createGroup: (zoneId: string, data: CreateGroupInput) => Promise<EquipmentGroup>;
  updateGroup: (id: string, data: UpdateGroupInput) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  // Called by WebSocket handler
  handleZoneCreated: (zone: Zone) => void;
  handleZoneUpdated: (zone: Zone) => void;
  handleZoneRemoved: (zoneId: string) => void;
  handleGroupCreated: (group: EquipmentGroup) => void;
  handleGroupUpdated: (group: EquipmentGroup) => void;
  handleGroupRemoved: (groupId: string) => void;
}
```

### New pages

| Page | Route | Content |
|---|---|---|
| `ZonesPage` | `/zones` | Zone tree view, create button, expand/collapse |
| `ZoneDetailPage` | `/zones/:id` | Zone info, child zones, groups, edit/delete |

### New components

| Component | Location | Purpose |
|---|---|---|
| `ZoneTree` | `components/zones/` | Recursive tree view of zones |
| `ZoneTreeNode` | `components/zones/` | Single node in the tree (expandable) |
| `ZoneForm` | `components/zones/` | Create/edit zone modal form |
| `GroupList` | `components/zones/` | List of groups in a zone |
| `GroupForm` | `components/zones/` | Create/edit group modal form |
| `ZoneIcon` | `components/zones/` | Renders zone icon with fallback |

### Updated files

| File | Change |
|---|---|
| `ui/src/App.tsx` | Add routes `/zones`, `/zones/:id` |
| `ui/src/types.ts` | Add Zone, EquipmentGroup, ZoneWithChildren types |
| `ui/src/api.ts` | Add zone/group API functions |
| `ui/src/store/useWebSocket.ts` | Handle zone/group events |
| `ui/src/components/layout/Sidebar.tsx` | Enable Zones nav item |

## File Changes (Backend)

| File | Change |
|---|---|
| `src/shared/types.ts` | Add Zone, EquipmentGroup, ZoneWithChildren interfaces + events |
| `migrations/002_zones.sql` | Create zones + equipment_groups tables |
| `src/core/database.ts` | Load new migration |
| `src/zones/zone-manager.ts` | **NEW** — Zone CRUD + tree building + circular ref detection |
| `src/zones/group-manager.ts` | **NEW** — EquipmentGroup CRUD |
| `src/api/routes/zones.ts` | **NEW** — Zone API routes |
| `src/api/routes/groups.ts` | **NEW** — Group API routes |
| `src/api/server.ts` | Register new routes |
| `src/index.ts` | Initialize zone manager |
