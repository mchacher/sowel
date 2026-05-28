# Préparer l'hôte

Si vous installez Sowel sur une machine fraîchement préparée (Raspberry Pi, mini-PC, VM Debian/Ubuntu), cette page couvre les deux dépendances que Sowel n'embarque pas : **Docker** et un **broker MQTT** (optionnel, selon les plugins que vous utilisez).

!!! info "Vous avez déjà Docker et/ou un broker MQTT ?"
Passez directement à [Premiers pas — Installation](getting-started.md#installation).

## Spécificités Raspberry Pi

Cette section ne concerne **que les Raspberry Pi** (3, 4, 5). Sur un PC/serveur Debian ou Ubuntu standard, sautez à [Installer Docker](#installer-docker).

### Système 64-bit obligatoire

Sowel ne fonctionne qu'en 64-bit. Vérifiez :

```bash
uname -m   # doit retourner "aarch64"
```

Si vous voyez `armv7l`, reflashez la carte SD avec **Raspberry Pi OS Lite 64-bit** via Raspberry Pi Imager.

### Carte SD ou SSD

Sowel et InfluxDB écrivent en continu. Une carte SD grand public meurt typiquement en 6 à 12 mois.

- **Minimum** : carte SD haute endurance (SanDisk High Endurance, Samsung PRO Endurance), 64 Go ou plus.
- **Recommandé** : SSD USB3 branché sur un port USB bleu. Beaucoup plus fiable et plus rapide.

### Augmenter le swap

Par défaut, Raspberry Pi OS alloue 100 Mo de swap, ce qui est trop juste lors des compactions InfluxDB.

```bash
sudo nano /etc/dphys-swapfile
# changer CONF_SWAPSIZE=100 en CONF_SWAPSIZE=1024
sudo systemctl restart dphys-swapfile
```

## Installer Docker

Procédure officielle, valable sur Raspberry Pi OS, Debian et Ubuntu.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Puis **logout/login** (ou `newgrp docker`) pour que la nouvelle appartenance au groupe prenne effet :

```bash
newgrp docker
groups        # doit maintenant inclure "docker"
docker ps     # doit fonctionner sans sudo
```

!!! warning "Ne pas sauter le re-login"
Si vous lancez le script d'installation Sowel sans re-login, il échoue avec `Error: cannot reach the Docker daemon`. Votre utilisateur est bien dans le groupe `docker`, mais votre **session shell courante** ne le sait pas encore.

Activez Docker au boot (normalement fait automatiquement, à vérifier) :

```bash
sudo systemctl enable docker
docker run --rm hello-world    # test
```

## Installer un broker MQTT (optionnel)

!!! info "Sowel n'embarque pas de broker MQTT"
Les plugins basés sur MQTT (Zigbee2MQTT, LoRa2MQTT, Tasmota, Shelly...) ont besoin d'un broker accessible sur le LAN. Si vous en avez déjà un, passez à la suite. Si vous n'utilisez aucun plugin MQTT, cette section ne vous concerne pas.

Procédure pour Mosquitto, valable sur Raspberry Pi OS, Debian et Ubuntu.

### Installation

```bash
sudo apt update
sudo apt install -y mosquitto mosquitto-clients
```

Le service démarre automatiquement mais n'écoute que sur `localhost:1883` par défaut depuis Debian Bookworm.

### Ouvrir au LAN

Créez `/etc/mosquitto/conf.d/sowel.conf` :

```
listener 1883 0.0.0.0
allow_anonymous true
```

Deux lignes suffisent. Toutes les autres options (`persistence`, `persistence_location`, etc.) sont déjà dans le `/etc/mosquitto/mosquitto.conf` par défaut. **Ne les redéfinissez pas**, Mosquitto refuse les valeurs dupliquées.

Puis :

```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto   # doit afficher "active (running)"
```

!!! warning "Sécurité de `allow_anonymous true`"
Sans authentification, n'importe quelle machine du LAN peut publier et s'abonner. **Acceptable** pour une installation domestique purement LAN derrière la box. **À éviter** si le port 1883 est exposé à Internet, ou sur un LAN partagé non fiable.

    Pour ajouter un mot de passe, voir la [documentation Mosquitto](https://mosquitto.org/man/mosquitto-conf-5.html).

### Tester

Depuis une autre machine du LAN :

```bash
# terminal 1 (abonnement)
mosquitto_sub -h <ip-de-l'hôte> -p 1883 -t test/#

# terminal 2 (publication)
mosquitto_pub -h <ip-de-l'hôte> -p 1883 -t test/hello -m "ok"
```

Si le message arrive, le broker est joignable. Vous pouvez maintenant pointer le plugin Zigbee2MQTT de Sowel (et Z2M lui-même) vers `mqtt://<ip-de-l'hôte>:1883`.

## Dépannage

### `Error: cannot reach the Docker daemon`

Votre utilisateur n'est pas dans le groupe `docker`, ou votre session shell n'a pas rechargé ses groupes. Voir [Installer Docker](#installer-docker).

### Mosquitto refuse de démarrer : `Duplicate persistence_location`

Vous avez redéfini `persistence_location` (ou `persistence`) dans votre `conf.d/sowel.conf`. Ces options sont déjà dans le `mosquitto.conf` par défaut. Retirez-les de votre fichier : il ne doit contenir que `listener` et `allow_anonymous`.

### `Start request repeated too quickly`

Après plusieurs tentatives de démarrage ratées, systemd bloque les nouvelles requêtes `start`. Réinitialisez le compteur :

```bash
sudo systemctl reset-failed mosquitto
sudo systemctl start mosquitto
```
