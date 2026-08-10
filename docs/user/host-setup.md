# Preparing the Host

If you are installing Sowel on a freshly-prepared machine (Raspberry Pi, mini-PC, Debian/Ubuntu VM), this page covers the two dependencies that Sowel does not ship with: **Docker** and an **MQTT broker** (optional, depending on which plugins you use).

!!! info "Already have Docker and/or an MQTT broker?"
Skip directly to [Getting Started — Installation](getting-started.md#installation).

## Raspberry Pi specifics

This section only applies to **Raspberry Pi** (3, 4, 5). On a standard Debian or Ubuntu PC/server, jump to [Install Docker](#install-docker).

### 64-bit OS required

Sowel only runs in 64-bit. Check with:

```bash
uname -m   # must return "aarch64"
```

If you see `armv7l`, reflash the SD card with **Raspberry Pi OS Lite 64-bit** via Raspberry Pi Imager.

### SD card or SSD

Sowel and InfluxDB write continuously. A consumer-grade SD card typically dies in 6 to 12 months.

- **Minimum**: high-endurance SD card (SanDisk High Endurance, Samsung PRO Endurance), 64 GB or more.
- **Recommended**: USB3 SSD plugged into a blue USB port. Much more reliable and faster.

### Increase swap

By default Raspberry Pi OS allocates 100 MB of swap, which is too tight when InfluxDB compacts.

```bash
sudo nano /etc/dphys-swapfile
# change CONF_SWAPSIZE=100 to CONF_SWAPSIZE=1024
sudo systemctl restart dphys-swapfile
```

## Install Docker

Official procedure, valid on Raspberry Pi OS, Debian and Ubuntu.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Then **logout/login** (or run `newgrp docker`) so the new group membership takes effect:

```bash
newgrp docker
groups        # must now include "docker"
docker ps     # must work without sudo
```

!!! warning "Don't skip the re-login"
If you run the Sowel install script without re-logging in, it fails with `Error: cannot reach the Docker daemon`. Your user is in the `docker` group, but your **current shell session** does not know yet.

Enable Docker at boot (usually done automatically, but verify):

```bash
sudo systemctl enable docker
docker run --rm hello-world    # smoke test
```

## Install an MQTT broker (optional)

!!! info "Sowel does not ship an MQTT broker"
MQTT-based plugins (Zigbee2MQTT, LoRa2MQTT, Tasmota, Shelly...) need a broker reachable on your LAN. If you already have one, skip this section. If you do not use any MQTT plugin, this section is irrelevant.

Procedure for Mosquitto, valid on Raspberry Pi OS, Debian and Ubuntu.

### Install

```bash
sudo apt update
sudo apt install -y mosquitto mosquitto-clients
```

The service starts automatically but only listens on `localhost:1883` by default since Debian Bookworm.

### Open to the LAN

Create `/etc/mosquitto/conf.d/sowel.conf`:

```
listener 1883 0.0.0.0
allow_anonymous true
```

Two lines are enough. All other options (`persistence`, `persistence_location`, etc.) are already set in the default `/etc/mosquitto/mosquitto.conf`. **Do not redefine them**, Mosquitto refuses duplicate values.

Then:

```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto   # must show "active (running)"
```

!!! warning "Security of `allow_anonymous true`"
Without authentication, any machine on the LAN can publish and subscribe. **Acceptable** for a domestic setup that stays on the LAN behind the home router. **Avoid** if port 1883 is exposed to the Internet, or on a shared/untrusted LAN.

    To add a password, see the [Mosquitto documentation](https://mosquitto.org/man/mosquitto-conf-5.html).

### Test

From another machine on the LAN:

```bash
# terminal 1 (subscribe)
mosquitto_sub -h <host-ip> -p 1883 -t test/#

# terminal 2 (publish)
mosquitto_pub -h <host-ip> -p 1883 -t test/hello -m "ok"
```

If the message arrives, the broker is reachable. You can now point the Sowel Zigbee2MQTT plugin (and Z2M itself) to `mqtt://<host-ip>:1883`.

## Several Zigbee coordinators

A single Zigbee coordinator covers most homes. You need a second one when the house is too large for one mesh, when an outbuilding is out of range, or when you hit the coordinator's device limit.

Zigbee2MQTT drives **one coordinator per instance**. Two coordinators therefore means two Z2M instances — but still **one MQTT broker**, and **one** Zigbee2MQTT plugin in Sowel.

!!! warning "Each instance needs its own base topic"
Do not give two instances the same `base_topic`. `bridge/devices`, `bridge/info` and `bridge/state` are retained topics: the instances would overwrite each other's device list, and Sowel would see the networks appear and disappear in turn.

### Run one container per coordinator

Each instance needs its own data volume, base topic, frontend port and Zigbee channel:

```yaml
services:
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt
    restart: unless-stopped
    volumes:
      - ./z2m-data:/app/data
    ports:
      - 8080:8080

  zigbee2mqtt-annex:
    image: koenkk/zigbee2mqtt
    restart: unless-stopped
    volumes:
      - ./z2m-annex-data:/app/data # separate volume — never share it
    ports:
      - 8081:8080
```

Then, in each instance's `data/configuration.yaml`:

```yaml
# instance 1                     # instance 2
mqtt:                            mqtt:
  base_topic: zigbee2mqtt          base_topic: zigbee2mqtt_annex
  server: mqtt://<host-ip>:1883    server: mqtt://<host-ip>:1883
serial:                          serial:
  port: tcp://<coord1-ip>:6638     port: tcp://<coord2-ip>:6638
  adapter: zstack                  adapter: zstack
advanced:                        advanced:
  channel: 11                      channel: 25
frontend:                        frontend:
  port: 8080                       port: 8080
```

The same settings are reachable from the Z2M web interface under **Settings → MQTT**, **Advanced** and **Serial port**, which avoids editing the file by hand.

!!! tip "Use different Zigbee channels"
Two networks on the same channel within radio range of each other share airtime and both degrade. Pick channels far apart — 11, 15, 20 and 25 are the usual choices. Set the channel **before pairing devices**: changing it later may force you to re-pair part of the network.

### Declare the networks in Sowel

In **Administration → Integrations → Zigbee2MQTT**, list the base topics in **Zigbee2MQTT Base Topic(s)**, separated by commas:

```
zigbee2mqtt, zigbee2mqtt_annex
```

The first network keeps its device names as-is. Devices of the following networks are prefixed with their base topic — `zigbee2mqtt_annex/kitchen_lamp` — so that two networks can host the same friendly name without their devices merging in Sowel.

!!! warning "The order of the list is part of the device identity"
Device identifiers derive from this list. Reordering it, or renaming a base topic, orphans the affected devices and drops their equipment bindings. Append new networks at the end.

If friendly names are known to be unique across all your networks, you can drop the prefix for a given network by suffixing its entry with a colon:

```
zigbee2mqtt, zigbee2mqtt_annex:
```

Two devices sharing a name then silently become a single Sowel device, so only do this if you control the naming.

Adding a third coordinator later is the same three steps: a new container with its own volume, port, base topic and channel, then that base topic appended to the list.

## Troubleshooting

### `Error: cannot reach the Docker daemon`

Your user is not in the `docker` group, or your shell session did not reload its groups. See [Install Docker](#install-docker).

### Mosquitto refuses to start: `Duplicate persistence_location`

You redefined `persistence_location` (or `persistence`) in your `conf.d/sowel.conf`. These options are already in the default `mosquitto.conf`. Remove them from your file: only `listener` and `allow_anonymous` should remain.

### `Start request repeated too quickly`

After several failed start attempts, systemd blocks further `start` requests. Reset the counter:

```bash
sudo systemctl reset-failed mosquitto
sudo systemctl start mosquitto
```
