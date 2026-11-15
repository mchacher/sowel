# Spec 209 — Pitch (reference text, French)

Validated by the maintainer on 2026-11-15. Every storefront (GitHub description, README, site, video) is cut from
this text; the rules behind it are in [spec.md](spec.md), « Message architecture ». The English version is written
from it, not the other way round.

---

## En une phrase

Sowel connaît votre maison : elle se pilote seule, se configure en quelques clics, et vos données restent chez vous.

## Le pitch (environ 3 minutes)

**1. Le constat.** Aujourd'hui, une maison connectée, c'est une liste d'appareils : des dizaines de capteurs, de
prises et de volets, chacun avec son application. Pour qu'ils travaillent ensemble, il faut écrire des règles une
par une, puis les reprendre à chaque nouvel appareil.

**2. Tout part de la maison.** Avec Sowel, on ne commence pas par les appareils. On commence par décrire sa
maison, sa topologie : la maison, ses étages, ses pièces, le jardin, le garage. Puis on place chaque équipement là
où il se trouve vraiment : la lampe dans le salon, le ballon dans le cellier, les panneaux sur le toit.

Ce qu'on place dans une pièce, ce sont des équipements, pas des appareils. Un appareil, c'est ce qui est sur le
réseau. Un équipement, c'est ce qui est dans la pièce, et il s'appuie sur un ou plusieurs appareils. Le ballon
d'eau chaude, par exemple, c'est un relais, une sonde de température et un compteur : trois appareils, un seul
équipement.

Ce plan est le point de départ de tout. Ce qu'une pièce sait, ce qu'on peut lui demander, les recettes qu'on y
pose : tout en découle.

**3. Sowel sait où, et sait quoi.** La topologie dit où se trouve chaque équipement. Le modèle de données dit ce
qu'il est. Ce modèle définit une trentaine de types d'équipements :

- éclairages simples, variables ou en couleur ;
- volets, stores, portes et portails motorisés ;
- chauffages, thermostats, ballon d'eau chaude, VMC ;
- compteur du réseau, compteur de production, sous-compteurs, panneaux solaires ;
- borne de recharge et voiture électrique ;
- pompe, volet et pompe à chaleur de piscine, vannes d'arrosage ;
- capteurs, boutons, météo, caméras, onduleurs, électroménager.

Pour chacun, le modèle sait ce qu'il mesure et ce qu'on peut lui demander. Une lampe reste une lampe, quelle que
soit sa marque, et ce sont les intégrations qui s'adaptent au modèle.

Sowel connaît donc « la lampe du salon », « les volets de l'étage », « le compteur du réseau ». C'est ce double
savoir, l'emplacement et la nature, qui permet à la maison de se piloter seule.

**4. Des pièces qui savent.** Comme chaque équipement a sa place dans le plan, chaque pièce calcule seule ce que
disent ses équipements :

- la température et l'humidité moyennes, la luminosité ;
- la présence, et depuis quand ;
- les portes et fenêtres ouvertes, une fuite d'eau, de la fumée ;
- les lumières allumées, les volets ouverts et leur position moyenne ;
- la puissance consommée.

Un étage regroupe ses pièces, et la maison regroupe tout. On peut aussi commander une pièce ou un étage entier :
fermer tous les volets, éteindre toutes les lumières. Tout cela est dans le cœur de Sowel, automatique, sans rien
configurer. Par-dessus, un mode « Nuit » ou « Absent » change toute la maison d'un geste.

**5. Des intégrations pour vos appareils.** Une vingtaine aujourd'hui :

- Zigbee, Shelly, Tasmota, Tuya en local, Somfy RTS ;
- Netatmo, Legrand, les onduleurs solaires APsystems ;
- pompes à chaleur, poêles, voiture électrique.

La liste grandit avec les besoins de ceux qui utilisent Sowel : chaque nouvel appareil, dans une vraie maison, a
amené sa propre intégration. Tout s'installe depuis l'application, en un clic. Sowel découvre les appareils, vous
en faites des équipements et vous les placez dans vos pièces.

**6. Des recettes qui vont loin.** Une recette est un automatisme complet, prêt à l'emploi. On la pose sur une
pièce, on règle quelques paramètres, c'est fini. Comme elle s'appuie sur la pièce, elle sait déjà quelles lampes,
quels capteurs et quels volets s'y trouvent. Ajoutez une lampe au salon, la recette la prend en charge sans rien
toucher.

Derrière ce réglage, il y a un vrai programme, bien au-delà d'une règle « si ceci, alors cela » :

- **le thermostat de présence** préchauffe avant votre retour, passe en mode nuit, garde un cocon pour dormir et
  respecte votre réglage manuel ;
- **l'arrosage** saute la pluie ;
- **la ventilation** n'extrait l'humidité que si l'air dehors est plus sec ;
- **la sécurité** coupe une pompe qui tourne trop longtemps.

Les modes s'y ajoutent : chaque recette peut se régler autrement la nuit ou en votre absence.

L'énergie montre le mieux jusqu'où cela va. Sowel sait quel compteur est le réseau, ce que produisent vos panneaux
et quels appareils peuvent attendre. Le surplus solaire part dans le ballon, puis dans la voiture, dont la charge
suit le soleil jusqu'au niveau voulu. Aucune règle à écrire. Chez nous, cela représente _[chiffre réel, à mesurer à
l'étape 3]_.

**7. Votre besoin, même s'il est unique.** Aucune recette ne correspond ? Décrivez votre besoin à une IA : elle
peut écrire la recette dès aujourd'hui, même si vous n'êtes pas développeur. Elle y arrive parce que Sowel lui
présente une maison bien décrite, avec ses pièces et ses équipements, pas des milliers d'entités. Un outil dédié
simplifiera bientôt cette étape.

**8. La garantie.** Tout tourne chez vous, sur votre matériel. Pas de compte, pas de cloud Sowel, aucune
télémétrie : vos données restent chez vous. Chaque plugin est vérifié avant d'être installé.

**9. L'appel.** Une commande pour l'installer, quelques clics pour voir votre première recette tourner. Open
source, sous licence AGPL.
