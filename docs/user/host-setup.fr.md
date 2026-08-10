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

## Plusieurs coordinateurs Zigbee

Un seul coordinateur Zigbee suffit à la plupart des maisons. Un deuxième devient nécessaire quand le bâtiment est trop grand pour un seul maillage, quand une dépendance est hors de portée, ou quand vous atteignez la limite d'appareils du coordinateur.

Zigbee2MQTT pilote **un coordinateur par instance**. Deux coordinateurs, c'est donc deux instances Z2M — mais toujours **un seul broker MQTT**, et **un seul** plugin Zigbee2MQTT dans Sowel.

!!! warning "Chaque instance a besoin de son propre base topic"
Ne donnez jamais le même `base_topic` à deux instances. `bridge/devices`, `bridge/info` et `bridge/state` sont des topics retenus : les instances écraseraient mutuellement leur liste d'appareils, et Sowel verrait les réseaux apparaître et disparaître à tour de rôle.

### Un conteneur par coordinateur

Chaque instance a besoin de son propre volume de données, base topic, port de frontend et canal Zigbee :

```yaml
services:
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt
    restart: unless-stopped
    volumes:
      - ./z2m-data:/app/data
    ports:
      - 8080:8080

  zigbee2mqtt-annexe:
    image: koenkk/zigbee2mqtt
    restart: unless-stopped
    volumes:
      - ./z2m-annexe-data:/app/data # volume séparé — ne jamais le partager
    ports:
      - 8081:8080
```

Puis, dans le `data/configuration.yaml` de chaque instance :

```yaml
# instance 1                     # instance 2
mqtt:                            mqtt:
  base_topic: zigbee2mqtt          base_topic: zigbee2mqtt_annexe
  server: mqtt://<ip-hôte>:1883    server: mqtt://<ip-hôte>:1883
serial:                          serial:
  port: tcp://<ip-coord1>:6638     port: tcp://<ip-coord2>:6638
  adapter: zstack                  adapter: zstack
advanced:                        advanced:
  channel: 11                      channel: 25
frontend:                        frontend:
  port: 8080                       port: 8080
```

Ces mêmes réglages sont accessibles depuis l'interface web de Z2M, sous **Paramètres → MQTT**, **Avancé** et **Port série**, ce qui évite d'éditer le fichier à la main.

!!! tip "Utilisez des canaux Zigbee différents"
Deux réseaux sur le même canal et à portée radio l'un de l'autre se partagent le temps d'antenne et se dégradent mutuellement. Choisissez des canaux éloignés — 11, 15, 20 et 25 sont les valeurs habituelles. Réglez le canal **avant d'appairer les appareils** : le changer ensuite peut vous obliger à ré-appairer une partie du réseau.

### Déclarer les réseaux dans Sowel

Dans **Administration → Intégrations → Zigbee2MQTT**, listez les base topics dans le champ **Zigbee2MQTT Base Topic(s)**, séparés par des virgules :

```
zigbee2mqtt, zigbee2mqtt_annexe
```

Le premier réseau conserve les noms d'appareils tels quels. Les appareils des réseaux suivants sont préfixés par leur base topic — `zigbee2mqtt_annexe/lampe_cuisine` — afin que deux réseaux puissent héberger le même nom sans que leurs appareils ne fusionnent dans Sowel.

!!! warning "L'ordre de la liste fait partie de l'identité des appareils"
Les identifiants d'appareils dérivent de cette liste. La réordonner, ou renommer un base topic, orpheline les appareils concernés et supprime leurs liaisons d'équipement. Ajoutez les nouveaux réseaux à la fin.

Si vous savez que les noms sont uniques sur l'ensemble de vos réseaux, vous pouvez supprimer le préfixe d'un réseau donné en terminant son entrée par deux-points :

```
zigbee2mqtt, zigbee2mqtt_annexe:
```

Deux appareils portant le même nom deviennent alors silencieusement un seul appareil Sowel : ne le faites que si vous maîtrisez le nommage.

Ajouter un troisième coordinateur plus tard, ce sont les mêmes trois étapes : un nouveau conteneur avec son volume, son port, son base topic et son canal, puis ce base topic ajouté à la fin de la liste.

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
