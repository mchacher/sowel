# V0.10c: MCZ Maestro Integration

## Summary

Add a native TypeScript integration for MCZ pellet stoves equipped with the Maestro controller. Communication happens via the MCZ cloud (Socket.IO to `app.mcz.it:9000`), authenticated with the stove's serial number and MAC address. The integration polls stove data periodically and exposes it as a Winch Device with thermostat-type Equipment bindings.

## Reference

- Protocol reverse-engineered from [jeedom-plugin-mczremote](https://github.com/henribi/jeedom-plugin-mczremote)
- Corroborated by [Chibald/maestrogateway](https://github.com/Chibald/maestrogateway) and [hackximus/MCZ-Maestro-API](https://github.com/hackximus/MCZ-Maestro-API)

## Data Points (read)

| Alias                | Register Index | Type        | Category    | Description                                                         |
| -------------------- | -------------- | ----------- | ----------- | ------------------------------------------------------------------- |
| `stoveState`         | 1              | enum        | generic     | Stove state (off, ignition phases, running P1-P5, shutdown, errors) |
| `ambientTemperature` | 6              | number (÷2) | temperature | Ambient temperature from stove sensor (°C)                          |
| `targetTemperature`  | 26             | number (÷2) | temperature | Temperature setpoint (°C)                                           |
| `profile`            | 18             | enum        | generic     | Profile (manual, dynamic, overnight, comfort)                       |
| `ecoMode`            | 23             | boolean     | generic     | ECO mode on/off                                                     |
| `pelletSensor`       | 47             | enum        | generic     | Pellet level (inactive, sufficient, almost_empty)                   |
| `ignitionCount`      | 45             | number      | generic     | Total ignition count                                                |
| `sparkPlug`          | 10             | enum        | generic     | Spark plug state (ok, worn)                                         |

## Orders (write)

| Alias               | Command ID | Type    | Description                                   |
| ------------------- | ---------- | ------- | --------------------------------------------- |
| `targetTemperature` | 42         | number  | Temperature setpoint (value × 2 for protocol) |
| `profile`           | 149        | enum    | Profile: dynamic, overnight, comfort          |
| `ecoMode`           | 41         | boolean | ECO mode on/off                               |
| `resetAlarm`        | 1          | boolean | Reset alarm (sends value 255)                 |

## Settings

| Key                | Label                      | Type   | Required | Default |
| ------------------ | -------------------------- | ------ | -------- | ------- |
| `serial_number`    | Serial number              | text   | yes      | —       |
| `mac_address`      | MAC address                | text   | yes      | —       |
| `polling_interval` | Polling interval (seconds) | number | no       | 30      |

## Acceptance Criteria

- [ ] MCZ integration appears in Administration > Integrations
- [ ] Configuring serial + MAC and starting connects to MCZ cloud via Socket.IO
- [ ] Stove appears as a Device in Winch with all 8 data points
- [ ] Data is polled every N seconds (configurable, default 30s)
- [ ] Creating an Equipment of type "thermostat" and binding to MCZ device works
- [ ] Orders (targetTemperature, profile, ecoMode, resetAlarm) execute correctly
- [ ] On-demand poll is scheduled after each order execution
- [ ] Manual refresh button works
- [ ] Graceful handling of cloud disconnection and reconnection
- [ ] TypeScript compiles with zero errors
- [ ] All existing tests pass

## Scope

### In Scope

- Cloud mode only (Socket.IO to app.mcz.it:9000)
- Single stove per integration instance
- 8 data points + 5 orders as defined above
- Polling-based data retrieval
- Native TypeScript (no Python bridge)

### Out of Scope

- Local WebSocket mode (ws://192.168.120.1:81) — deferred
- Multiple stoves per integration — deferred
- Chrono programming / timer schedules
- Advanced maintenance data (hours per power level, etc.)
- Custom UI card for stove (reuses thermostat card)

## Edge Cases

- Cloud server unreachable → status = "error", retry on next poll
- Socket.IO disconnects mid-session → auto-reconnect (built into socket.io-client)
- Stove in error state (A01-A23) → `stoveState` reflects the error code
- Invalid serial/MAC → login fails, status = "error"
- Polling overlap prevention (same pattern as Panasonic)
- Temperature encoding: raw hex → int → ÷2 for temperatures
- Power off command uses value 40, not 0
