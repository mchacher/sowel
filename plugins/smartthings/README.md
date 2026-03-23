# Sowel Plugin: Samsung SmartThings

Integrates Samsung SmartThings devices into [Sowel](https://github.com/mchacher/sowel).

## Supported Devices

| Device Type       | Equipment Type | Data                                                  | Orders                            |
| ----------------- | -------------- | ----------------------------------------------------- | --------------------------------- |
| Samsung TV        | `media_player` | power, volume, mute, input source, picture mode       | power, volume, mute, input source |
| Samsung Washer    | `appliance`    | power, state, phase, progress, remaining time, energy | — (read-only)                     |
| Other SmartThings | generic        | power (if switch capability)                          | —                                 |

## Setup

1. Generate a Personal Access Token (PAT) at [account.smartthings.com/tokens](https://account.smartthings.com/tokens)
   - Required scopes: `r:devices:*`, `x:devices:*`
2. Install the plugin from the Sowel plugin store
3. Go to **Administration > Integrations > SmartThings**
4. Paste your PAT and click Start
5. Devices are discovered automatically

## Configuration

| Setting               | Default | Description                     |
| --------------------- | ------- | ------------------------------- |
| Personal Access Token | —       | Your SmartThings PAT (required) |
| Polling interval      | 300s    | How often to poll device status |

## License

AGPL-3.0
