# Architecture: V0.8 Recipe Engine + Motion-Light Recipe

## Data Model

### New Types (src/shared/types.ts)

```typescript
// Recipe slot definition (metadata for UI/API)
interface RecipeSlotDef {
  id: string;                    // "zone", "light", "timeout"
  name: string;                  // Display name
  description: string;           // Help text
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean";
  required: boolean;
  defaultValue?: unknown;
  constraints?: {
    equipmentType?: EquipmentType;
    min?: number;
    max?: number;
  };
}

// Recipe metadata (returned by API)
interface RecipeInfo {
  id: string;                    // "motion-light"
  name: string;
  description: string;
  slots: RecipeSlotDef[];
}

// Persisted recipe instance
interface RecipeInstance {
  id: string;                    // UUID
  recipeId: string;              // "motion-light"
  params: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

// Log entry
interface RecipeLogEntry {
  id: number;
  instanceId: string;
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
}
```

### New Event Bus Events

```typescript
| { type: "recipe.instance.created"; instanceId: string; recipeId: string }
| { type: "recipe.instance.removed"; instanceId: string; recipeId: string }
| { type: "recipe.instance.started"; instanceId: string; recipeId: string }
| { type: "recipe.instance.stopped"; instanceId: string; recipeId: string }
| { type: "recipe.instance.error"; instanceId: string; recipeId: string; error: string }
```

## SQLite Schema (migration 005_recipes.sql)

```sql
CREATE TABLE recipe_instances (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  params JSON NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recipe_state (
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (instance_id, key)
);

CREATE TABLE recipe_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  message TEXT NOT NULL,
  level TEXT DEFAULT 'info'
);

CREATE INDEX idx_recipe_log_instance ON recipe_log(instance_id, timestamp DESC);
```

## Architecture

### Recipe Base Class

```typescript
// src/recipes/recipe.ts

interface RecipeContext {
  eventBus: TypedEventEmitter;
  equipmentManager: EquipmentManager;
  zoneAggregator: ZoneAggregator;
  logger: Logger;
  state: RecipeStateStore;           // Scoped to this instance
  log: (message: string, level?: "info" | "warn" | "error") => void;  // Write to recipe_log
}

abstract class Recipe {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly slots: RecipeSlotDef[];

  // Validate params before starting. Throw if invalid.
  abstract validate(params: Record<string, unknown>, ctx: RecipeContext): void;

  // Start the recipe instance. Subscribe to events, set up timers.
  abstract start(params: Record<string, unknown>, ctx: RecipeContext): void;

  // Stop the recipe instance. Unsubscribe events, clear timers. Must be idempotent.
  abstract stop(): void;
}
```

### RecipeManager

```typescript
// src/recipes/recipe-manager.ts

class RecipeManager {
  private registry: Map<string, Recipe>;          // recipe id → Recipe class instance
  private running: Map<string, RunningInstance>;   // instance id → { recipe, unsubs, timers }

  constructor(db, eventBus, equipmentManager, zoneAggregator, logger) {}

  // Called on engine startup
  init(): void {
    // Register all built-in recipes
    this.register(new MotionLightRecipe());
    // Restore enabled instances from DB
    // Call start() on each
  }

  // API: list available recipes
  getRecipes(): RecipeInfo[] {}

  // API: list active instances
  getInstances(): RecipeInstance[] {}

  // API: create and start a new instance
  createInstance(recipeId: string, params: Record<string, unknown>): RecipeInstance {}

  // API: stop and delete an instance
  deleteInstance(instanceId: string): void {}

  // API: get instance execution log
  getLog(instanceId: string, limit?: number): RecipeLogEntry[] {}

  // Engine shutdown
  stopAll(): void {}
}
```

### RecipeStateStore

```typescript
// src/recipes/recipe-state-store.ts

class RecipeStateStore {
  constructor(private db: Database, private instanceId: string) {}

  get(key: string): unknown | null {}      // Read from recipe_state
  set(key: string, value: unknown): void {} // Write to recipe_state
  delete(key: string): void {}
  clear(): void {}                          // Delete all state for this instance
}
```

## Motion-Light Recipe

### File: src/recipes/motion-light.ts

```typescript
class MotionLightRecipe extends Recipe {
  readonly id = "motion-light";
  readonly name = "Éclairage auto sur mouvement";
  readonly description = "Allume la lumière sur détection de mouvement, éteint après un délai sans mouvement. Gère aussi l'allumage manuel.";
  readonly slots = [
    { id: "zone",    name: "Zone",    type: "zone",     required: true, description: "Zone à surveiller" },
    { id: "light",   name: "Lumière", type: "equipment", required: true, description: "Lumière à contrôler",
      constraints: { equipmentType: "light_onoff" } },
    { id: "timeout", name: "Timeout", type: "duration",  required: true, description: "Délai sans mouvement avant extinction",
      defaultValue: "10m" },
  ];

  private timer: NodeJS.Timeout | null = null;
  private unsubs: (() => void)[] = [];
  private ctx!: RecipeContext;
  private params!: { zoneId: string; lightId: string; timeoutMs: number };

  validate(params, ctx) {
    // Check zone exists and has motion sensors
    // Check light equipment exists and has "state" order
  }

  start(params, ctx) {
    this.ctx = ctx;
    this.params = parseParams(params);

    // Listen to zone aggregation changes (for motion)
    this.unsubs.push(
      ctx.eventBus.on("zone.aggregation.changed", this.onZoneChanged)
    );

    // Listen to light state changes (for manual on/off)
    this.unsubs.push(
      ctx.eventBus.on("equipment.data.changed", this.onLightChanged)
    );

    ctx.log("Recipe démarrée");
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.unsubs.forEach(fn => fn());
    this.unsubs = [];
    this.timer = null;
  }

  private onZoneChanged = (event) => {
    if (event.zoneId !== this.params.zoneId) return;
    const motion = event.data.motion;
    const lightOn = this.isLightOn();

    if (motion && !lightOn) {
      this.turnOn();
    } else if (motion && lightOn) {
      this.resetTimer();
    } else if (!motion && lightOn) {
      this.startTimer();
    }
  };

  private onLightChanged = (event) => {
    if (event.equipmentId !== this.params.lightId) return;
    if (event.category !== "light_state") return;

    const lightOn = event.value === true || event.value === "ON";
    const motion = this.hasMotion();

    if (lightOn && !motion) {
      this.startTimer();
      this.ctx.log("Lumière allumée (externe) → extinction dans " + this.formatTimeout());
    } else if (lightOn && motion) {
      this.resetTimer();
    } else if (!lightOn) {
      this.cancelTimer();
      this.ctx.log("Lumière éteinte (externe) → timer annulé");
    }
  };
}
```

## Event Flow

```
MQTT (PIR occupancy=true)
  → device.data.updated
  → equipment.data.changed (motion sensor)
  → zone-aggregator recomputes → zone.aggregation.changed (motion=true)
  → MotionLightRecipe.onZoneChanged()
  → isLightOn() ? resetTimer() : turnOn()

MQTT (wall switch state=ON)
  → device.data.updated
  → equipment.data.changed (light, category=light_state)
  → MotionLightRecipe.onLightChanged()
  → hasMotion() ? resetTimer() : startTimer()
```

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/recipes` | List available recipe definitions |
| GET | `/api/v1/recipes/:recipeId` | Get recipe definition with slots |
| GET | `/api/v1/recipe-instances` | List all active instances |
| POST | `/api/v1/recipe-instances` | Create instance `{ recipeId, params }` |
| DELETE | `/api/v1/recipe-instances/:id` | Stop and delete instance |
| GET | `/api/v1/recipe-instances/:id/log` | Get execution log (query: `?limit=50`) |

## File Changes

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add RecipeSlotDef, RecipeInfo, RecipeInstance, RecipeLogEntry, recipe events |
| `migrations/005_recipes.sql` | New tables: recipe_instances, recipe_state, recipe_log |
| `src/recipes/recipe.ts` | NEW — Abstract base class, RecipeContext interface |
| `src/recipes/recipe-manager.ts` | NEW — Registry, instance lifecycle, DB persistence |
| `src/recipes/recipe-state-store.ts` | NEW — Key-value state per instance |
| `src/recipes/motion-light.ts` | NEW — First recipe implementation |
| `src/api/routes/recipes.ts` | NEW — REST endpoints |
| `src/api/server.ts` | Register recipe routes |
| `src/api/websocket.ts` | Broadcast recipe events |
| `src/index.ts` | Initialize RecipeManager after ZoneAggregator |
