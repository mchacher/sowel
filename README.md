<p align="center"><img src="docs/assets/logo.svg" width="96" alt="Sowel logo"></p>

# Sowel

Home automation that starts from your home, not your devices.

Describe your rooms once, pick ready-made recipes instead of writing rules, and let AI build the rest. Sowel runs on your own hardware, with no account and no Sowel cloud.

<!-- FILM: the 1:43 launch film, uploaded through the GitHub editor so it plays inline -->
<!-- SCREENSHOT: Home view, current UI, retaken under #1127 -->

## How it works

You describe the house once, as zones: floors, rooms, the garden. Each equipment goes in its room. A light stays a light whether a bulb, a dimmer or a relay drives it, so you can change the hardware without touching anything else. Every room adds up what it knows: someone is in, it is warm, a window is open.

Then you set behaviors. A recipe is a ready-made automation: you drop it on a room, a floor or the whole house, fill in a few settings, and the tricky cases are already handled. A mode says how the home lives right now (day, night, away), and each recipe follows it. If you have solar panels, the energy arbiter shares the surplus between the car, the water heater and other loads, in the order you chose.

When no recipe fits, describe what you want in plain words. An AI agent writes and tests a custom recipe built on your zones and equipments, and you install it.

## Install

Sowel needs Docker on Linux or macOS. A Raspberry Pi 4 or 5 with 4 GB of RAM is enough.

```bash
curl -fsSL https://raw.githubusercontent.com/mchacher/sowel/main/scripts/install.sh | sh
```

The script installs Sowel into `~/sowel/`, starts it on port 3000 and prints the address. Open it and create your admin account. Backup, updates and remote access are covered in the [documentation](https://docs.sowel.org).

<details>
<summary>Manual install, without the script</summary>

```bash
mkdir ~/sowel && cd ~/sowel
curl -O https://raw.githubusercontent.com/mchacher/sowel/main/docker-compose.yml
docker compose up -d
```

</details>

## Works with

About twenty integrations, installed from the in-app store: Zigbee2MQTT, Tasmota, Shelly, Tuya, Somfy RTS, Netatmo, Legrand, Panasonic Comfort Cloud, SmartThings, APsystems, Renault, NUT and more.

Recipes cover lights on motion, presence heating, a water heater on solar surplus, smart EV charging, the pool pump, watering and ventilation on humidity, among others.

## Learn more

- [Documentation](https://docs.sowel.org), in English and [in French](https://docs.sowel.org/fr/)
- [Discussions](https://github.com/mchacher/sowel/discussions) for questions and ideas
- [Issues](https://github.com/mchacher/sowel/issues) for bugs

## Contributing

Integrations and recipes are plugins, each in its own repository: see [plugin development](docs/technical/plugin-development.md) and [recipe development](docs/technical/recipe-development.md). The engine itself is described in [the architecture guide](docs/technical/architecture.md).

```bash
npm install && npm run dev          # backend
cd ui && npm install && npm run dev # frontend, in a second terminal
npm run validate                    # type checks, lint and tests
```

## License

[AGPL-3.0](LICENSE). Created by Marc Chachereau.
