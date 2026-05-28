# Guide utilisateur

Bienvenue dans le guide utilisateur Sowel. Cette documentation couvre tout ce dont vous avez besoin pour installer, configurer et utiliser Sowel au quotidien.

## Qu'est-ce que Sowel ?

Sowel est un moteur de domotique qui apporte de la **structure** à votre maison connectée. Au lieu de gérer des centaines de devices individuels, Sowel organise votre maison en trois couches claires :

- **Devices** : le matériel physique sur votre réseau (capteurs, interrupteurs, variateurs, thermostats). Découverts automatiquement depuis vos intégrations.
- **Équipements** : les unités fonctionnelles avec lesquelles vous interagissez vraiment ("Spots Cuisine", "Volets Chambre"). Chaque équipement se lie à un ou plusieurs devices.
- **Zones** : la structure spatiale de votre maison (Maison > Étage > Pièce). Les zones agrègent automatiquement les données de leurs équipements.

Cette séparation vous permet de penser en termes de _pièces et de fonctions_, pas en termes d'adresses Zigbee et de topics MQTT.

## Que peut faire Sowel ?

| Fonctionnalité          | Description                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auto-découverte**     | Les devices apparaissent automatiquement depuis les intégrations configurées (Zigbee2MQTT, Panasonic CC, MCZ Maestro, Netatmo, et bien d'autres) |
| **Agrégation de zones** | État de la pièce en temps réel : température, mouvement, nombre de lumières, position des volets, tout calculé automatiquement                   |
| **Tableau de bord**     | Tableau de bord personnalisable basé sur des widgets pour l'usage quotidien                                                                      |
| **Recettes**            | Modèles d'automatisation prêts à l'emploi : choisissez une zone, choisissez une lumière, réglez un délai, c'est fini                             |
| **Modes**               | Profils de fonctionnement nommés (Confort, Absence, Nuit) avec impacts par zone et planification calendaire                                      |
| **Suivi énergétique**   | Suivez la consommation avec ventilation HP/HC et autoconsommation                                                                                |
| **Accès distant**       | Accès sécurisé depuis n'importe où via Cloudflare Tunnel                                                                                         |

## Sections du guide

<div class="grid cards" markdown>

- **[Préparer l'hôte](host-setup.md)**

  Installation de Docker et Mosquitto sur Raspberry Pi, Debian ou Ubuntu. À sauter si vous avez déjà les deux.

- **[Premiers pas](getting-started.md)**

  Installation, première connexion et configuration initiale.

- **[Équipements](equipments.md)**

  Création et gestion des équipements, liaison aux devices, types d'équipements.

- **[Tableau de bord](dashboard.md)**

  Widgets, personnalisation, mode édition.

- **[Zones](zones.md)**

  Création de zones, affectation des équipements, agrégation automatique.

- **[Modes](modes.md)**

  Profils de fonctionnement, impacts, planification calendaire.

- **[Suivi énergétique](energy.md)**

  Suivi de la consommation, tarifs HP/HC, autoconsommation.

- **[Accès distant](remote-access.md)**

  Accès sécurisé depuis l'extérieur de votre réseau domestique.

</div>
