# Spec 215: architecture sketch

**Status**: Idea, 2026-11-22. To be worked out before phase 1.

- `src/script-recipes/`: QuickJS host, API bindings, scenario runner, `RecipeDefinition` adapter, store.
- `src/ai-builder/`: agent loop against the provider API, with tools `describe_home`,
  `describe_api`, `submit_script`, `run_scenarios`. The same tools can later be exposed as an MCP
  server for users who prefer their own Claude or ChatGPT (needs a scoped API token; Sowel reachable
  from the provider for web clients).
- `ui/`: the page, the key in Settings, the draft and observing states on recipe rows.
- `migrations/`: one table for script recipes, one row per version.
