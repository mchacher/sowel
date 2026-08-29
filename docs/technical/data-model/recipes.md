# Recipes

> **Orchestration**: reusable automation templates distributed as plugins. Users instantiate a recipe by filling in its typed slots; the engine runs the resulting `RecipeInstance`.
>
> See also: [the data model index](../data-model.md) in the data-model index for how recipes are distributed and loaded.

## Recipe

A **Recipe** is a reusable automation template, distributed as a plugin (PackageType `recipe`). Users instantiate a recipe by filling in its **slots** (typed parameters); the engine then runs the resulting `RecipeInstance`.

### 1 Definition (provided by the recipe package)

```typescript
interface RecipeSlotDef {
  id: string;
  name: string;
  description: string;
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean" | "text" | "data-key";
  required: boolean;
  list?: boolean;
  defaultValue?: unknown;
  constraints?: {
    equipmentType?: EquipmentType | EquipmentType[];
    min?: number;
    max?: number;
    crossZone?: boolean; // for `equipment` slots
    includeDescendants?: boolean;
  };
  group?: string;
}

interface RecipeLangPack {
  name: string;
  description: string;
  slots?: Record<string, { name: string; description: string }>;
  groups?: Record<string, string>;
}

interface RecipeActionDef {
  id: string;
  type: "cycle";
  stateKey: string;
  options: { value: string; label: string }[];
}

interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  actions?: RecipeActionDef[];
  i18n?: Record<string, RecipeLangPack>;
  validate(params: Record<string, unknown>, ctx: RecipeContext): void;
  createInstance(params: Record<string, unknown>, ctx: RecipeContext): RecipeInstanceHandle;
}

interface RecipeInstanceHandle {
  stop(): void;
  onAction?(action: string, payload?: Record<string, unknown>): void;
}
```

### 2 Instance, state, log

```typescript
interface RecipeInstance {
  id: string;
  recipeId: string; // matches a registered RecipeDefinition.id
  params: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

interface RecipeLogEntry {
  id: number;
  instanceId: string;
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
}
```

`recipe_state` is a per-instance key/value store (`RecipeStateStore`) used by the recipe code to persist arbitrary state across restarts (e.g. timer deadlines, counter values).

### 3 Helpers exposed to recipe packages

```typescript
interface RecipeHelpers {
  isAnyLightOn(lightIds: string[], ctx: RecipeContext): boolean;
  turnOnLights(lightIds: string[], ctx: RecipeContext): string[];
  turnOffLights(lightIds: string[], ctx: RecipeContext): string[];
  setLightsBrightness(lightIds: string[], ctx: RecipeContext, brightness: number): string[];
  parseDuration(value: unknown): number;
  formatDuration(ms: number): string;
}
```

### 4 SQLite Schema

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

<!-- MISMATCH: types.ts uses level enum "info" | "warn" | "error" with no DB constraint; the SQLite column is plain TEXT defaulting to 'info'. -->

---
