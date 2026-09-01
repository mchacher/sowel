# Tableau de bord

Le Tableau de bord est votre écran d'accueil personnalisé : une grille de widgets configurable qui affiche les informations et les contrôles les plus importants pour vous.

## Vue d'ensemble

Contrairement à la vue Accueil (organisée par zones), le Tableau de bord vous laisse choisir exactement ce que vous voulez voir, peu importe la pièce ou le type d'équipement. Vous pouvez placer les lumières de votre cuisine à côté de la température extérieure et du portail de garage, le tout sur un même écran.

![Tableau de bord avec un mélange de widgets équipement et zone](../screenshots/dashboard-overview-fr.png)

## Types de widgets

### Widget d'équipement

Affiche un équipement unique avec son état courant et ses contrôles rapides.

- **Lumières** : interrupteur, curseur de luminosité (pour les lumières variables)
- **Volets** : affichage de la position avec contrôles ouvrir/fermer
- **Capteurs** : valeurs actuelles avec icônes et unités appropriées
- **Thermostats** : affichage de température avec indicateur de mode
- **Interrupteurs** : badge d'état on/off

Les équipements on/off (lumières, interrupteurs, prises, chauffe-eau, vannes, radiateurs, pompes de piscine, lecteurs multimédia, portails à action unique) changent d'état quand vous cliquez **n'importe où sur la tuile**, et pas seulement sur le bouton sous l'icône. Les tuiles à plusieurs contrôles -- volets, thermostats, volets de piscine, VMC -- gardent leurs boutons. En mode édition la tuile n'agit plus, pour que vous puissiez la déplacer et la renommer sans risque.

Une tuile qui affiche une **puissance** en watts (prise avec mesure, chauffe-eau, panneau solaire, compteur) ne l'affiche que tant que la mesure est récente. Au-delà, le chiffre laisse place à un tiret et la tuile indique l'âge de la dernière mesure, plutôt que de présenter une valeur que la maison n'a aucune raison de mettre en doute. Le délai suit la cadence réelle de la source : deux minutes pour un compteur qui remonte en continu, dix pour tout le reste, car plusieurs intégrations interrogent leur source toutes les cinq minutes et un appareil en bon état ne doit pas clignoter à chaque interrogation. Les mesures qui partagent un appareil vieillissent ensemble : une tuile solaire retire le courant et la tension avec la puissance, et le panneau de mesures d'une page d'équipement fait de même, car le silence qui a masqué un chiffre les a tous masqués. Un panneau qui s'est simplement arrêté pour la nuit affiche toujours **Veille**, pas une mesure ancienne : il a cessé de produire, il n'a pas cessé de donner de ses nouvelles. C'est la même règle que la décomposition de consommation de la page Énergie.

La tuile **prévisions météo** affiche demain, et indique à quel point les modèles s'accordent sur cette journée : une pastille en pied de tuile (vert fiable, ambre assez fiable, rouge peu fiable). Cliquez ou touchez la tuile, sur ordinateur comme sur téléphone, pour ouvrir un panneau qui montre les cinq jours de prévision côte à côte, chacun avec sa condition, son maximum, son minimum, son vent et une pastille de fiabilité, ainsi que le modèle d'où vient la prévision. C'est la même pastille que sur la page de l'équipement.

La fiabilité est publiée par le plugin météo à partir de la version 2.0. Avec un plugin plus ancien, la tuile n'affiche aucune fiabilité et le panneau n'affiche aucune pastille : un jour non qualifié ne doit jamais ressembler à un jour fiable.

### Widget de zone

Affiche les données agrégées d'une zone entière. Vous choisissez quelle **famille** de données afficher :

| Famille       | Ce qui est affiché                                                          |
| ------------- | --------------------------------------------------------------------------- |
| **Lumières**  | Nombre de lumières allumées / total, avec une action rapide "tout éteindre" |
| **Volets**    | Nombre de volets ouverts / total, position moyenne                          |
| **Chauffage** | Température moyenne, statut de chauffage                                    |
| **Capteurs**  | Température, humidité, statut de mouvement                                  |

Les widgets de zone vous donnent une vue d'ensemble rapide d'une pièce sans voir les détails de chaque équipement.

### Tuile de recette

Certaines recettes proposent leur propre tuile — un créneau livreur sur un portail, un cycle de filtration, un mode de chauffage. Seules les recettes qui en **déclarent** une apparaissent dans le sélecteur : la plupart des automatisations n'ont rien à montrer d'un coup d'œil et n'en proposent pas.

Ce qu'affiche une tuile de recette est choisi par la recette elle-même, parmi trois éléments :

- une **ligne d'état** : ce que l'automatisation est en train de faire, en une phrase ;
- un **décompte** : le moment où elle agira toute seule, qui descend à la seconde ;
- un ou plusieurs **boutons** qui font défiler les modes de la recette, actionnables directement depuis le Tableau de bord.

Quand une tuile ne porte qu'**un seul** bouton, inutile de le viser : un clic n'importe où sur la tuile fait la même chose. Une tuile qui en porte deux les garde comme seul point d'entrée — elle ne peut pas deviner lequel des deux vous vouliez. En mode édition, un clic ne déclenche rien.

Une recette qui actionne du physique — un portail, une porte — demande confirmation avant d'agir : sur téléphone, une tape sur la tuile ouvre un panneau « glisser pour confirmer » qui annonce ce qu'elle s'apprête à faire, pour qu'une tape dans la poche n'ouvre jamais le portail. Sur ordinateur le clic agit tout de suite, et le petit bouton agit toujours tout de suite, quelle que soit la recette.

À cette question, vous répondez **une seule fois, sur l'équipement**. Une recette dont la tuile ouvre votre portail lit la **Confirmation avant action** de ce portail : activez-la là, et toutes les façons d'ouvrir le portail demandent confirmation ; désactivez-la, et aucune ne le fait. Aucune recette ne peut contredire en douce ce que vous avez décidé pour votre propre portail. Seule une recette qui agit sur plusieurs équipements à la fois — ou sur aucun en particulier — retombe sur un réglage à elle, avec les autres paramètres de l'automatisation.

Une tuile dont l'instance est désactivée s'affiche grisée et garde sa place : une tuile silencieuse n'est jamais un mystère. Si une recette cesse de proposer une tuile après une mise à jour, le widget le dit au lieu de disparaître — supprimez-le vous-même si vous n'en voulez plus.

## Ajouter des widgets

1. Entrez en **mode édition** en cliquant sur l'icône crayon en haut à droite du Tableau de bord
2. Cliquez sur le bouton **+** qui apparaît
3. Dans la fenêtre, choisissez entre :
   - **Équipement** : parcourez et sélectionnez n'importe quel équipement
   - **Zone** : sélectionnez une zone et une famille de données
   - **Recette** : choisissez l'une des instances de recette qui proposent une tuile

Le widget apparaît à la fin de votre grille.

## Personnaliser les widgets

### Réorganiser

En mode édition, glissez-déposez les widgets pour les réorganiser. L'ordre est enregistré automatiquement.

### Étiquettes et icônes personnalisées

Chaque widget peut avoir une étiquette et une icône personnalisées qui remplacent le nom par défaut de l'équipement ou de la zone. C'est utile pour mettre des noms plus courts sur le tableau de bord.

Le sélecteur d'icônes propose d'abord les icônes dessinées qui correspondent au type d'équipement, puis toutes les autres sous **Autres icônes** — une prise qui pilote un compresseur d'air ou une imprimante 3D peut donc porter la machine plutôt qu'une prise.

### Configuration des widgets de capteur

Pour les widgets d'équipements capteurs, vous pouvez choisir quelles liaisons de données afficher. Par défaut, toutes les liaisons sont affichées. Si un capteur remonte température, humidité et pression mais que seule la température vous intéresse, vous pouvez masquer les autres.

### Supprimer des widgets

En mode édition, cliquez sur le bouton de suppression d'un widget pour le retirer du tableau de bord.

## Mode édition

Le mode édition se bascule avec l'icône crayon dans l'en-tête du tableau de bord. Quand il est actif :

- Un bouton **+** apparaît pour ajouter de nouveaux widgets
- Chaque widget affiche un bouton **suppression**
- Les widgets peuvent être **glissés** pour être réordonnés
- Cliquez sur la **coche** pour quitter le mode édition et enregistrer

![Tableau de bord en mode édition : poignées de glisser-déposer, boutons supprimer, action Ajouter](../screenshots/dashboard-edit-fr.png)

!!! tip
Le tableau de bord est personnel : chaque utilisateur a sa propre disposition de widgets. Les utilisateurs admin et les utilisateurs réguliers voient leur propre tableau de bord.

## Astuces

- **Restez concentré** : le tableau de bord fonctionne mieux avec 6 à 12 widgets. Trop de widgets réduisent la valeur d'un coup d'œil.
- **Utilisez les widgets de zone pour l'aperçu** : un widget "Capteurs" de zone pour chaque étage vous donne la température de toute la maison en un coup d'œil.
- **Utilisez les widgets d'équipement pour le contrôle** : mettez les lumières et volets que vous utilisez le plus sur le tableau de bord pour un accès en un seul geste.
- **Adapté au mobile** : sur mobile, les widgets s'empilent en une seule colonne. Placez vos widgets les plus importants en haut.
