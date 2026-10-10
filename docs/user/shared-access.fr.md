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

Une fois la fonction activée, la partie **Sur l'écran d'accueil** donne à la page le **nom** et
l'**icône** qu'elle prendra quand un visiteur l'ajoutera à son écran d'accueil — votre logo, par
exemple. Choisissez une image carrée d'au moins 512 px, sur fond plein de préférence (iOS remplit la
transparence en noir) : elle est recadrée au centre et redimensionnée aux tailles qu'iOS et Android
demandent. Un téléphone déjà installé garde l'ancienne icône jusqu'à ce qu'il réinstalle la page.

!!! warning "Mettez un reverse proxy devant"
La page du visiteur est la seule partie de Sowel qui répond sans compte. Servez-la en HTTPS
uniquement, et laissez votre reverse proxy appliquer son propre quota de requêtes (ci-dessous).

### Un quota de requêtes au reverse proxy { #reverse-proxy-quota }

Exposer `/access/` publiquement **exige un quota de requêtes au reverse proxy**. Sowel ralentit les
codes faux et plafonne le nombre de réponses fausses qu'il retient à la fois, mais il voit chaque
visiteur par l'adresse du proxy, donc il ne peut pas compter les essais par visiteur : seul le proxy
le peut. Un exemple minimal pour Caddy, avec le module
[caddy-ratelimit](https://github.com/mholt/caddy-ratelimit) (construisez Caddy avec
`xcaddy build --with github.com/mholt/caddy-ratelimit`) :

```caddyfile
{
  order rate_limit before reverse_proxy
}

sowel.example.org {
  @access path /access/* /api/v1/shared-access/public/*
  rate_limit @access {
    zone shared_access {
      key    {remote_host}
      events 30
      window 1m
    }
  }
  reverse_proxy localhost:3000
}
```

30 requêtes par minute et par adresse suffisent largement à une personne devant un portail. Si
Caddy est lui-même derrière un autre proxy ou un tunnel, prenez comme clé l'adresse réelle du
visiteur au lieu de `{remote_host}` (derrière Cloudflare, `{http.request.header.CF-Connecting-IP}`).
Un bouncer [CrowdSec](https://www.crowdsec.net/) sur le proxy complète bien : il bannit les
adresses qui s'acharnent à deviner.

Une fois activée, **Accès partagés** apparaît dans le menu principal, après Analyse.

## Créer un accès

Sur la page **Accès partagés**, appuyez sur **Créer un accès**, à côté des onglets : sur l'onglet
d'un portail, l'accès est créé sur ce portail, et s'il n'y a qu'un portail dans la maison, sur
celui-là ; sinon, il demande d'abord le portail. Vous pouvez aussi ouvrir la fiche d'un portail et
appuyer sur **Créer un accès** dans son panneau **Accès partagés**. Puis :

- **Nom** — pour qui : _Plombier_, _Léa_, _Voisins_.
- **Portails** — ceux qu'il ouvre. Seuls les équipements `gate` peuvent être listés. Quand la
  commande d'un portail a plusieurs valeurs (ouvrir / fermer / stop), choisissez celle qui ouvre.
- **Dates** — **Tout le temps**, ou **Du … au …**. La fin ne peut pas précéder le début.
- **Heures** — **Toute la journée**, ou **Par plages**, une ou plusieurs chaque jour (`08:00–20:00`).
  Une plage ne traverse pas minuit, et deux plages ne se chevauchent pas.
- **Avec un code** — coché par défaut. Le code fait huit caractères, affichés `4K7M-9QT2`, pour être
  dicté au téléphone ou affiché dans une entrée. Décochez-le pour quelqu'un qui ne fera que cliquer
  le lien : le lien porte un jeton à lui, impossible à deviner.

Une fois l'accès créé, l'invitation montre le lien, le code et un **QR code** du lien, qu'un
téléphone peut scanner directement sur votre écran ; on les retrouve après un changement de code et
dans l'éditeur. Le QR code est dessiné par votre navigateur : le lien n'en sort pas. Plus tard,
copiez le lien avec l'icône de lien sur la ligne et envoyez-le comme vous voulez.

## Ce que voit le visiteur

Le lien ouvre une page sombre avec une sphère chaude par portail. Le visiteur **tire la sphère vers
le haut**, hors de son socle, pour ouvrir ; relâchée trop tôt, elle retombe et rien n'est envoyé. Au
clavier, **Entrée** deux fois fait la même chose. Sans le lien, la page demande le code.

La page ne dit jamais si le portail est ouvert ou fermé. Elle ne montre que **les commandes du
visiteur lui-même**, et ne parle en mots que quand le portail ne bougera pas — hors des heures, pas
encore valable, suspendu, révoqué — et dit alors pourquoi.

La page est en français sur un téléphone réglé en français, et en anglais sur tous les autres.
Elle tient sur un seul écran. La roue dentée en haut à droite ouvre **Réglages** : les
dernières commandes du téléphone, et un **QR code** que le visiteur fait scanner à la personne qui
l'accompagne pour installer un second téléphone sur le même accès. Quand cette personne n'est pas
là, **Partager** envoie le même lien par le menu de partage du téléphone (Messages, WhatsApp,
e-mail…), et **Copier le lien** le copie. Aucun code n'y est affiché.

Tant que la page n'est pas sur l'écran d'accueil, un encadré explique comment l'y mettre, **selon
le téléphone** : sur iPhone, « Partager » puis « Sur l'écran d'accueil » ; sur Android, le bouton
**Installer** du navigateur, ou le chemin dans son menu. Installée, elle s'ouvre directement sur la
sphère, **sans redemander le code**, comme le même téléphone.

## Gérer les accès

Chaque ligne montre le nom, le code, les dates, les heures, le nombre de téléphones installés et la
dernière utilisation. Depuis la ligne, vous pouvez :

- **copier le lien**, **modifier**, **suspendre** et **reprendre** ;
- **changer le code** — cela renouvelle aussi le lien. Choisissez si les téléphones déjà installés
  continuent de marcher (un e-mail perdu) ou sont coupés (un téléphone perdu) ;
- lire **le journal de cet accès** — chaque ouverture, refus et modification, gardés un an ;
- cliquer sur **N téléphones** pour voir chaque téléphone installé, nommé comme _iPhone · 7K3F_, et
  en **couper** un seul — il revient sur l'écran du code, les autres continuent de marcher ;
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
- Plus de six téléphones sur un même accès lève une alerte — une information, jamais un blocage
  en dessous de 50. À 50 téléphones, un téléphone de plus est refusé.
- Chaque lien dérive d'un secret gardé dans les réglages de Sowel, qui voyagent dans le backup :
  qui détient un backup peut reconstruire les liens en cours. Gardez vos backups comme une clé.
  **Changer le code** tue l'ancien lien d'un accès.
- Les codes sont effacés sept jours après la fin de leur accès.
