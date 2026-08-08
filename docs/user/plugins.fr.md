# Plugins

Tout ce que Sowel connecte -- et chaque recette d'automatisation qu'il exécute -- arrive sous forme de **plugin**. Une installation Sowel neuve n'a aucun plugin : vous choisissez dans le store les intégrations et recettes dont vous avez besoin, et seules celles-là tournent sur votre instance.

Les plugins se gèrent depuis **Administration > Plugins** (admin uniquement).

---

## Les deux onglets

**Installés** liste ce qui tourne sur votre instance :

- Les **intégrations** affichent leur état de connexion et le nombre d'appareils qu'elles alimentent. Depuis cette liste, vous pouvez désactiver, réactiver, mettre à jour ou désinstaller chacune.
- Les **recettes** sont les modèles d'automatisation disponibles quand vous créez des instances de recettes.

**Store** liste ce que vous pouvez installer. Les entrées viennent du catalogue officiel Sowel, plus vos propres sources personnelles (voir plus bas). Le bouton **Rafraîchir** relit le catalogue immédiatement, utile juste après l'annonce d'un nouveau plugin ou d'une nouvelle version.

Quand une version plus récente d'un plugin installé est disponible, un badge de mise à jour apparaît sur sa ligne (et dans le panneau de mises à jour de la barre du haut). La mise à jour conserve tous vos réglages, appareils, liaisons d'équipements et historiques : seul le code du plugin change.

---

## Niveaux de confiance

Chaque entrée du store appartient à l'un des trois niveaux de confiance, pour que vous sachiez toujours quel code vous vous apprêtez à exécuter :

| Niveau            | Badge               | Qui le publie                    | Ce que Sowel vérifie                                                                                  |
| ----------------- | ------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Officiel**      | aucun               | Le mainteneur de Sowel           | Empreinte d'intégrité épinglée dans le catalogue officiel, code maintenu avec Sowel                   |
| **Communautaire** | **Community** ambre | Un développeur tiers             | Empreinte d'intégrité épinglée dans le catalogue officiel ; le code lui-même n'est pas revu par Sowel |
| **Personnel**     | **Perso** bleu      | Vous (vos propres dépôts GitHub) | Empreinte que vous approuvez vous-même à l'installation, puis épinglée (voir plus bas)                |

Installer un plugin communautaire demande une confirmation unique. Installer ou mettre à jour un plugin personnel demande toujours une confirmation, en montrant exactement ce que vous allez exécuter.

---

## Sources personnelles

Les sources personnelles permettent d'installer **vos propres plugins et recettes** sans les publier au catalogue officiel. Usages typiques : une recette écrite pour votre propre maison, ou l'essai d'un plugin que vous développez avant de le partager.

### Prérequis

Une source personnelle est un **dépôt GitHub public** qui a au moins une release avec un asset `sowel-*.tar.gz` -- le packaging standard des plugins Sowel. Si vous écrivez votre première recette, le [guide de développement de recettes](../technical/recipe-development.fr.md) explique comment produire exactement cela.

### Ajouter une source

1. Ouvrez **Administration > Plugins > Store** et descendez jusqu'à **Sources personnelles**.
2. Saisissez le dépôt au format `owner/repo` (par exemple `jdoe/sowel-recipe-ma-recette`) et cliquez sur **Ajouter**.
3. La source apparaît dans la liste avec la version de sa dernière release. Si le dépôt n'a pas encore de release, elle est conservée avec la mention « pas encore de release » et devient installable dès que vous en publiez une.

Le plugin apparaît alors dans le store avec le badge bleu **Perso**.

### Installer : la confirmation par empreinte

Quand vous cliquez sur **Installer** pour un plugin personnel, Sowel télécharge la release, calcule son **empreinte SHA256**, et l'affiche dans une boîte de confirmation avec le dépôt et la version.

- Confirmer installe exactement le contenu correspondant à cette empreinte et l'**épingle**. Si le fichier change un jour derrière la même version, Sowel le refuse.
- Chaque **mise à jour** ultérieure réaffiche la même boîte avec la nouvelle version et la nouvelle empreinte, parce que le contenu a changé depuis votre dernière validation. Rien ne se met à jour dans votre dos.

!!! warning "Vous faites confiance au propriétaire du dépôt"
Personne ne relit le code d'un plugin personnel. Il s'exécute avec les mêmes privilèges que Sowel lui-même. N'ajoutez que des dépôts que vous possédez ou en qui vous avez pleinement confiance -- l'empreinte garantit que _ce que_ vous installez ne change jamais silencieusement, pas que le code est sûr.

### Retirer une source

Retirer une source ne désinstalle **pas** les plugins déjà installés depuis celle-ci : ils continuent de fonctionner. Cela bloque seulement les installations et mises à jour futures depuis ce dépôt. Ré-ajouter la source plus tard rétablit les mises à jour.

---

## Pour les auteurs de plugins et de recettes

Envie d'en construire un ? Les guides techniques couvrent tout le parcours, du squelette à la publication :

- [Développement de recettes](../technical/recipe-development.fr.md) -- modèles d'automatisation
- [Développement de plugins](../technical/plugin-development.fr.md) -- intégrations d'appareils, packaging et releases

Quand votre plugin mérite d'être partagé au-delà de chez vous, le niveau communautaire est l'étape suivante : une entrée au catalogue officiel, pour que n'importe quel utilisateur Sowel puisse l'installer depuis le store.
