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
