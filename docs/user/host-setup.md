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
