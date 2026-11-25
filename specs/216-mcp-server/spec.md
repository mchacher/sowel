# Spec 216: an MCP server for Sowel

**Status**: Idea, 2026-11-25. Light spec for the roadmap; no code yet.

## Context

People already ask their AI assistant (Claude, ChatGPT, a local model) about their home. The Model
Context Protocol (MCP) is the standard way to hand such an assistant tools. A Sowel MCP server would
let the user's own AI read the home, explain it, act on it within the rights the user grants, and
write recipes (spec 215). It is the user's AI talking to the user's Sowel: no Sowel cloud.

Spec 215 does not need it (its "Create a recipe" page calls the provider from Sowel itself). This
spec is broader: one MCP server for every use, recipes being one domain among others.

## What it offers

| Domain           | Tools                                                                     | Access         | Risk                        |
| ---------------- | ------------------------------------------------------------------------- | -------------- | --------------------------- |
| Home             | `describe_home`, `list_zones`, `list_equipments`                          | Read           | Low (structure only)        |
| Live state       | `get_equipment_state`, `get_zone_state`                                   | Read           | Medium (reveals presence)   |
| History          | `query_history` (temperatures, energy…)                                   | Read           | Medium                      |
| Energy           | `get_energy_summary`, `get_arbiter_status`, `get_tariff`                  | Read           | Low                         |
| Control          | `send_order` (light, shutter, heating)                                    | Write          | High (acts on the physical) |
| Modes            | `get_mode`, `set_mode`                                                    | Read and write | High                        |
| Existing recipes | `list_recipes`, `create_instance`, `update_instance`, `enable`, `disable` | Read and write | High                        |
| AI recipes (215) | `check_script`, `run_scenarios`, `submit_script`, `get_script`            | Drafts only    | Low                         |
| Diagnostics      | `get_logs`, `get_recipe_log`, `get_device_health`, `get_activity`         | Read           | Low to medium               |
| Notifications    | `send_notification`                                                       | Write          | Low                         |
| Administration   | users, plugins, settings, backups                                         | Excluded       | Not exposed                 |

Resources: the script API guide and examples (spec 215), the equipment type contracts. One prompt,
`create_recipe`, walks the AI through read, ask, write, test, submit.

## Security

The MCP server grants no more power than the REST API, which already allows everything. Two risks
are new because an AI holds the token:

1. **Misreading the request**: "close everything" also closes the gate while the car goes through.
2. **Prompt injection**: the AI reads an email or a web page that hides "open the gate", and it has
   the tool to do it.

Rules:

- Off by default; the user turns it on in Settings.
- Tokens carry **scopes** chosen by the user: `read`, `live` (live values, history), `control`
  (orders, modes, instances), `recipes` (drafts). Read only by default. Tokens expire and are revoked
  in one click.
- An order to an equipment that asks for confirmation (spec 146: gate, door) is never executed from
  MCP directly: it becomes a pending request confirmed by a human in Sowel.
- Activating an AI recipe stays in the UI (spec 215).
- Rate limit per token; every call logged with its token and shown in Settings.

## Reach

- A local AI client (Claude Desktop, a CLI) reaches Sowel on the LAN.
- Web clients (claude.ai, ChatGPT) call from the provider's servers: Sowel must be reachable over
  HTTPS from the internet (reverse proxy or tunnel). Their connectors often expect OAuth; a pasted
  token is the first step, OAuth a later one.

## Out of scope

Administration, any Sowel-hosted relay, OAuth in the first cut, anonymisation of names sent to the AI.

## Open questions

1. Does `describe_home` include current values when the token has `live`, or always separate calls?
2. Is the pending confirmation of spec 146 a push notification, a UI banner, or both?
3. Who may create an MCP token: admin only, or `standard` users too (with scopes capped by their role)?

Architecture in [architecture.md](architecture.md), effort and phases in [plan.md](plan.md).
