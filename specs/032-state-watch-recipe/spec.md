# Recipe: StateWatch

## Summary

A generic recipe that monitors an equipment data key and raises an alarm when the value matches a watched state. Supports three independent, combinable trigger modes: delayed alarm (after X minutes in state), periodic repeat (every X minutes while in state), and scheduled check (at a fixed time of day).

The recipe exposes its alarm state so that notification publishers (or MQTT publishers) can react to state transitions.

## Acceptance Criteria

- [ ] Recipe registers as "state-watch" with proper slots
- [ ] Delayed alarm: alarm triggers after `delay` elapses while value === watchValue
- [ ] Repeat alarm: alarm re-triggers every `repeatInterval` while still in watched state
- [ ] Scheduled check: alarm triggers at `checkTime` if value === watchValue at that moment
- [ ] All three modes are optional and combinable
- [ ] Alarm clears (alarm=false) when value leaves watched state, emitting state.changed
- [ ] State persists across restarts (timers restored from persisted timestamps)
- [ ] Recipe logs transitions (alarm raised, alarm cleared, repeat, scheduled check)
- [ ] Existing UI recipe page works without changes (slots render via existing mechanism)

## Slots

| Slot             | Type      | Required | Default | Description                                             |
| ---------------- | --------- | -------- | ------- | ------------------------------------------------------- |
| `zone`           | zone      | yes      | —       | Zone of the equipment                                   |
| `equipment`      | equipment | yes      | —       | Equipment to monitor                                    |
| `dataKey`        | text      | yes      | —       | Data binding alias to watch (e.g., "contact", "state")  |
| `watchValue`     | text      | yes      | —       | Value that triggers surveillance (e.g., "open", "true") |
| `delay`          | duration  | no       | —       | Time in watched state before first alarm (e.g., "10m")  |
| `repeatInterval` | duration  | no       | —       | Repeat interval while in alarm (e.g., "1h")             |
| `checkTime`      | time      | no       | —       | Daily check time (e.g., "23:00")                        |

At least one of `delay`, `repeatInterval`, or `checkTime` must be provided.

## Exposed State

```
{
  alarm: boolean,            // true when in alarm state
  alarmSince: string | null, // ISO timestamp when alarm was first raised
  alarmCount: number,        // total notifications emitted since alarm started
  currentValue: unknown      // current value of the watched data key
}
```

State changes emit `recipe.instance.state.changed` events, consumable by notification publishers and MQTT publishers.

## Behavior

### Value enters watched state (value === watchValue)

1. Persist `watchStartedAt` = now
2. If `delay` configured → start delay timer
3. If `checkTime` configured → daily check timer already running, will evaluate at next occurrence

### Delay timer expires

1. Set alarm=true, alarmSince=now, alarmCount=1
2. Persist state, emit `notifyStateChanged()`
3. Log "Alarm raised: {dataKey}={watchValue} for {delay}"
4. If `repeatInterval` configured → start repeat timer

### Repeat timer fires

1. Increment alarmCount
2. Persist state, emit `notifyStateChanged()`
3. Log "Alarm repeat #{alarmCount}: {dataKey}={watchValue}"
4. Reschedule next repeat

### Scheduled check fires (checkTime)

1. Read current value of equipment data key
2. If value === watchValue:
   - If not already in alarm: set alarm=true, alarmSince=now, alarmCount=1
   - If already in alarm: increment alarmCount
   - Persist state, emit `notifyStateChanged()`
   - Log "Scheduled check: {dataKey}={watchValue} at {checkTime}"
3. If value !== watchValue: no action (alarm state unchanged)
4. Reschedule for next day

### Value leaves watched state (value !== watchValue)

1. Cancel delay timer (if pending)
2. Cancel repeat timer (if running)
3. If alarm was active:
   - Set alarm=false, alarmCount=0, alarmSince=null
   - Persist state, emit `notifyStateChanged()`
   - Log "Alarm cleared: {dataKey} changed to {currentValue}"
4. Clear `watchStartedAt`

### App restart

1. Read persisted state (watchStartedAt, alarm, alarmSince, alarmCount)
2. Read current equipment value
3. If value === watchValue:
   - If delay timer was pending → recalculate remaining time, restart timer
   - If delay already expired → trigger alarm immediately
   - If repeat was active → recalculate next repeat time
4. If value !== watchValue → clear state, no timers
5. Always restart checkTime daily timer if configured

## Edge Cases

- Equipment has no data for `dataKey` yet → no action, wait for first value
- Equipment deleted while recipe running → recipe stops gracefully (equipment.data.changed stops arriving)
- Value flickers (open→closed→open quickly) → delay timer resets each time value returns to watchValue
- `delay` = "0s" → alarm immediately when value matches (no delay)
- Only `checkTime` set, no delay/repeat → pure scheduled check, no event-driven alarm
- Only `repeatInterval` set, no delay → first alarm immediately, then repeat

## Scope

### In Scope

- Single equipment + single data key per instance
- Equality comparison only (value === watchValue, with string coercion for booleans/numbers)
- Three combinable trigger modes

### Out of Scope (future)

- Threshold comparisons (>, <, >=, <=) for numeric values
- Multiple data keys per instance
- Zone-level watching (zone aggregation keys)
