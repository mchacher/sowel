# Zones

Les zones représentent la **structure spatiale** de votre maison. Elles organisent vos équipements en pièces, étages et espaces, et elles calculent automatiquement un statut en temps réel pour chaque espace.

## Créer des zones

Allez dans **Administration > Zones**.

### Construire votre arbre de zones

Les zones forment une hiérarchie (structure arborescente). Une configuration typique :

```
Home
  Ground Floor
    Living Room
    Kitchen
    Hallway
    Bathroom
  First Floor
    Master Bedroom
    Kids Room
    Office
  Outdoor
    Garden
    Terrace
    Garage
```

Pour créer une zone :

1. Cliquez sur **Ajouter une zone**
2. Saisissez un nom
3. Sélectionnez une zone parent (ou aucune pour une zone racine)

Vous pouvez imbriquer les zones sur n'importe quelle profondeur, mais 2 à 3 niveaux suffisent généralement (Maison > Étage > Pièce).

### Réorganiser les zones

Les zones ont un ordre d'affichage qui contrôle leur apparition dans la barre latérale. Vous pouvez réordonner les zones d'un même parent en les glissant dans la liste.

### Modifier et supprimer

- Cliquez sur une zone pour modifier son nom ou la déplacer vers un autre parent
- La suppression retire la zone et **désaffecte** ses équipements (ils ne sont pas supprimés)

!!! warning
Vous ne pouvez pas supprimer une zone qui a des zones enfants. Supprimez ou déplacez d'abord les enfants.

## Agrégation de zone

C'est l'une des fonctionnalités les plus puissantes de Sowel. Chaque zone calcule automatiquement des **données agrégées** à partir des équipements qu'elle contient. Aucune configuration n'est nécessaire.

### Ce qui est agrégé

| Donnée                          | Logique                                          | Exemple                                    |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| **Température**                 | Moyenne de tous les capteurs de température      | 21,5 °C (moyenne de 2 capteurs Aqara)      |
| **Humidité**                    | Moyenne de tous les capteurs d'humidité          | 45 %                                       |
| **Luminosité**                  | Moyenne de tous les capteurs de lumière          | 320 lx                                     |
| **Mouvement**                   | OU sur tous les capteurs de mouvement            | "Mouvement" si un PIR détecte une présence |
| **Durée de mouvement**          | Temps écoulé depuis le dernier changement d'état | "Calme depuis 15 min"                      |
| **Lumières allumées**           | Nombre de lumières actives                       | 2 / 5 lumières allumées                    |
| **Volets ouverts**              | Nombre de volets ouverts                         | 1 / 3 volets ouverts                       |
| **Position moyenne des volets** | Position moyenne sur tous les volets             | 65 %                                       |
| **Portes ouvertes**             | Nombre de contacts de porte ouverts              | 1 porte ouverte                            |
| **Fenêtres ouvertes**           | Nombre de contacts de fenêtre ouverts            | 2 fenêtres ouvertes                        |
| **Fuite d'eau**                 | OU sur tous les capteurs de fuite                | Alerte si un capteur détecte de l'eau      |
| **Fumée**                       | OU sur tous les capteurs de fumée                | Alerte si un capteur détecte de la fumée   |

### Agrégation récursive

L'agrégation est **récursive** : une zone parent fusionne automatiquement les données de toutes ses zones enfants.

**Exemple** : la zone "First Floor" agrège les données de Master Bedroom, Kids Room et Office. S'il y a du mouvement dans l'une de ces pièces, le First Floor affiche "Mouvement". La température affichée est la moyenne sur les trois pièces.

Cela signifie que vous pouvez jeter un œil à une zone d'étage et connaître le statut global sans vérifier chaque pièce individuellement.

### Comment cela apparaît dans l'UI

Dans la vue **Accueil**, chaque zone affiche un **bandeau d'état** avec les données agrégées présentées sous forme de pastilles colorées :

- Pastille **Température** (par ex. "21,5 °C")
- Pastille **Humidité** (par ex. "45 %")
- Pastille **Mouvement** avec durée ("Mouvement" ou "Calme 15 min")
- Pastille de comptage **Lumières** (par ex. "2/5")
- Pastille de comptage **Volets** (par ex. "1/3")
- Pastilles **Alerte** pour portes/fenêtres ouvertes, fuites d'eau, fumée

Sous le bandeau, les équipements sont regroupés par type (Lumières, Volets, Capteurs) avec des contrôles intégrés.

## Fil d'activité

Chaque zone dispose d'un panneau **Activité** en direct sur le côté droit de la vue Accueil. C'est un widget de coup d'œil qui montre ce qui vient de se passer dans la zone : ordres dispatchés, mouvement détecté, recettes démarrées, changements de mode, lever/coucher de soleil, alarmes.

Le panneau regroupe les événements par heure. Le bucket le plus récent porte le label `HH:00 → maintenant`, les buckets plus anciens portent simplement `HH:00`.

![Vue zone avec le panneau Activité dans la colonne droite](../screenshots/activity-zone-view-fr.png)

### Ce qui est tracé

| Catégorie        | Déclencheur                                                                               | Exemple                                                       |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Ordre**        | Tout ordre dispatché sur un équipement par une recette, un mode, un bouton, l'API         | `Lumière → ON manuel`, `Lumière → OFF par Motion Light`       |
| **Mouvement**    | Front montant d'un capteur de présence (catégorie binding `motion`)                       | `Mouvement détecté sur PIR Salon`                             |
| **Recette**      | Démarrage ou arrêt d'une instance de recette                                              | `Recette Motion Light démarrée`                               |
| **Mode**         | Activation ou désactivation d'un mode                                                     | `Mode Nuit activé`                                            |
| **Soleil**       | Lever ou coucher du soleil                                                                | `Coucher du soleil`                                           |
| **Alarme**       | Alarme système, erreur de recette, détection fuite d'eau ou fumée                         | `Détecteur Cuisine : Fumée détectée`                          |
| **Alarme levée** | La fin de la même alarme — secteur revenu, batterie remontée, plugin de nouveau joignable | `nut : Retour secteur — ups est réalimenté (batterie à 58 %)` |

Chaque ligne indique **qui a déclenché l'événement** : nom de la recette, nom du mode, « manuel » pour les actions directes via l'UI, identifiant du bouton, ou « externe » pour un MQTT entrant.

### Fusion des ordres simultanés

Quand une recette dispatche plusieurs ordres identiques en rafale (par exemple Motion Light qui éteint trois appliques au même instant), le fil regroupe le tout en une seule ligne avec un compteur : `Applique x 1 ×3 → OFF par Motion Light`. La fenêtre est de 500 ms ; même alias, même valeur et même source sont requis pour la fusion.

### Basculer l'activité des sous-zones

Par défaut, le panneau n'affiche que les événements de la zone que vous consultez, plus les événements globaux (changements de mode, lever/coucher de soleil, alarmes système). Quand vous êtes sur une zone parent (par exemple « Maison »), activez le petit bouton avec l'icône Network dans l'en-tête pour inclure aussi les événements de toutes les sous-zones — c'est ce que montre la capture ci-dessus, avec le bouton rempli en bleu.

Le bouton n'apparaît que sur les zones qui ont des enfants. Votre choix est mémorisé entre les navigations (stocké dans le navigateur).

### Mobile

Sur mobile, le panneau se situe sous la section **Comportements** et n'affiche que les 10 événements les plus récents. C'est un coup d'œil, pas un historique. Pour aller plus loin, utilisez la page **Journaux**.

![Panneau Activité sur mobile (cap à 10 items)](../screenshots/activity-mobile-fr.png)

### Statut live

La pastille en haut à droite affiche `● live` quand l'application est connectée à Sowel via WebSocket. Si la connexion est perdue, elle bascule en `○ offline` et le panneau cesse de recevoir de nouveaux événements jusqu'à la reconnexion.

### Fenêtre mémoire

Le moteur Sowel garde les **7 derniers jours** d'événements (avec un plafond à 2000 entrées) et **les conserve au redémarrage**. Pour remonter plus loin, utilisez la page Journaux.

## Ordres de zone

Chaque zone expose des ordres automatiques que vous pouvez utiliser depuis l'UI ou dans les automatisations :

| Ordre                        | Effet                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| **Tout éteindre**            | Éteint tous les équipements de la zone (et des zones enfants) |
| **Toutes lumières éteintes** | Éteint tous les équipements lumière de la zone                |
| **Toutes lumières allumées** | Allume tous les équipements lumière de la zone                |

Ils sont disponibles dans la vue Accueil, dans l'API, et comme actions dans les recettes et les modes.

## Astuces

- **Calquez la disposition physique** : les zones doivent refléter la façon dont vous pensez votre maison. Si vous dites "la cuisine", ça doit être une zone.
- **N'imbriquez pas trop** : deux ou trois niveaux (Maison > Étage > Pièce) suffisent en général. Les arbres trop profonds sont moins faciles à parcourir.
- **Zones extérieures** : créez une zone "Outdoor" pour les capteurs du jardin, le portail et tout équipement extérieur.
- **L'agrégation crée la valeur** : plus vous affectez de capteurs et d'équipements aux zones, plus le statut agrégé est riche. Même un seul capteur de température dans une pièce rend le bandeau de zone utile.
