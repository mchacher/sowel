# Suivi énergétique

Sowel intègre un suivi énergétique qui mesure la consommation électrique de votre maison et (en option) votre production solaire dans le temps. Il prend en charge la classification tarifaire heures pleines / heures creuses, le suivi de l'autoconsommation, et un découpage par usage lorsque vous instrumentez des circuits dédiés.

## Les trois types d'équipement énergie

Le suivi énergétique de Sowel est **indépendant de l'intégration**. N'importe quel plugin qui remonte des données d'énergie ou de puissance peut alimenter le pipeline, du moment que le device est lié à l'un des trois types d'équipement ci-dessous.

| Type d'équipement         | Ce qu'il représente                                                     | Données device requises                                        |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `main_energy_meter`       | Votre compteur principal (import / export réseau pour toute la maison)  | Énergie cumulée (Wh), ou delta d'énergie réseau signé par tick |
| `energy_meter`            | Un sous-compteur sur un circuit dédié (PAC, piscine, recharge VE, etc.) | Énergie cumulée (Wh) **ou** puissance instantanée (W)          |
| `energy_production_meter` | Votre compteur de production solaire (ou autre production locale)       | Énergie de production cumulée (Wh)                             |

Vous pouvez mixer : une installation avec uniquement un compteur principal fonctionne, vous n'avez pas besoin de solaire pour utiliser la page Énergie. Inversement, vous pouvez avoir plusieurs sous-compteurs sans compteur principal, vous perdrez juste la barre "Autre" sur la vue par usage.

!!! info "Sous-compteurs en puissance seule"
Les pinces zigbee bon marché qui ne remontent que `power` (W) et pas `energy` (Wh) sont supportées en sous-compteur. Sowel intègre localement le signal de puissance en un flux Wh attribué à l'équipement sous-compteur, à la même cadence par minute que le compteur principal. L'état survit aux redémarrages.

## Comment les données circulent

```
Device compteur d'énergie (toute intégration)
  -> Le plugin remonte `energy` (Wh) ou `power` (W)
    -> HistoryWriter écrit des points minute par minute dans InfluxDB
      -> EnergyAggregator calcule les cumuls heure / jour / mois / année
        -> La page Énergie affiche graphiques et totaux
```

InfluxDB stocke les points bruts dans un bucket à rétention courte, puis des tâches de downsampling automatiques agrègent en buckets horaire et journalier avec des rétentions bien plus longues. La page Énergie choisit le bon bucket de manière transparente selon la fenêtre temporelle affichée.

!!! info "InfluxDB est automatique"
InfluxDB est obligatoire et démarre avec Sowel via Docker Compose. Au premier lancement, Sowel crée automatiquement les buckets requis, les tâches de downsampling et les tâches d'agrégation énergétique. Aucune configuration manuelle d'InfluxDB n'est nécessaire.

## Configurer le suivi énergétique

### Étape 1 : connecter une intégration énergie

Installez un plugin qui fournit des devices de compteur d'énergie (parcourez le catalogue depuis **Administration > Plugins**) et configurez-le depuis **Administration > Intégrations**. Tout plugin qui expose un device avec des données `energy` ou `power` convient.

### Étape 2 : créer le compteur d'énergie principal

Allez dans **Administration > Équipements** et créez un équipement :

- **Type** : Compteur d'énergie principal
- **Zone** : typiquement la racine Maison, ou une zone Local technique
- **Liez** à la donnée `energy` du device de votre compteur réseau

Une fois lié, Sowel commence à écrire un point d'énergie par minute dans InfluxDB.

### Étape 3 : (facultatif) ajouter un compteur de production

Si vous avez une production locale (panneaux solaires en général), créez un équipement de type **Compteur de production d'énergie** et liez-le au device de votre compteur de production. Avec un compteur principal et un compteur de production en place, Sowel calcule :

- **Consommation réseau** : énergie tirée du réseau
- **Autoconsommation** : énergie produite et consommée à la maison
- **Injection réseau** : énergie produite renvoyée vers le réseau
- **Consommation totale** : réseau + autoconsommation

### Étape 4 : (facultatif) configurer les tarifs heures pleines / creuses

Si votre contrat d'électricité distingue les heures pleines des heures creuses, configurez la grille pour que Sowel puisse répartir votre consommation.

Allez dans **Réglages > Administration > Tarifs énergie** :

![Configuration tarifaire](../screenshots/energy-tariff-settings-fr.png)

1. Saisissez optionnellement vos prix HP et HC par kWh (utilisés pour les vues coût ; la classification fonctionne sans)
2. Définissez vos créneaux horaires : quelles heures sont HP et lesquelles sont HC
3. Vous pouvez ajouter autant de créneaux que nécessaire pour couvrir les 24 h de la journée

Sans configuration tarifaire, toute la consommation est classée en HP par défaut, vous ne voyez juste pas la répartition.

### Étape 5 : (facultatif) ajouter des sous-compteurs pour une répartition par usage

Pour savoir comment la consommation de votre compteur principal se répartit entre les circuits, ajoutez un équipement `energy_meter` pour chaque circuit instrumenté.

1. Installez une pince zigbee, une prise intelligente ou un compteur Wi-Fi sur le circuit dédié
2. Allez dans **Administration > Équipements** et créez un équipement de type **Compteur d'énergie**
3. Liez-le à la donnée `energy` (Wh) du device, ou — si votre device ne remonte que `power` (W) — à sa donnée `power` : Sowel intègre automatiquement le signal de puissance en flux Wh

Dès qu'un sous-compteur est configuré, le bouton **Par usage** apparaît sur la page Consommation. Le bouton est masqué tant qu'aucun sous-compteur n'existe.

## Utiliser la section Énergie

La barre latérale regroupe les vues énergie sous **Énergie** :

- **Live** : flux instantané entre réseau, production et consommation maison
- **Consommation** : consommation historique avec répartition HP/HC et autoconsommation
- **Production** : production solaire historique avec répartition autoconsommation / injection

### Vue Live

La vue Live affiche ce qui se passe en temps réel — valeurs de puissance mises à jour en continu via WebSocket.

![Flux énergétique en temps réel](../screenshots/energy-live-fr.png)

Le diagramme montre trois cases (Réseau, Consommation, Production) avec des flèches indiquant le sens du flux. Quand la production solaire dépasse la consommation maison, un indicateur "Surplus solaire" apparaît et la part de solaire qui part au réseau versus celle qui alimente la maison s'affiche sur les flèches.

Les cases sont masquées quand l'équipement correspondant n'est pas configuré : sans compteur de production, seules Réseau et Consommation sont affichées.

### Vue Consommation

Choisissez une période (Jour, Sem, Mois, Année) et naviguez avec les flèches. Le graphique affiche une barre par seau temporel de la période sélectionnée.

![Consommation journalière](../screenshots/energy-consumption-day-fr.png)

Code couleur sur le graphique **Total** :

| Couleur    | Signification                                                |
| ---------- | ------------------------------------------------------------ |
| Bleu foncé | Consommation réseau en heures pleines                        |
| Bleu clair | Consommation réseau en heures creuses                        |
| Vert       | Autoconsommation (uniquement avec un compteur de production) |

Sous le graphique, les totaux sont affichés en kWh : réseau (réparti HP / HC), autoconsommation, et total (avec le pourcentage d'autoconsommation).

#### Bascule Wh / €

Un sélecteur segmenté **Wh / €** est placé à côté du sélecteur de période en haut de la page. En mode **€**, chaque valeur en kWh du graphique (axe Y, hauteur de barre, tooltip) et de la carte récap est remplacée par le coût correspondant en euros, calculé à partir des prix saisis dans **Réglages > Tarifs énergie**. La bascule est désactivée — avec une tooltip qui renvoie vers les réglages — tant qu'au moins un des prix HP / HC n'est pas non nul.

La valorisation est appliquée au moment de l'affichage : modifier votre tarif (après une renégociation, par exemple) revalorise la consommation passée avec les nouveaux prix. L'autoconsommation n'a pas de coût facturé, elle est donc masquée du graphique en mode €.

#### Bascule Total / Par usage

Quand au moins un sous-compteur est configuré, un bouton **Total / Par usage** apparaît au-dessus du graphique. La vue **Par usage** remplace la répartition HP / HC par une pile par sous-compteur, plus une pile **Autre** pour le résidu vu par le compteur principal mais non comptabilisé par les sous-compteurs.

![Répartition par usage](../screenshots/energy-consumption-by-usage-fr.png)

Les sous-compteurs utilisent une palette de couleurs déterministe afin qu'un même circuit garde la même couleur d'un jour à l'autre. La pile "Autre" est bornée à zéro, donc un sous-compteur qui dépasserait brièvement le compteur principal (à cause d'un décalage d'échantillonnage) ne peut pas la rendre négative.

Les totaux (HP / HC, autoconsommation) restent identiques entre les deux modes.

#### Périodes plus longues

Passer en **Mois** ou **Année** garde les mêmes couleurs et totaux, mais chaque barre représente un jour (vue Mois) ou un mois (vue Année).

![Consommation mensuelle](../screenshots/energy-consumption-month-fr.png)

### Vue Production

La page Production affiche l'historique de la production solaire (ou autre production locale) :

![Production journalière](../screenshots/energy-production-day-fr.png)

| Couleur    | Signification                                       |
| ---------- | --------------------------------------------------- |
| Vert clair | Autoconsommation, produit et consommé sur place     |
| Vert foncé | Injection réseau, produit et renvoyé vers le réseau |

Les totaux sous le graphique somment les deux tranches en production journalière, mensuelle ou annuelle.

## Pipeline de données

Comprendre comment circulent les données aide au diagnostic :

```
Le plugin remonte energy ou power
  -> Points minute par minute écrits dans le bucket InfluxDB "sowel" (rétention 7 jours)
    -> Tâche sowel-energy-sum-hourly
      -> Bucket "sowel-energy-hourly" (rétention 2 ans)
        -> Tâche sowel-energy-sum-daily
          -> Bucket "sowel-energy-daily" (rétention 10 ans)
```

La page Énergie choisit le bucket selon la période :

- **Vue Jour** pour aujourd'hui et les jours récents : interroge le bucket brut pour la précision temps réel
- **Vue Jour** pour les jours plus anciens : interroge le bucket horaire
- **Mois / Année** : interroge le bucket journalier pour des requêtes rapides sur longue plage

L'agrégateur garde aussi en mémoire les cumuls (heure, jour, mois, année) que la vue Live et les widgets de la page Maison lisent directement, rafraîchis à chaque nouveau tick d'énergie.

## Dépannage

### Aucune donnée n'apparaît sur la page Énergie

1. Vérifiez que l'intégration qui fournit votre device de compteur est connectée (indicateur vert dans **Administration > Intégrations**)
2. Vérifiez que l'équipement existe (Compteur principal et/ou Compteur de production) et qu'il est lié à un device qui émet réellement la donnée `energy`
3. Attendez au moins un cycle de remontée ; la fréquence exacte dépend du plugin, mais c'est typiquement quelques minutes au maximum
4. Consultez **Réglages > Système > Logs** pour les messages des modules `history-writer` ou `energy-aggregator`

### La répartition HP / HC affiche tout en HP

Cela signifie qu'aucune grille tarifaire n'est configurée. Allez dans **Réglages > Administration > Tarifs énergie** et définissez vos créneaux.

### Les anciennes données sont manquantes

Les données antérieures à 7 jours ne vivent que dans les buckets horaire et journalier (downsamplés). S'ils sont vides, c'est que les tâches de downsampling n'ont pas encore tourné (elles s'exécutent une fois par heure et une fois par jour). Vérifiez qu'InfluxDB tourne et est joignable, et inspectez les logs du module `history-writer` au démarrage : Sowel y indique si les tâches ont été créées ou existaient déjà.

### Le résidu "Autre" est très important sur la vue par usage

Cela veut dire que vos sous-compteurs ne couvrent pas la majorité de la consommation du compteur principal, ce qui est normal : le compteur principal voit tout ce qui consomme dans la maison, alors que les sous-compteurs ne couvrent typiquement que des circuits dédiés à forte puissance. Le résidu correspond aux "autres circuits".

Si le résidu est **négatif** (borné à zéro dans le graphique), c'est qu'un de vos sous-compteurs remonte plus que ce que voit le compteur principal, généralement une pince câblée à l'envers ou un défaut de calibration. L'intégrateur borne les deltas négatifs à zéro et logue un WARN à la première occurrence.
