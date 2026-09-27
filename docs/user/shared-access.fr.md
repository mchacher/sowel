# Accès partagés

Les accès partagés permettent à **quelqu'un qui n'est pas utilisateur de Sowel** d'ouvrir un portail
pour un temps : un enfant qui rentre de l'école, un artisan le mardi, un voisin qui arrose les
plantes, les clients d'un gîte. Chaque personne reçoit un **lien**, et si vous le voulez un
**code**, qui n'ouvre que les portails choisis, aux dates et aux heures choisies, et que vous
suspendez ou révoquez en un clic.

C'est plus étroit qu'un compte Sowel (qui ouvre tout) et plus sûr qu'une télécommande (qu'on ne
reprend pas).

!!! note "Désactivé par défaut"
Tant que vous ne l'activez pas, Sowel n'affiche ni page, ni panneau, ni adresse publique, et
rien ne change dans son comportement. Seul un **administrateur** gère les accès.

## L'activer

1. Allez dans **Réglages**, section **Accès partagés**.
2. Activez-la.
3. Renseignez l'**adresse publique** vers laquelle pointeront les invitations, par exemple
   `https://acces.exemple.fr`, et le **chemin** de la page (`/access/` par défaut).

L'adresse publique doit joindre Sowel depuis l'extérieur de votre réseau — voir
[Accès distant](remote-access.md). Si vous donnez à la page un nom d'hôte à elle, faites-le pointer
vers le chemin `/access/` de Sowel et réglez le chemin sur `/`.

!!! warning "Mettez un reverse proxy devant"
La page du visiteur est la seule partie de Sowel qui répond sans compte. Servez-la en HTTPS
uniquement, et laissez votre reverse proxy appliquer son propre quota de requêtes.

Une fois activée, **Accès partagés** apparaît dans le menu principal, après Analyse.

## Créer un accès

Sur la page **Accès partagés**, appuyez sur **+ portail** et choisissez le portail, ou ouvrez la fiche
d'un portail et appuyez sur **Créer un accès** dans son panneau **Accès partagés**. Puis :

- **Nom** — pour qui : _Plombier_, _Léa_, _Voisins_.
- **Portails** — ceux qu'il ouvre. Seuls les équipements `gate` peuvent être listés. Quand la
  commande d'un portail a plusieurs valeurs (ouvrir / fermer / stop), choisissez celle qui ouvre.
- **Dates** — **Tout le temps**, ou **Du … au …**. La fin ne peut pas précéder le début.
- **Heures** — **Toute la journée**, ou **Par plages**, une ou plusieurs chaque jour (`08:00–20:00`).
  Une plage ne traverse pas minuit, et deux plages ne se chevauchent pas.
- **Avec un code** — coché par défaut. Le code fait huit caractères, affichés `4K7M-9QT2`, pour être
  dicté au téléphone ou affiché dans une entrée. Décochez-le pour quelqu'un qui ne fera que cliquer
  le lien : le lien porte un jeton à lui, impossible à deviner.

Copiez le lien avec l'icône de lien sur la ligne et envoyez-le comme vous voulez.

## Ce que voit le visiteur

Le lien ouvre une page sombre avec une sphère chaude par portail. Le visiteur **tire la sphère vers
le haut**, hors de son socle, pour ouvrir ; relâchée trop tôt, elle retombe et rien n'est envoyé. Au
clavier, **Entrée** deux fois fait la même chose. Sans le lien, la page demande le code.

La page ne dit jamais si le portail est ouvert ou fermé. Elle ne montre que **les commandes du
visiteur lui-même**, et ne parle en mots que quand le portail ne bougera pas — hors des heures, pas
encore valable, suspendu, révoqué — et dit alors pourquoi.

## Gérer les accès

Chaque ligne montre le nom, le code, les dates, les heures, le nombre de téléphones installés et la
dernière utilisation. Depuis la ligne, vous pouvez :

- **copier le lien**, **modifier**, **suspendre** et **reprendre** ;
- **changer le code** — cela renouvelle aussi le lien. Choisissez si les téléphones déjà installés
  continuent de marcher (un e-mail perdu) ou sont coupés (un téléphone perdu) ;
- lire **le journal de cet accès** — chaque ouverture, refus et modification, gardés un an ;
- **révoquer**, puis **supprimer** une fois révoqué ou terminé. Le journal survit à l'accès.

Le fil **Activité** nomme chaque ouverture : _Accès partagé — Plombier_.

## Armer un portail

Chaque portail porte un interrupteur **armé**, sur sa fiche et sur son onglet. Désarmé, tout appui
sur ce portail est refusé et le visiteur lit que la maison a refusé ; les accès sont gardés.
Désarmer le garage laisse le portail d'entrée tranquille.

## Profils et plugins

Un plugin (par exemple le connecteur d'un système de réservation) peut créer des accès lui-même :
un par séjour, qui se termine avec le séjour. Il ne choisit jamais ce qui s'ouvre — c'est **vous**,
avec les **profils**.

L'onglet **Profils** les rassemble. Un profil porte un nom, les portails, les dates et les heures
(les deux mêmes groupes qu'un accès), si ses accès ont un code, et le plugin auquel il est
**accordé**. Un profil **Par défaut** est créé à l'activation, avec votre portail déjà listé si
vous n'en avez qu'un ; l'accès d'un plugin qui ne nomme pas de profil l'utilise. Il ne se supprime
pas ; les autres, si.

L'accès d'un plugin a toujours une fin. Sowel l'applique seul, même plugin arrêté, et un client qui
revient reçoit un nouveau lien et un nouveau code.

## Sécurité

- Un code est cherché avant toute chose, et **un code juste n'est jamais ralenti**. Les codes faux
  sont répondus de plus en plus lentement au-delà de dix en dix minutes, et au-delà de 25 vous êtes
  alerté.
- Plus de six téléphones sur un même accès lève une alerte — une information, jamais un blocage.
- Les codes sont effacés sept jours après la fin de leur accès.
