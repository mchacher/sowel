# Notes de version

Sowel est versionné et déployé via CI/CD depuis `v1.0.0` (avril 2026, spec 055). Chaque version est publiée sous forme de :

- Release GitHub avec un changelog généré — [github.com/mchacher/sowel/releases](https://github.com/mchacher/sowel/releases)
- Image Docker multi-arch taggée `ghcr.io/mchacher/sowel:<version>` et `:latest`

Cette page résume toutes les versions publiées, de la plus récente à la plus ancienne. Pour le diff complet entre deux versions : `https://github.com/mchacher/sowel/compare/v<a>...v<b>`.

**Mettre à jour une instance en cours.** Sowel interroge GitHub toutes les heures et fait apparaître la mise à jour disponible dans la barre supérieure. Un clic sur la pastille ouvre la feuille des mises à jour et applique la nouvelle version en un clic (ajouté en v1.9.0). En ligne de commande : `cd /opt/sowel && docker compose pull && docker compose up -d`.

---

## 1.68.x : L'alias qui voulait dire deux choses

### v1.68.0 — 2026-09-05 { #v1-68-0 }

La v1.67.1 a appris au chien de garde des ordres que `power` veut dire deux choses sur un thermostat sous-compté : le booléen envoyé au device cloud et la puissance lue par la pince sur son alimentation. Cette version l'apprend au reste du produit, car le chien de garde n'était que la première victime. L'interface elle-même comparait ce wattage à `true` depuis des mois et concluait, à chaque rendu, qu'une pompe à chaleur en marche était éteinte.

- Correctif (ui) : **le marche/arrêt d'un thermostat se lit sur son propre état, jamais sur la pince** (spec 176, #904). Sur un thermostat sous-compté, chaque surface dérivait la bascule de `power === true`, et `2974 === true` est faux : la carte affichait toujours OFF pendant que l'unité tournait à 2974 W, chaque appui renvoyait ON — cinq ordres ON en 90 secondes mesurés en production, d'un utilisateur qui essayait d'arrêter la machine — et l'éteindre réellement exigeait un double appui dans la fenêtre optimiste, la carte effaçant par ailleurs tout son état optimiste au moindre changement de donnée alors que la pince pousse un wattage toutes les quelques secondes. Le booléen du device se lie désormais sous `state`, le même alias marche/arrêt que tous les équipements à relais, aucun mot nouveau dans le modèle de données ; l'alias n'était simplement jamais proposé aux thermostats, la liste d'auto-liaison datant d'avant les catégories de la spec 077. La liaison est marquée `appliance_state` au lieu d'hériter de la catégorie `power` du device, et cette ligne est ce qui garde le moteur d'énergie honnête : sans elle, un thermostat sous-compté porte deux liaisons de catégorie power et l'arbitre, l'intégrateur de sous-comptage et le panneau énergie prennent chacun la première ligne venue. Toute lecture marche/arrêt passe désormais par un résolveur unique — l'alias `state` d'abord, un `power` booléen hérité ensuite, un wattage jamais — et la bascule optimiste s'efface par alias, quand son propre miroir re-rapporte ou après 90 secondes, au lieu de disparaître à la première mesure venue. Les thermostats existants ne changent pas ; un thermostat sous-compté gagne son état le jour où son propriétaire ajoute la liaison que le panneau des liaisons manquantes propose désormais. Deux bugs latents sont morts au passage : un thermostat fraîchement lié perdait silencieusement ses points d'alimentation, de consigne et de sonde extérieure, et son ordre d'alimentation atterrissait sous un alias qu'aucune surface thermostat ne pilote. Version compagnon : panasonic_cc 2.3.2 ajoute un poll de rattrapage 45 s après un ordre, Comfort Cloud rapportant couramment encore l'état d'avant l'ordre au premier poll, la vérité suivante étant à cinq minutes.
- Maintenance (deps) : les groupes hebdomadaires d'outillage — mises à jour minor/patch backend et UI, typescript-eslint 8.69, codeql-action v4 (#896, #897, #898, #899, #900).

---

## 1.67.x : L'horloge sur laquelle une mesure est jugée

### v1.67.1 — 2026-09-04 { #v1-67-1 }

- Correction (équipements) : **un ordre est vérifié là où il a réellement été envoyé** (#901, #902). Confirmer un ordre consiste à guetter le retour de la valeur ordonnée, et la lecture à guetter était choisie sur le seul alias, ce qui suppose qu'un alias désigne une seule chose par équipement. Sur un appareil sous-compté il en désigne deux : `power`, c'est le booléen envoyé à un thermostat cloud et, en même temps, la puissance lue par la pince posée sur son alimentation. Le moteur comparait donc `true` à `646` à chaque ordre, ce qu'aucun relevé ne pourra jamais rendre vrai, si bien que le chien de garde expirait à tous les coups et levait une alarme. Mesuré sur une instance de production pendant quinze jours : quinze ordres de mise en marche, quinze alarmes, toutes fausses, sur une pompe à chaleur qui a obéi à chaque fois. Le miroir est désormais résolu par ordre de préférence, une liaison sur l'appareil même auquel l'ordre est parti, puis la liaison sur un autre appareil si son type peut rapporter la valeur, puis l'état propre de l'appareil ciblé sous la clé de l'ordre, là où un thermostat cloud publie ce que personne n'a lié. C'est cette dernière étape qui fait qu'un tel ordre se confirme au lieu de simplement cesser d'alerter. Quand aucune des trois n'existe, l'ordre reste suivi et rejoué, mais il sort de la surface d'alarme : une alarme que rien ne peut résoudre est du bruit. Un appareil qui rapporte vraiment l'état inverse alarme toujours, ce qui est toute la raison d'être de la fonction.

### v1.67.0 — 2026-09-04 { #v1-67-0 }

Une puissance est la mesure qui ment sans bruit, et la v1.65.0 avait commencé à apprendre à l'interface à s'en méfier. Cette version termine le travail en posant la seule question qui manquait encore : à quelle fréquence cette source parle-t-elle vraiment ? Toutes les règles de fraîcheur du moteur reposaient sur une constante, et une constante est forcément fausse pour quelqu'un : un Shelly à 1 Hz et un relevé cloud toutes les cinq minutes ne peuvent pas partager la même fenêtre. Le reste de la version parle de pannes silencieuses, d'une mise à jour qui a bloqué une instance six heures sans dire un mot, et de deux barrières déplacées là où elles coûtent encore peu.

- Fonctionnalité (équipements) : **une mesure de puissance est jugée sur la cadence de sa propre source** (spec 175, #883, #889). Quatre surfaces décidaient si une puissance pouvait être affichée comme une mesure vive, et elles se contredisaient : un compteur à trois minutes d'un cycle de 300 s parfaitement sain était silencieux dans le bandeau Direct, « périmé » sur sa tuile du tableau de bord, et exclu du total de sa zone, au même instant. Les quatre appelaient déjà le même classificateur ; ce qui différait, c'était le budget qu'on lui passait, et ce budget venait du **type** de l'équipement. Un type ne dit rien de la fréquence à laquelle un appareil parle, `main_energy_meter` couvrant aussi bien un compteur à 1 Hz qu'un relevé à 300 s. La fenêtre vient désormais de ce que fait la source : la médiane des dix derniers intervalles entre arrivées, à défaut l'intervalle de relevé déclaré par l'intégration, à défaut dix minutes prudentes tant qu'aucun des deux n'est connu. Le budget vaut 2,5 fois cette cadence, plancher à deux minutes et plafond à trente, résolu une seule fois et porté par la liaison, si bien que toutes les surfaces comparent un âge au même nombre par construction et non par discipline. La détection suit la source : un compteur à 1 Hz qui meurt apparaît en deux minutes là où il en fallait dix, et un relevé toutes les cinq minutes garde son silence. Le facteur est 2,5 et non 2 parce qu'un relevé « 300 s » arrive couramment entre 305 et 320 s, et qu'au double exact de la cadence une source saine se tient sur la frontière et oscille.
- Correction (interface) : **le bandeau de l'énergie en direct lit la mesure, pas seulement une horloge** (#881, #882). Il annonçait que le relevé du réseau ou de la production était figé depuis trois minutes, sur des compteurs qui fonctionnaient, et l'écran ne permettait pas de trancher : la puissance est arrondie aux 5 W sous 1 kW, donc une valeur affichée 2,4 kW peut varier de 49 W sans qu'un pixel bouge. Le bandeau posait une seule question, et elle ne portait jamais sur la mesure : depuis combien de temps le dernier message est-il arrivé, face à 120 s en dur, calibrés pour un compteur qui émet chaque seconde. Les deux sources interrogées du registre publient sur un cycle de 300 s, donc le bandeau s'allumait trois minutes sur cinq, en permanence, et a fini par être lu comme du bruit. Le silence dispose maintenant de dix minutes, le double de la cadence la plus lente supportée, et une valeur bloquée reçoit son propre verdict, lu sur l'horodatage du dernier changement de la valeur stockée, à pleine précision. Une source qui republie éternellement une valeur en cache satisfait tous les contrôles d'arrivée jamais écrits, et jusqu'ici personne ne posait la question.
- Correction (mise à jour) : **une mise à jour qui échoue le dit, que l'assistant meure ou ne réponde jamais** (#880, #884, #885). Découvert sur une instance bloquée sur « mise à jour en cours » pendant six heures. Le moteur lance un conteneur assistant en supposant qu'il finira toujours par l'arrêter, donc rien ne libérait l'indicateur `updating` quand l'assistant mourait le premier : la surcouche plein écran restait affichée pour toute la vie du processus et chaque mise à jour ou redémarrage ultérieur répondait 409, un `docker restart` manuel étant la seule sortie. Le 2026-09-02, un délai d'attente sur ghcr.io a produit exactement cela. Le moteur surveille désormais l'assistant qu'il a lancé, et atteindre ce rappel signifie que la bascule n'a pas eu lieu, puisqu'un assistant qui réussit recrée Sowel et que ce processus meurt en premier. Il libère l'indicateur et rapporte l'échec avec les dernières lignes de l'assistant, à la place même de la surcouche plutôt qu'en faisant disparaître le spinner, ce qui était indiscernable d'une mise à jour réussie ayant oublié de recharger. La seconde moitié couvre l'assistant qui ne répond jamais, un téléchargement vers un registre qui accepte la connexion puis se tait : l'attente est maintenant mise en concurrence avec un chien de garde de quinze minutes, bien au-delà d'un téléchargement normal sur une liaison lente. Abandonner ne tue pas l'assistant, qui peut être en train de recréer la pile ; il n'est supprimé qu'une fois réellement terminé.
- Correction (interface) : **une action de plugin refusée s'affiche sous la ligne** (#880). Activer, désactiver et désinstaller attrapaient leurs erreurs et les ignoraient purement, et le chemin de mise à jour laissait tomber tout ce qu'il ne reconnaissait pas. Le refus apparaît désormais sous la ligne et dans la feuille de détail, où vit la désinstallation. Le cas qui l'a révélé : renommer le dépôt GitHub d'un paquet personnel. GitHub redirige l'ancien nom, donc l'ancien identifiant continue d'annoncer une mise à jour qui ne pourra jamais s'installer, et l'explication du serveur n'atteignait pas l'écran.
- Maintenance (plugins) : **six intégrations MQTT ont reçu le même correctif de connexion** (#891, et un rapport qui vaut la lecture, `sowel-plugin-zigbee2mqtt#19`). Un broker pas encore joignable au démarrage de Sowel est une course de démarrage ordinaire, mais elle laissait le plugin figé sur « déconnecté » pour toute sa durée de vie : les données des équipements s'arrêtaient au premier message retenu et les ordres ne partaient jamais, jusqu'au redémarrage du conteneur. Les abonnements émis sur une socket fermée n'étaient pas réessayés non plus, et comme le client utilise des sessions propres, cette perte se produisait aussi après n'importe quelle reconnexion ultérieure, pas seulement au démarrage. Le même fichier vivait dans six dépôts, cinq d'entre eux à l'octet près, donc les six sont publiés : zigbee2mqtt 2.7.1, somfy-rts 1.1.1, tasmota 1.0.7, shelly_mqtt 1.2.3, displays 0.2.2, apsystems 0.1.1. Mettez-les à jour depuis la page des plugins.
- Maintenance (ci) : **deux barrières déplacées là où on peut encore y répondre à bas coût** (#872, #886, #892, #893). Une ligne manquante dans l'index des specs échouait au tag, faisant payer à une version un manque que l'auteur aurait comblé avec une ligne de tableau : les v1.64.0 et v1.65.0 ont toutes deux été bloquées ainsi, et les deux tags ont dû être forcés. Cette moitié du contrôle tourne désormais sur la pull request, sur les deux index, et affiche la ligne à coller dans la bonne langue. L'autre barrière est nouvelle : rien ne vérifiait que le SHA256 d'une entrée du registre était bien l'empreinte de l'archive que GitHub publie pour la version écrite à côté, et une paire fausse casse l'installation sur toutes les instances environ une heure plus tard, une fois le CDN propagé. Une entrée modifiée est maintenant confrontée à son archive publiée, empreinte et manifeste, sur la pull request qui la modifie. La procédure de release elle-même avait deux contrôles de retard sur ce que la CI exige, et lance désormais le même ensemble (#894).

---

## 1.66.x : Ce que le moteur ne savait pas dire

### v1.66.0 — 2026-09-01 { #v1-66-0 }

Trois fonctionnalités, et chacune est partie de quelque chose que le moteur n'avait aucun mot pour exprimer. Une décomposition dont l'arithmétique supposait que deux pinces ne mesurent jamais le même courant, alors qu'un tableau électrique est précisément l'endroit où elles le font. Un portail qu'il faut ouvrir pour quinze minutes, qu'aucun équipement ne savait formuler, si bien que trois recettes tenaient chacune leur horloge et divergeaient déjà sur le moment d'annuler. Et une tuile du tableau de bord qui affichait ce qu'un clic ferait, et ne faisait rien quand on cliquait.

- Fonctionnalité (énergie) : **un compteur peut déclarer qu'il est situé à l'intérieur d'un autre** (spec 173, #873). La décomposition par usage découpe le total de la maison en tranches et appelle le reste « autre », ce qui ne tient que tant que les sous-compteurs sont disjoints. Le cas qui l'a fait apparaître : un gîte mesuré par une pince, et son chauffe-eau, alimenté depuis ce même tableau, par une seconde. Les deux s'enrôlent comme sous-compteurs, donc les kilowattheures du chauffe-eau tombaient dans deux tranches et le résidu perdait autant, 2,09 kWh comptés deux fois sur une journée de 12,3 kWh lors d'un cycle de nuit. Rien ne permettait de le configurer : les seuls leviers étaient de supprimer la mesure ou de couper son historisation, un chiffre faux échangé contre un historique perdu. Un équipement porte désormais `meteringParentId`, « ma consommation est déjà comptée par ce compteur-là », et la décomposition affiche chaque parent moins ses enfants _directs_, ce qui est ce qui fait qu'une chaîne se retotalise : pour A ⊃ B ⊃ C, A−B plus B−C plus C vaut exactement A. Le donut en direct de la même page suit la même règle, un enfant sans mesure vive ne soustrayant rien plutôt que de dépenser « nous ne savons pas » sous forme de chiffre. Ce qui ne change pas, c'est partout où un compteur est lu comme un capteur : la carte de l'équipement, les cumuls, l'API d'historique et l'agrégation de zone gardent la mesure brute, parce qu'une carte qui contredit son propre capteur serait pire que le bug. Seule la partition soustrait, et elle le dit, « net de ses sous-compteurs ». Le sélecteur ne propose jamais une option qui échouerait, la route refuse un cycle en parcourant le graphe que la déclaration créerait plutôt que la seule paire, et supprimer un parent efface les déclarations qu'il contenait.
- Fonctionnalité (équipements) : **le moteur tient « agis maintenant, reviens en arrière dans N »** (spec 174, #875). Rien ne savait l'exprimer, donc chaque occurrence était une recette tenant sa propre horloge : motion-light, state-trigger-light, delivery-gate, trois copies d'une même échéance avec trois jeux de règles d'annulation. Un équipement porte désormais au plus un retour en arrière que le moteur lui doit, et à quelle heure. L'action reste un ordre ordinaire, qui hérite de l'inversion, de la résolution de valeur et de la confirmation de livraison sans que rien n'en soit redit ; ce qui est ajouté est la seule chose qui manquait, quelque chose qui se souvient, à travers un redémarrage, que le portail de la cour est ouvert. L'échéance est une ligne en base et non une minuterie en mémoire : celle encore à venir est reprogrammée sur son reliquat au démarrage, et celle qui est passée pendant que le moteur était arrêté se déclenche à la remontée, cette panne étant précisément le cas pour lequel la fonctionnalité existe. Quatre règles ont été décidées plutôt que découvertes en production. Un retour en arrière fait à la main désarme la fenêtre, parce que se déclencher plus tard déferait le geste de l'utilisateur. Un second armement de la même action déplace l'échéance et n'envoie rien : « ouvre encore », de la part de quelqu'un qui regarde un portail ouvert, veut dire « laisse-moi plus de temps ». Un retour en arrière qui n'a pas pu être envoyé lève une alarme et s'arrête, le moteur n'ayant aucun moyen de savoir si un second envoi remettrait l'équipement en place ou agirait dessus une fois de plus. Et supprimer l'équipement emporte l'échéance avec lui. La commande se configure par équipement par un administrateur et s'arme depuis la page de l'équipement, depuis une seconde tuile épinglée à côté de l'ordinaire, ou depuis la ligne compacte, les trois affichant un seul compte à rebours qui relit l'échéance du moteur à chaque tick plutôt que de décompter depuis un nombre capturé à l'ouverture de la page. Un équipement n'est éligible que s'il porte à la fois l'ordre et une mesure d'état qui lui est liée : sans elle, un retour en arrière fait à la main ne pourrait jamais désarmer la fenêtre, et l'échéance agirait sur un équipement qui a bougé depuis.
- Fonctionnalité (interface) : **un clic n'importe où sur une tuile de recette déclenche sa commande** (spec 171, #868). La spec 169 a donné une tuile à une instance de recette et a laissé toute la carte inerte : la seule chose qui agissait était la pastille en bas, sur une carte qui affichait « Prêt — un clic ouvre le Portail pour 15 min ». Tous les autres widgets de ce tableau de bord actionnent au clic sur la carte depuis la spec 098. Une tuile qui n'affiche qu'une seule commande la déclenche désormais depuis toute la carte, même cycle et même valeur suivante, la pastille restant là pour qui préfère viser ; deux commandes et la carte reste inerte, puisqu'il lui faudrait deviner laquelle, et il en va de même sans aucune commande, sur une instance désactivée et en mode édition. Comme cela transforme un carré de 240 px en ouvre-portail, la recette déclare ce qu'il faut demander d'abord. `tile.confirmFrom`, qui nomme l'emplacement d'équipement que la commande actionne, est la réponse qui passe à l'échelle : la « Confirmation avant action » de cet équipement décide alors seule, donc la question est répondue une fois, sur le portail, pour toutes les surfaces qui l'actionnent, et quelqu'un qui a activé la garde sur son Portail n'obtient plus une tuile qui part au premier effleurement. Là où aucun équipement ne peut être dérivé, un emplacement booléen nommé dans `confirmParam` laisse l'instance décider, et `tile.confirm` reste le défaut du paquet pour une instance à qui la question n'a jamais été posée. Sur mobile, la carte gardée ouvre la feuille glisser-pour-confirmer de la spec 146 en nommant la position vers laquelle elle va basculer ; la pastille n'est jamais gardée et le bureau ne confirme jamais, une petite cible et un clic de souris étant déjà délibérés.
- Fonctionnalité (interface) : **deux icônes d'atelier, et une imprimante qui montre lequel de ses quatre états elle occupe** (#876). Une prise connectée dans un atelier pilote le plus souvent un compresseur ou une imprimante 3D, et le sélecteur n'avait de forme pour aucun des deux : tous deux portaient une prise murale. L'imprimante est éteinte, sous tension à l'arrêt, en impression, ou en défaut, et c'est ce dernier état qu'on surveille sur une prise, donc elle prend un état plutôt qu'un booléen : le défaut se lit comme une pastille et pas seulement comme une couleur, ce qui lui permet de survivre à un œil daltonien comme à une case de 48 px.
- Maintenance : le guide de l'agent demande des réponses courtes et ordonnées dans le terminal (#877).

---

## 1.65.x : Un total, et les mesures qu'il refuse

### v1.65.0 — 2026-08-31 { #v1-65-0 }

Un chiffre arrive dans l'en-tête de zone, et l'essentiel du travail est allé à décider ce qui a le droit d'y entrer. Une puissance est la mesure qui ment sans bruit : une pince qui a cessé de rapporter garde sa dernière valeur, et un `0 W` périmé se lit comme un appareil éteint plutôt que comme une question. Trois des quatre changements portent là-dessus, et le quatrième sur un panneau capable de poser une question mais pas d'en accepter la réponse.

- Fonctionnalité (zones) : **une zone totalise la puissance que ses compteurs mesurent** (spec 170, #866, #867). Une zone savait dire s'il y fait chaud et si quelqu'un s'y trouve, mais pas combien cette partie de la maison consomme, alors que chaque watt de la réponse était déjà dans le moteur. Le cas qui l'a fait apparaître : un gîte mesuré par deux pinces, l'une sur son arrivée propre et l'autre sur une plaque alimentée depuis le tableau principal, donc deux équipements dans une même zone que rien ne savait additionner. Aucun équipement ne peut porter les deux mesures, l'alias d'une liaison étant unique par équipement, et les graphiques ne font pas d'arithmétique entre séries. L'en-tête de zone porte désormais une pastille de puissance qui somme la zone et toutes ses descendantes, par la même fusion d'accumulateurs que le total de débit d'eau utilisait déjà. Ce qui a le droit d'entrer dans cette somme est décidé par des règles que le moteur applique déjà ailleurs plutôt que par de nouvelles : le compteur principal et les compteurs de production ne comptent jamais, puisque c'est exactement ce qui sépare un sous-compteur d'un bilan de maison dans la décomposition énergie, et une mesure au-delà de son budget de fraîcheur est écartée plutôt que comptée comme zéro. Une zone sans compteur n'affiche aucune pastille, ce qui n'est pas la même chose qu'une zone dont tous les compteurs lisent `0 W`, et une pince montée à l'envers est sommée telle qu'elle rapporte, en négatif, parce qu'un total négatif est un défaut de câblage qui mérite d'être vu. La première implémentation portait trois défauts, corrigés dans la même version (#867) : un compteur Legrand NLPC n'a pas de canal `power` du tout, sa mesure vive étant `demand_5min`, si bien que sommer `power` seul ne lisait pas une valeur périmée mais rien du tout, et le compteur disparaissait du total pendant que sa propre carte affichait des watts en direct ; la règle de fraîcheur n'avait pas d'horloge, l'agrégateur ne recalculant que lorsqu'un équipement rapporte et une pince devenue muette ne rapportant rien, si bien que dans le cas précis pour lequel la fonctionnalité a été écrite, une zone qui tient deux compteurs et rien d'autre, le total restait figé indéfiniment sur sa dernière valeur, et un tick de 60 s réévalue maintenant les zones qui portent des mesures ; et la somme est arrondie au watt entier, les dixièmes n'ayant jamais été affichés tout en garantissant que la gigue inférieure au watt d'une prise au repos publiait un événement sur toute la chaîne des zones parentes à chaque rapport de compteur de la maison.
- Correction (ui) : **une puissance périmée n'est plus dessinée comme une mesure en direct** (#865, issue #839). Huit endroits de rendu répartis dans cinq fichiers affichaient des watts sans jamais consulter l'âge de la mesure. Le drapeau `stale` du moteur ne peut pas répondre à cette question, et c'est délibéré : la fenêtre électrique ne s'applique qu'aux compteurs déclarés, parce qu'une fenêtre serrée sur une charge stable signalerait un appareil en bonne santé comme dégradé à chaque cycle de rapport, si bien qu'un chauffe-eau portant un canal de puissance rapporte `stale: false` quel que soit l'âge de sa valeur. Mesuré en production : 560 W tirés et `0 W` affichés, mesure vieille de 944 s, et un poêle à bois portant une valeur vieille de 124 jours. La règle existait déjà et servait déjà la décomposition en direct et le flux sous-compteurs ; ce qui manquait, c'était un moyen pour les tuiles de la lui poser. Elles le font désormais, et une mesure qui ne peut pas être présentée comme actuelle est remplacée par un tiret suivi de son âge plutôt que par un chiffre. Deux sources reçoivent un budget plus large parce qu'elles ne peuvent pas être plus fraîches par construction : une puissance `demand_5min` est déjà moyennée sur cinq minutes, et la seule intégration solaire du registre livre sur une cadence Tasmota de 300 s.
- Correction (ui) : **un paquet personnel se met à jour depuis le panneau de la barre supérieure** (spec 172, #869). Un paquet installé depuis votre propre source GitHub ne se met à jour qu'après que vous ayez re-validé l'empreinte de la nouvelle version, ce qui est précisément la garantie que la spec 136 apporte. Le panneau des mises à jour proposait bien un bouton Mettre à jour pour ces paquets, puis affichait le refus du serveur sous forme de code d'erreur brut en rouge, faute de savoir ouvrir la fenêtre d'empreinte. Le seul chemin qui aboutissait passait par Administration puis Plugins : le panneau conçu pour être l'endroit unique des mises à jour était le seul endroit où une mise à jour personnelle ne pouvait pas se faire. La fenêtre quitte la page Plugins pour un composant partagé, et les deux surfaces ouvrent la même. La garde, elle, ne bouge pas : une nouvelle version est un nouveau contenu, et son empreinte se confirme toujours version par version. Seul change l'endroit où l'on peut répondre à la question.
- Maintenance (docs) : quatorze captures d'écran rafraîchies dans la documentation, une page anglaise qui affichait du français, et une fuite que les jeux de données anonymisés avaient laissé passer (#863, #864).

---

## 1.64.x : Ce que la suite de tests ne peut pas voir

### v1.64.0 — 2026-08-30 { #v1-64-0 }

Quatre des cinq changements ici ont été façonnés, ou corrigés, en regardant la chose sur un téléphone. Une bande de cinq jours qui passait tous les tests de composants et encombrait la tuile où on l'avait ajoutée. Un filet de confiance d'une hauteur calculée nulle, ne peignant rien, sous une suite qui ne calcule aucune mise en page. Un glisser-pour-confirmer qu'aucun pouce ne pouvait terminer. jsdom ne dispose rien et un navigateur dispose tout, et cette version est surtout la différence entre les deux.

- Fonctionnalité (ui) : **la tuile météo qualifie demain, et les cinq jours tiennent derrière une tape** (spec 168, #850, #851, #857). La tuile du dashboard affichait demain et rien d'autre : la confiance que le plugin météo publie depuis la 2.0 était invisible sur la surface où la prévision est réellement lue, et rien ne disait qu'il y avait autre chose derrière la carte. La tuile porte désormais la même pastille de confiance que le panneau et la page équipement, centrée en pied de carte, et une tape ouvre un panneau où les cinq jours sont des colonnes : jour, condition, maximum, minimum, vent, et la pastille de chaque jour. Rien ne s'affiche quand le plugin ne peut pas qualifier le jour, parce qu'un badge gris disant « non qualifié » occupe le pied d'une carte de 212 px à ne rien dire et devient une chose de plus à confondre avec un verdict. Le premier dessin, livré dans cette même version, était une bande de cinq jours sous le résumé et une ligne verticale par jour dans la feuille ; vus sur un vrai téléphone contre des données de production, aucun des deux ne tenait, et tous deux ont été remplacés plutôt que conservés. Deux défauts que seul le navigateur a montrés : le filet de confiance avait un `box-content` qui annulait sa hauteur, si bien que `background-clip: content-box` n'avait rien à peindre, et les emplacements de confiance reposaient sur trois lignes de base différentes, un jour sans verdict n'ayant rien sous son séparateur. Le panneau est maintenant plafonné à cinq colonnes au lieu de faire confiance au flux pour son compte : ses marges, ses tailles de texte et l'emplacement réservé à la pastille sont réglés pour exactement cinq colonnes sur une feuille de 390 px, et un plugin publiant sept jours aurait produit des colonnes de 46 px avec la pastille débordant de l'emplacement tenu pour elle. Le plafond coupe par le lointain, une prévision étant la moins sûre le plus loin. Corrigé au passage : un `NaN` publié par un plugin passait le test `typeof value === "number"` et s'affichait comme le littéral `NaN`, y compris sur la page équipement.
- Fonctionnalité (recettes) : **un paquet de recette peut déclarer une tuile Dashboard, et une instance peut être épinglée à côté des équipements sur lesquels elle agit** (spec 169, #853, issue #852). La déclaration appartient au paquet : une icône prise dans un jeu fermé, quelles clés d'état portent le résumé et le compte à rebours, et quelles actions reçoivent une commande. Une définition sans tuile n'apparaît jamais dans le sélecteur et ne peut pas être épinglée, car la plupart des recettes n'ont rien qui mérite un coup d'œil et le cœur ne devrait pas leur donner une surface que leur auteur n'a jamais dessinée. Le rendu n'est pas nouveau : la ligne d'instance transforme déjà `state.summary`, `state.timerExpiresAt` et les actions de cycle en une ligne de statut, un compte à rebours vivant et une pastille de mode, et le même descripteur atteint désormais une seconde surface en réutilisant ces composants plutôt qu'en les réimplémentant. Les recettes qui publient déjà ces clés gagnent une tuile en ajoutant un champ, pas avant. Un paquet qui cesse de déclarer une tuile ne fait pas perdre son widget à l'utilisateur : il s'affiche comme indisponible, effacer la disposition du dashboard de quelqu'un parce qu'un paquet tiers a changé d'avis étant la plus mauvaise des réponses.
- Correction (ui) : **la page énergie en direct dit quel compteur est figé, au lieu de signaler toute la page** (#859, issue #854). Le bandeau était dérivé du statut d'équipement de la spec 116, un verdict sur le compteur entier qui passe à dégradé dès qu'une liaison de flux vieillit, tension et courant à cinq minutes et énergie à dix comprises. Le diagramme de flux n'en dessine aucune. Sur l'installation de référence, le compteur de production à lui seul a basculé en ligne et dégradé douze fois en vingt minutes, et la page répondait à chaque fois par une phrase anonyme « données figées », au-dessus d'un chiffre réseau qui se mettait à jour une fois par seconde. La question de fraîcheur est désormais posée aux mesures de puissance que le diagramme dessine réellement, via le classifieur que la décomposition sous-compteurs et le flux `?role=submeter` partagent déjà, et la réponse est une ligne par source concernée avec son propre âge : « Production : mesure figée depuis 3 min », sans aucune ligne réseau quand le réseau va bien. Un compteur dégradé par une seule mesure que cette page n'affiche jamais ne déclenche plus rien. La page gagne aussi l'horloge que la décomposition avait déjà, car un compteur qui se tait n'émet aucun événement et rien ne re-rendrait autrement la page au moment où sa mesure vieillit.
- Correction (ui) : **le glisser de confirmation d'ouvrant tient dans un pouce** (#860, issue #858). La commande remplissait la feuille : sur un téléphone de 393 px, une piste de 353 px avec 295 px de course, partant du coin bas-gauche de l'écran, le point le plus éloigné du pouce de la main qui tient le téléphone, sur une commande dont tout l'objet est l'usage à une main devant un portail. La piste est plafonnée à 260 px et centrée, si bien que le bouton part de x=72 au lieu de x=20 et que la course fait 202 px, et la feuille se tient à 134 px du bord bas au lieu de 88. Cette hauteur est achetée avec du contenu plutôt qu'avec du vide : agrandir la feuille et la faire flotter au-dessus du bord ont tous deux été essayés sur l'appareil et se lisaient comme un trou dans la mise en page, donc Annuler est devenu un vrai bouton au lieu d'un lien texte, volontairement plus étroit et plus léger que le glisser. La course est dérivée de la largeur rendue, donc le seuil de validation, le remplissage de progression et le bouton ont tous suivi le plafond ; le libellé, non, et il prend désormais la moitié que le bouton n'occupe pas au lieu de commencer dessous. Un glissement partiel revient toujours en arrière sans rien actionner, ce qui est tout l'objet de la spec 146.
- Maintenance (specs) : les maquettes de refonte UI ont rejoint la spec qui les porte (#856).

---

## 1.63.x : Une barrière qui ne vérifiait que l'orthographe

### v1.63.0 — 2026-08-30 { #v1-63-0 }

Le changement principal est une élévation de privilèges livrée depuis un certain temps, et le reste de la version lui tient compagnie : cinq défauts où un garde existait, était réputé tenir, et ne tenait pas. Un garde-fou de restauration qui ne pouvait jamais se déclencher, une mesure périmée présentée comme une mesure en direct, une release publiée sans image que la moitié du parc puisse récupérer, et tout un étage de tests assertant sur des valeurs que le moteur ne peut pas produire.

- Correction (auth) : **un utilisateur authentifié non-admin pouvait lire tous les endpoints réservés aux admins en encodant un caractère du chemin** (#836). Sept fichiers de routes gardent une surface admin avec un hook comparant `request.url`, la cible brute de la requête. Le routeur décode le pourcentage avant de router, si bien que `GET /api/v1/%62ackup` atteignait le handler `/api/v1/backup` pendant que le hook voyait une chaîne qu'il ne reconnaissait pas et laissait passer la requête sans garde. Rien ne se tenait derrière pour les lectures : la barrière de rôle globale n'inspecte que `POST/PUT/PATCH/DELETE`, donc un `GET` réservé aux admins n'avait que ce hook pour protection. Mesuré contre un vrai routeur avec une identité `standard`, le corps de la réponse est bien revenu. Ce qui était exposé est l'ensemble qui mérite protection : l'export complet du système, le journal serveur, la table des réglages, les identifiants de broker MQTT, les tokens de canaux de notification comme un token de bot Telegram, et la liste des utilisateurs. Les mutations n'ont jamais été exposées, la barrière globale fail-closed les attrapant quelle que soit l'orthographe. La comparaison décode maintenant une fois, ce que fait le routeur ; décoder jusqu'à stabilité serait pire que le bug, car le hook verrait un chemin que le routeur ne verra jamais et transformerait un 404 en 403 sur une route inexistante. Quatre des hooks comparaient aussi un simple préfixe, ce qui aurait gardé un futur voisin comme `/api/v1/users-export`. Chaque garde est désormais pilotée par un vrai routeur dans la suite, en vérifiant à la fois qu'un non-admin est refusé quelle que soit l'écriture du chemin et qu'un admin est toujours servi, pour que le correctif ne puisse pas passer pour un refus général. Trouvé en relisant une conversion de schéma sans rapport, qui avait recopié le même motif de hook.
- Correction (backup) : **le garde-fou de restauration ne pouvait pas se déclencher lors d'une restauration, qui est justement la façon dont des données de production arrivent là où elles n'ont rien à faire** (#830, issue #790). Le garde-fou compare l'identifiant d'instance stocké dans la table des réglages, qui voyage dans les backups par construction, avec le marqueur `.instance-id` situé à côté de la base, censé décrire ce déploiement-ci. Le marqueur ne figurait dans aucune des deux listes d'exclusion : l'export le copiait dans l'archive et la restauration le réécrivait, donc les deux moitiés de la comparaison venaient du même déploiement et la reprise était structurellement toujours fausse. Restaurer une archive de production sur une seconde machine produisait donc une instance pleinement armée partageant le clientId MQTT, les autorisations OAuth et les canaux de notification de l'origine, précisément l'incident après lequel ce garde-fou a été construit. Restaurer son propre backup sur la même instance n'est pas affecté, et un test le verrouille, car c'est le cas que le changement pouvait plausiblement casser. Une exécution shadow volontaire ne reçoit aucune invite : c'est par définition une copie des données de production, les gates du mode shadow la maintiennent déjà inerte, et confirmer graverait l'identité d'origine dans le marqueur du shadow.
- Correction (ui) : **une mesure de sous-compteur était présentée comme une mesure en direct quel que soit son âge** (#833, issue #744). La décomposition de consommation construisait son total à partir des compteurs réseau et solaire, rafraîchis toutes les quelques secondes, et ses parts à partir de ce que chaque prise avait dit en dernier, à plein poids, si ancien soit-il. Mesuré en production : un chauffe-eau tirant 560 W s'affichait à 0 W parce que sa pince avait remonté sa dernière valeur seize minutes plus tôt, et un poêle contribuait une mesure vieille de 124 jours. L'erreur est silencieuse : un `0 W` périmé se lit « cet appareil est éteint », ce qui est parfaitement plausible pour un chauffe-eau. Le drapeau de péremption du binding ne peut pas porter cela : le moteur n'applique sa fenêtre électrique qu'aux compteurs déclarés, volontairement, parce qu'une charge stable cesse de produire des mises à jour et qu'une fenêtre serrée signalerait un appareil en bon état à chaque cycle de remontée. Une ligne hors budget affiche désormais « mesure ancienne » avec son âge et ne contribue ni au total, ni au résidu, ni au camembert ; elle reste dans la légende, car ne pas savoir est une information. Le budget est de deux minutes pour un compteur déclaré et de dix minutes sinon, soit le double de la cadence la plus lente qu'interroge une intégration supportée, pour qu'un appareil en bon état sur un cycle de cinq minutes ne clignote pas. Les pourcentages sont aussi calculés sur les valeurs réellement affichées, si bien que les chiffres à l'écran ne se contredisent plus.
- Correction (api) : **le feed de sous-compteurs que consomme l'afficheur d'énergie indique maintenant si une mesure peut être affichée** (#840, issue #832). Les mêmes mesures périmées y étaient servies sans qualification, et un client ne peut pas déduire l'âge d'une mesure sans réénoncer la règle. La règle a été déplacée dans un module partagé et les deux surfaces appellent la même fonction, ce qui est le fond du changement bien plus que l'un ou l'autre point d'appel : une règle réénoncée par surface est exactement ce qui a conduit la décomposition et la carte d'arbitrage à décrire un même appareil de deux façons contradictoires. Chaque entrée porte `powerReadingCurrent`, en ajout, pour qu'un client existant continue de lire ce qu'il lit aujourd'hui. Le firmware de l'afficheur vit dans son propre dépôt et doit être modifié pour en tenir compte. Les cartes d'équipement restent à traiter, suivies séparément.
- Correction (ws) : **les chaînes libres du topic système partagé sont masquées pour les clients non-admin** (#835, issue #651). `system.error` et les deux événements de mise à jour transportent du texte destiné à l'opérateur, assemblé au point d'appel, sur un topic auquel tout client authentifié est abonné par défaut. Aucun secret n'y circule aujourd'hui ; ce que cela supprime, c'est la dépendance à la vigilance de chaque auteur futur. L'événement est toujours livré et ses champs structurés conservés, donc un non-admin qui assiste à une mise à jour voit toujours l'overlay. Le texte des alarmes n'est délibérément pas masqué, et la raison est maintenant écrite : il sert de texte de repli pour les alarmes sans clé de traduction, donc le masquer viderait le bandeau d'incidents, et cela ne fermerait rien tant que le flux d'activité recopie le même texte sur un topic ouvert à tous les rôles.
- Correction (backup) : **une archive pouvait contenir une entrée que sa propre restauration refusait** (#838, issue #829). L'export et la restauration calculaient l'extension d'un fichier selon deux règles différentes, si bien que toute entrée `data/.<nom>` échappait entièrement à la liste blanche d'extensions, à n'importe quelle profondeur, et que les deux entrées de fichiers cachés de cette liste n'avaient jamais rien matché. Un seul calcul sert désormais les deux. Durcir la seule restauration aurait inversé l'asymétrie au lieu de la fermer : l'export est donc soumis à la même liste et nomme ce qu'il laisse de côté, et une restauration indique combien d'entrées elle a refusées plutôt que de le laisser dans une ligne de journal.
- Correction (ci) : **un échec de build arm64 publiait une release que personne ne pouvait installer** (#831, issues #764 et #638). Le job Release déclarait la promotion du manifeste parmi ses dépendances mais ne la vérifiait jamais, et le vérificateur de mise à jour interroge la Release GitHub et non le registre d'images : chaque Raspberry Pi se serait vu annoncer une mise à jour, et chaque récupération aurait ensuite échoué. Pire que ce que disait le rapport : le job amd64 poussait aussi `:latest`, que `docker-compose.yml` épingle, donc un échec arm64 le faisait pointer vers un manifeste amd64 seul et la récupération suivante échouait franchement, au lieu de simplement afficher une mise à jour fantôme. La Release est maintenant conditionnée au manifeste, `:latest` n'est publié qu'une fois les deux architectures fusionnées, et une release retenue fait passer le run au rouge au lieu de laisser un run vert avec un job grisé. Un tag lancé à la main ne peut plus publier une Release pour une version sans images. Les entrées de workflow n'atteignent plus directement un script shell.
- Correction (backup) : **un nom d'équipement contenant un antislash corrompait la partie InfluxDB d'un backup** (#844). Le line protocol échappe avec un antislash, et l'échappeur de tags traitait la virgule, l'espace et le signe égal mais pas l'antislash lui-même : un nom se terminant par un antislash était écrit tel quel et l'analyseur lisait le séparateur suivant comme échappé, le tag avalait la virgule et le reste de la ligne était mal interprété. Les valeurs de tags portent des noms d'équipements et d'appareils, donc c'est ce que le foyer a saisi qui atteint un format doté de son propre échappement. Trouvé en triant l'arriéré d'analyse de code, où deux des trois candidats se sont révélés ne pas être des bugs : un corps de requête ne peut pas faire passer une clé `__proto__` au-delà de l'analyseur JSON, et une clé calculée dans un littéral d'objet définit une propriété propre au lieu d'atteindre le setter de prototype. Le même changement sort les artefacts de build versionnés et les scripts d'exploitation du périmètre du scanner, ce qui a retiré un tiers d'un arriéré de 72 alertes qui nous renvoyait du code tiers minifié et faisait échouer des pull requests sans rapport.
- Correction (packages) : **un identifiant de paquet et une référence de dépôt sont vérifiés là où ils deviennent un chemin et une URL** (#845, #847). Un identifiant de paquet atteignait `resolve(pluginsDir, id)` sans contrôle, et le résultat était confié à `rmSync({ recursive: true })`, `rename()` et `cpSync()` : un identifiant valant `../../etc` n'aurait pas seulement lu le mauvais fichier. `getPackageDir` était déjà censé être le seul endroit où un identifiant devient un chemin, mais six points d'appel le contournaient avec leur propre resolve, dont l'installation et la désinstallation. Il énonce désormais ce qu'un identifiant peut être, puis prouve que le chemin résolu reste sous la racine des paquets, car les deux contrôles échouent différemment. Le format autorise les underscores, et ce n'est pas un détail : `panasonic_cc`, `legrand_energy`, `mcz_maestro` et `netatmo_weather` sont de vrais identifiants du registre, et la règle en minuscules-et-tirets qui semblait évidente aurait refusé de charger quatre plugins livrés. La même valeur atteignait aussi le chemin d'une requête authentifiée vers GitHub : un seul constructeur vérifié bâtit maintenant cette URL. `restoreFromFile` avait la même faille sous forme de liste noire, refusant `/`, `\\` et `..` mais laissant passer `.`, qui résolvait vers le répertoire de sauvegardes lui-même ; il énonce désormais ce qu'un nom de fichier peut être, et refuse un chemin plutôt que d'en lire discrètement le dernier segment.
- Maintenance (ci) : **les actions tierces sont épinglées sur un commit et chaque job de release déclare ses permissions** (#846). Un tag mobile est une promesse que l'éditeur peut réécrire, et ces actions tournent avec des droits d'écriture sur les paquets. Le coût est d'abandonner les mises à jour de correctif automatiques, acceptable puisque le bot de dépendances propose déjà le nouveau commit chaque semaine : la mise à jour devient un diff que quelqu'un lit. Trois jobs héritaient de la portée de jeton par défaut du dépôt et prennent maintenant le minimum nécessaire, l'un d'eux rien du tout.
- Maintenance (ci) : **les fichiers de tests sont typechecké, et les 75 erreurs qui s'y cachaient sont corrigées** (#842, issue #834). La configuration du compilateur excluait chaque test, donc un test pouvait asserter sur un type inexistant sans que les vérifications s'en aperçoivent. Trois relevaient exactement de cela : un filtre éprouvé contre deux types d'événements retirés du moteur, un anti-rebond armé par une forme de charge utile que le bus ne peut pas produire, et sept fichiers de routes vérifiant qu'un rôle n'ayant jamais existé est refusé, pendant que le seul vrai rôle non-admin n'était pas testé. Le reste est de la dérive, chaque cas nommant le type qui a bougé sous le test. Aucun comportement de test n'a changé, et la barrière est bloquante d'emblée parce que le compte est à zéro et que l'objectif est de l'y maintenir.
- Correction (ui) : **la page Live a une seule forme de titre, et le diagramme de flux en a un tout court** (#848, issue #818). Quatre cartes portaient trois titres différents et un absent : les sections phases et décomposition à une taille sans icône, l'arbitrage à une autre avec icône et sous-titre, et le diagramme de flux, première chose de la page, sans étiquette. L'arbitrage se lisait le mieux : sa forme a été extraite et utilisée par les quatre plutôt que recopiée, ce qui est précisément comme elles ont divergé.
- Maintenance (api) : **les derniers corps de requête validés à la main passent au schéma** (#837, #841, issue #597). Les corps de widgets, de tarif et de plugins avaient été reportés parce qu'ils sont conditionnels ou imbriqués ; les recherches d'existence restent dans le handler et conservent leur statut d'origine, convertir une vérification de forme n'étant pas une raison de renuméroter une réponse dont un client peut dépendre. Passer les mêmes corps de requête dans l'ancienne et la nouvelle validation, puis comparer les réponses, est ce qui a tenu la conversion honnête : un jour de semaine fractionnaire qu'aucun jour ne peut valoir, une borne de créneau qui acceptait n'importe quelle valeur vraie, et un prix infini silencieusement stocké en null qui empoisonnait tous les calculs de coût jusqu'à ce que quelqu'un réenregistre le formulaire.
- Maintenance (docs) : les barrières de fraîcheur documentaire de la spec 167 arrivent avec une passe qui a corrigé la référence d'architecture contre le code, retiré un modèle de données français décrivant un autre produit et complété l'index des specs (#817, #819 à #827). Le registre de plugins suit zigbee2mqtt 2.7.0 et pool-pump-schedule 1.8.2 (#816, #828).

---

## 1.62.x : Ce qui n'a pas eu lieu, et n'a rien dit

### v1.62.0 — 2026-08-29 { #v1-62-0 }

Deux des trois changements principaux relèvent du même type de défaut : le moteur a fait quelque chose, ou ne l'a pas fait, et rien à l'écran ne le disait. Un ordre jeté parce que son intégration n'était pas encore connectée, et les nouvelles données d'un plugin restées sur un appareil qu'elles n'ont jamais quitté.

- Correction (equipments) : **un ordre émis avant la connexion de son intégration n'est plus perdu** (#812, issue #702). Les instances de recettes devenaient vivantes environ quatre-vingt-dix lignes de démarrage avant que `integrationRegistry.startAll()` n'ait connecté quoi que ce soit, si bien que leurs premiers ordres partaient vers des intégrations incapables de les porter. Chacun échouait sur « Integration not connected » puis était jeté : la recette faisait avancer son état interne comme si elle avait agi, et plus rien ne remettait l'appareil en accord avec elle jusqu'au déclenchement suivant, ce qui pour une recette pilotée par horaire se compte en heures. Deux par démarrage sur l'installation de référence, dans chaque fichier de journal conservé. La plupart étaient des consignes de confort que l'évaluation suivante réapplique, mais l'un était un ARRÊT de pompe de piscine, exactement la classe de panne à l'origine de la spec 141. L'investigation a montré que la fenêtre de démarrage n'était qu'un symptôme d'un problème plus large : le garde qui refuse d'envoyer vers une intégration déconnectée levait son erreur avant l'émission du résultat de l'ordre, donc ni `equipment.order.executed` ni `equipment.order.failed` n'atteignait le bus, et le suivi de confirmation d'ordre, qui existe précisément pour modéliser « l'ordre n'est pas arrivé », était aveugle à toute cette classe à n'importe quelle heure. Une coupure MQTT en milieu d'après-midi perdait les ordres de la même façon. La correction tient en deux couches, car chacune seule laisse un trou. Les instances de recettes démarrent désormais tout à la fin du démarrage, derrière une attente bornée sur la connexion des intégrations, ce qui supprime le cas qui se produisait à chaque redémarrage ; seul l'état des instances en cours attend, l'API écoutant et les paquets de recettes étant chargés bien avant, et le plafond garantit qu'une intégration cloud injoignable ne bloque pas tous les automatismes. Ce qui passe malgré tout est maintenant retenu puis renvoyé une fois quand cette intégration se connecte, dans une fenêtre délibérément bien plus courte que la reprise d'une heure existante au retour d'un appareil : une commande planifiée rejouée longtemps après son créneau serait pire que celle qui a été perdue. Les appelants reçoivent toujours la même erreur qu'avant, donc aucun paquet de recette installé ne change de comportement. Ce renvoi réclamait un signal qui n'existait pas : `system.integration.connected` figurait dans l'union d'événements et les plugins avaient le droit de l'émettre, mais rien dans le cœur ne l'a jamais produit, donc aucun consommateur ne pouvait s'y fier. Le registre le dérive maintenant en échantillonnant l'état des plugins, ce qui couvre aussi un plugin qui coupe et revient entre deux échantillons. Un ordre retenu reste silencieux pendant un délai de grâce avant d'être signalé, car l'intégration revient normalement en quelques secondes et alarmer sur l'échec lui-même enverrait une notification d'échec et une de rétablissement par ordre retenu à chaque redémarrage ordinaire.
- Fonctionnalité (equipments) : **les valeurs qu'un plugin publie après la liaison sont désormais proposées, au lieu de rester invisibles** (#813, issue #707). La liaison automatique ne tourne qu'une fois, à la création d'un équipement. La mise à jour d'un plugin qui se met à publier de nouvelles clés crée bien les lignes côté appareil à la découverte, mais rien ne repasse sur un équipement lié avant l'existence de ces clés. Weather Forecast 2.0.0 a publié sept nouvelles données : l'appareil en affichait trente-deux, l'équipement gardait ses vingt-cinq liaisons, et la carte s'affichait exactement comme avant. Le seul remède passait par le sélecteur d'appareils, qui supprime toutes les liaisons et les reconstruit, en perdant les alias personnalisés et l'historisation réglée liaison par liaison ; les propriétaires ajoutaient donc les clés une par une, après avoir d'abord deviné que c'était ce qu'il fallait faire. Reconstruire automatiquement a été envisagé puis écarté : `data_bindings` n'enregistre que ce qui est lié et ne garde aucune trace de ce qui a été délié volontairement, donc un passage automatique ne peut pas distinguer une clé réellement nouvelle d'une clé supprimée par le propriétaire, et deviendrait « Sowel remet ce que vous supprimez, une fois par mise à jour de plugin ». Faire du déclencheur une action de l'utilisateur supprime le besoin de suivre cela, et avec lui une table, une migration et une boucle de détection. La section des liaisons signale maintenant ce que les appareils publient et auquel l'équipement n'est pas lié, et propose la liste, tout coché, le décochage étant la façon dont le propriétaire garde la décision ; rien n'est écrit avant la confirmation. Deux points que la proposition traite correctement, là où une simple différence échouerait, tous deux trouvés en relecture. Sur un appareil multi-canal, l'équipement possède un seul canal fonctionnel et ce choix n'est inscrit nulle part ailleurs que dans ses propres liaisons : le canal est donc déduit de ce qui est déjà lié, car proposer le premier candidat par défaut aurait posé l'état et la commande d'un relais étranger sur l'équipement, la pollution inter-canaux que la spec 150 existe pour empêcher, et laissé un compteur qui n'aurait jamais pu retomber à zéro pour quiconque est lié au deuxième canal. Et une donnée déjà liée sous un alias renommé est écartée avant qu'un alias ne soit attribué, si bien qu'un second capteur de température se voit proposer `temperature` et non `temperature_2`, ce qui compte puisque l'agrégateur de zone ne retient que l'alias exact dans la moyenne de la pièce. L'historisation est résolue par la règle qu'applique l'écrivain d'historique lui-même, déplacée dans un module partagé plutôt que réécrite dans l'interface, si bien que la liste marque ce qui commencerait à être enregistré et le compte avant la confirmation. Le problème n'a jamais été que des valeurs soient historisées, c'est que cela se produisait en silence ; les liaisons de prévision sont d'ailleurs exclues par cette règle, et la liste le dit.
- Fonctionnalité (energy) : **le tableau d'arbitrage remplit le besoin sur chaque ligne, et dit pourquoi rien ne démarre** (#809, issue #807). La colonne Besoin n'était remplie que pour une demande en attente, si bien que sur une installation typique trois lignes sur quatre affichaient un tiret et se lisaient comme une donnée manquante. C'était le contrat plutôt qu'un défaut, mais deux choses n'allaient pas : ce qu'il faut à une charge pour démarrer est une propriété de la charge, vraie qu'elle tourne, attende ou reste inactive, et masquer cette valeur cachait le seul endroit où la marge d'engagement était visible. Et la question que l'utilisateur se pose réellement devant ce tableau, pourquoi rien ne démarre, n'avait aucune réponse à l'écran alors que le moteur calculait déjà le motif sans l'afficher nulle part. Une colonne d'écart le montre désormais.
- Fonctionnalité (ui) : **la liste des plugins est refaite en ligne compacte avec une feuille de détail** (#805, issue #749). Sur un écran de 390 px, le nom du plugin ne se tronquait pas, il disparaissait : le bloc d'actions était horizontal et refusait de se réduire, donc il poussait le nom hors de la ligne. La ligne est maintenant compacte et le détail passe dans une feuille, ce qui donne aussi une place au bandeau de mise à jour groupée.
- Correction (ui) : **les pages énergie ne sont plus figées en français** (#808, issue #730). Pas un oubli mais un doublon : le sélecteur de période existait en deux exemplaires, dans les dossiers historique et énergie, sous la forme du même composant, et seule la copie de la page Analyse avait été traduite. La copie énergie figeait aussi son formatage de dates en `fr-FR`, un littéral répété seize fois, si bien qu'un utilisateur anglophone lisant sa propre consommation obtenait des titres et des dates en français.
- Correction (ui) : **le bandeau d'alarme est rédigé dans la langue du lecteur** (#811, issue #720). Le bandeau affichait chaque alarme dans la langue où son texte avait été écrit. Les alertes de batterie faible étaient composées en anglais, à deux endroits, côté moteur puis à nouveau dans l'interface ; une intégration en échec était composée en français, à la fois par le plugin qui la levait et par le bloc qui la restaurait au rechargement. Quelle que soit la langue choisie par le lecteur, une partie du bandeau la contredisait. L'alarme d'échec d'interrogation propre aux plugins a été reformulée dans la foulée.
- Maintenance (deps) : **pino 10, et plus de fil d'exécution pour un journal qui n'écrit rien** (#799). Retenu parce qu'il ne faisait pas échouer la suite, il la bloquait : une vingtaine de secondes devenait neuf cent trente-quatre, et un fichier de test à lui seul restait à plus de deux mille secondes à zéro pour cent de processeur. Bloqué et non occupé, ce qui désignait les fils d'exécution plutôt qu'un changement sémantique de pino 10. Un journal silencieux ne construit désormais plus de transport du tout.
- Maintenance (deps) : **suncalc 2, avec la conversion réécrite** (#802, issue #674). Quatre changements distincts dans une seule majeure, chacun échouant à sa manière, donc la conversion a été réécrite plutôt que rapiécée, puis figée.
- Maintenance (ci) : **l'outillage de développement est regroupé en une proposition par écosystème** (#798). Exclure les linters, le formateur et le compilateur des groupes de bibliothèques était juste, puisqu'une montée d'outillage fait échouer les contrôles sur du code inchangé et que, dans un groupe de bibliothèques, cet échec bloque toutes les mises à jour sans rapport. Cela produisait aussi un flot de propositions à un seul paquet. Elles sont désormais regroupées par écosystème, ce qui traite le bruit et non le symptôme.
- Maintenance (dev) : **la version de Node que reçoivent les développeurs est figée, et pas seulement plancher** (#804). Le manifeste déclarait un minimum, lu comme une permission : une machine sur la formule Homebrew ordinaire se retrouve sur une ligne impaire qui ne devient jamais LTS, et faisait donc tourner un runtime que personne d'autre dans la chaîne n'utilise.
- Maintenance (deps) : **l'interface passe à eslint 10** (#797), rattrapant le backend. Les quatre paquets se verrouillent mutuellement par leurs dépendances de pair, donc aucune des propositions individuelles ne pouvait s'installer seule ; montées ensemble elles se résolvent proprement, sans toucher une seule dépendance d'exécution. Les définitions de types du backend suivent (#800, #801).
- Refactorisation (ui) : **les métadonnées de types d'équipement passent dans leur propre module** (#803). Un module qui exporte à la fois un composant et autre chose perd le rafraîchissement rapide, donc une modification à cet endroit rechargeait la page au lieu de préserver l'état.
- Tests (core) : **le garde d'arrêt est borné à la fermeture elle-même** (#795), en reprenant la technique du correctif d'@alpitux pour le même défaut, ouvert trente-sept minutes avant l'écriture du garde et qui n'avait pas été regardé en premier.
- Documentation : **le panneau de détail des plugins et le bandeau de mise à jour groupée sont décrits** (#806), et la documentation technique rattrape cette version : le cycle de vie d'une intégration couvre désormais les transitions de connexion que le registre émet et ce qui repose dessus, et le guide de développement de plugin dit clairement qu'une nouvelle donnée n'atteint pas seule les équipements existants, où le propriétaire la récupère, et pourquoi renommer une clé est pire que d'en ajouter une.

## 1.61.x : Sortir d'un runtime en fin de vie, et un audit propre

### v1.61.0 — 2026-08-28 { #v1-61-0 }

Aucune fonctionnalité, aucun changement de comportement. C'est une version de maintenance, et si elle mérite son propre numéro c'est que Sowel tournait depuis quatre mois sur un Node qui ne recevait plus de correctifs de sécurité.

- Maintenance (core) : **le runtime passe de Node 20 à Node 24, la LTS active** (#761, #768, #778). Node 20 a atteint sa fin de vie le 2026-04-30, donc chaque instance tournait sur un moteur non supporté depuis cette date. Cela pèse plus lourd que n'importe quelle faille de dépendance, puisqu'il s'agit du socle sur lequel tout le reste s'exécute. Le passage s'est fait par Node 22 puis directement jusqu'à 24 : Node 22 est bien une LTS, mais elle est en maintenance depuis octobre 2025 et s'arrête le 2027-04-30, donc s'y arrêter aurait imposé de planifier la migration suivante presque aussitôt. Node 24 court jusqu'au 2028-04-28. La ligne qui décide réellement du runtime de production s'est révélée n'être aucun des `FROM node:` du Dockerfile, mais l'appel NodeSource du troisième étage, une image Debian nue choisie pour Python 3.13 : ne bumper que les deux `FROM` aurait livré un runtime inchangé avec tous les contrôles au vert. Node 24 a entraîné une dépendance avec lui. `better-sqlite3` 11 compilait très bien contre Node 24 et passait tous les tests de fumée, puis faisait planter dix suites de tests au démontage des workers : le destructeur de son `Statement` retire un hook de nettoyage après la destruction de l'environnement, ce que Node 22 tolérait et sur quoi Node 24 assert. C'est un bug d'ordre de démontage, invisible à tout ce qui ne lance pas la suite complète, et c'est précisément pourquoi cette migration est validée par la CI et non à la main. `better-sqlite3` 13 le corrige, fait passer SQLite de 3.49.2 à 3.53.4, et au lieu de reporter le même problème à la prochaine majeure de Node, il en supprime la catégorie : la version 13 abandonne `prebuild-install` au profit de binaires N-API, si bien que la bibliothèque livrée n'est plus liée à une version d'ABI de Node. Cela retire au passage vingt-trois paquets de l'arbre de production, toute la chaîne de téléchargement dont l'ancien utilitaire de compilation avait besoin. Le passage traverse aussi OpenSSL 3.0.19 vers 3.5.7, traité comme le vrai risque plutôt que les modules natifs ; le TLS sortant a été contrôlé vers chaque endpoint que le moteur appelle, et les brokers MQTT de l'installation de référence n'utilisent en fait aucun TLS.
- Maintenance (backup) : **l'écriture des sauvegardes passe à archiver 8** (#752). Pas une simple montée de version : archiver 8 supprime purement la fonction fabrique, donc les deux points d'appel instancient désormais la classe de format directement. Comme il s'agit du code qui produit l'archive dont on repartirait après un sinistre, il a été vérifié plutôt que supposé : un export et une restauration réels sur une copie d'une base de production, en comparant une empreinte du contenu de chaque table sauvegardée et pas un comptage de lignes, puisqu'un écrivain qui abîmerait les valeurs en préservant la cardinalité passerait un comptage. Les trente tables sont revenues identiques. Un test a été ajouté qui relit l'archive produite avec une implémentation de décompression indépendante et fige la méthode de compression, pour qu'une future majeure ne puisse pas annoncer un succès en écrivant une archive que personne n'ouvre.
- Maintenance (deps) : **le build frontend passe à vite 8 et le lanceur de tests à vitest 4** (#750, #751). vite 8 remplace rollup par rolldown, donc le bundle a été comparé plutôt que cru sur parole : légèrement plus petit, même jeu de précache PWA, et la page construite a été pilotée dans un navigateur avec de vraies données pour confirmer qu'elle s'affiche. vitest 4 a supprimé l'option que la suite UI utilisait pour router les tests de composants vers jsdom ; les deux étages sont désormais exprimés en projets, et les effectifs de tests ont été relevés des deux côtés pour que la réécriture ne puisse pas cesser silencieusement d'en collecter un.
- Sécurité (api) : **la limitation de débit n'est plus contournable en IPv6** (#783). `@fastify/rate-limit` comptait les requêtes sur l'adresse brute du client, si bien que quiconque dispose d'un préfixe IPv6 pouvait tourner sur les adresses de sa propre plage sans jamais atteindre la limite. La version 11.2.0 compte désormais sur le préfixe /64. Aucun correctif n'existe sur la branche 10.x, ce qui a imposé la majeure. Les points d'entrée protégés sont ceux qui comptent, puisque la connexion et la vérification à deux facteurs portent chacune une limite plus stricte de dix requêtes par minute en plus de la limite globale. Sowel ne se trouve pas derrière un proxy de confiance, donc l'exposition concernait les clients IPv6 directs et non quiconque saurait forger un en-tête.
- Maintenance (deps) : **les montées de version majeures restantes** (#661, #771, #780, #781, #782, #786, #787). `@fastify/cors` 11 restreint un jeu de méthodes autorisées par défaut que Sowel surcharge déjà explicitement, donc rien ne change de ce côté. `lucide-react` atteint la 1.0, qui supprime les icônes de marque : les cent soixante-quatre icônes utilisées par l'interface ont toutes été vérifiées contre le nouveau paquet avant la montée de version, et le sélecteur d'icônes passe par une table d'imports statiques plutôt que par une résolution sur le nom, donc aucune valeur enregistrée dans un tableau de bord ne peut désigner une icône disparue. `@vitejs/plugin-react` 6 abandonne complètement Babel, puisque Vite 8 réalise la transformation de rafraîchissement via Oxc : huit paquets quittent l'arbre et les bundles produits sont identiques à l'octet près. Le reste relève de l'outillage de lint et de test, dont une entrée n'était pas cosmétique, rollup portant une faille de traversée de répertoire de sévérité haute sans correctif en dessous de 4.59.
- Maintenance (sécurité) : **l'audit des dépendances backend passe de vingt-deux alertes à zéro**, dont trois critiques (#669, #753, #754, #755, #757, #759, #760, #762, #765, #766). L'essentiel relève du correctif de routine. Les quatre dernières n'avaient aucune proposition automatique, pour une raison structurelle : aucune ne demandait de modifier un manifeste, donc l'outil n'avait rien contre quoi ouvrir une proposition. Chaque parent déclarait déjà une plage acceptant la version corrigée, le lockfile avait simplement vieilli, et rafraîchir ces entrées constituait tout le correctif. Forcer les versions par `overrides` a été mesuré puis écarté : le résultat était moins bon, et npm n'offre aucun garde-fou dans ce cas. Un test de contrôle forçant une majeure qui violait les plages déclarées par ses trois consommateurs ne remontait aucune dépendance invalide, npm considérant qu'un override réécrit la contrainte au lieu de l'enfreindre.
- Maintenance (journalisation) : **dotenv n'écrit plus de bandeau sur la sortie standard au démarrage** (#758). Sa version 17 journalise une ligne au chargement même sans fichier `.env` à lire, ce qui est le cas en production, alors que les journaux de production sont du JSON ligne à ligne capté par Docker. De l'hygiène plutôt qu'un défaut réel : cette ligne n'atteignait ni le fichier de journal ni la visionneuse intégrée.
- Tests (api) : **le service des fichiers statiques et le repli de l'application monopage sont désormais couverts** (#763). Le bloc qui sert toute l'application React n'avait aucun test, donc une suite verte ne disait rien sur le fait qu'un rafraîchissement sur une route côté navigateur renvoie bien l'application et non une 404. Quatorze cas, dont quatre formes de traversée de répertoire.
- Correction (core) : **le moteur ne risque plus de planter en s'arrêtant** (#792, signalé par @alpitux en testant la version candidate). Quatre sous-systèmes étaient créés au démarrage sans jamais être arrêtés, dont le suivi d'état des équipements. Celui-ci porte un tic de soixante secondes et un anti-rebond de deux cents millisecondes, et il restait abonné au bus d'événements pendant tout l'arrêt : le trafic des appareils continuait donc d'armer du travail jusqu'à la fermeture de la base. Un timer armé juste avant se déclenche juste après, et le recalcul échoue sur une connexion fermée ; dans le pire cas observé, le gestionnaire de plantage n'arrivait plus à journaliser, le fil d'exécution du journal étant déjà en train de se terminer, et se rappelait lui-même sur soixante lignes fatales. Rien n'est perdu, le conteneur redémarre seul, mais un arrêt propre doit être propre. Le défaut existait depuis la v1.14.0 et n'est devenu atteignable qu'en v1.55.0, quand l'arrêt gracieux a été corrigé pour s'exécuter réellement : avant cela le processus sortait avant d'avoir le temps de mordre. La correction tient en un appel d'arrêt par sous-système, plus un test qui vérifie la propriété et non le cas particulier, puisque tout ce que le moteur construit et qui possède une méthode d'arrêt doit être arrêté avant la fermeture de la base. Les tests unitaires du suivi passaient tous avant la correction, ce qui est précisément pourquoi le garde contrôle le câblage.
- Maintenance (ci) : **la barrière de fusion passe d'environ 100 secondes à environ 70, sans supprimer un seul contrôle** (#784). La suite UI tournait dans le job backend pendant que le job frontend restait inoccupé, le workflow gitleaks se déclenchait sur chaque branche et produisait un contrôle requis en double, et le job backend mettait en cache le mauvais lockfile. Rien n'a été retiré pour y arriver : tout ce qui conditionnait une fusion la conditionne toujours.
- Maintenance (release) : **un build de test ne déplace plus le tag `:latest-arm64`** (#789). Le workflow manuel promet de ne pas toucher à `:latest`, et c'était vrai côté amd64, dont la liste de tags est construite conditionnellement. Le job arm64 codait `:latest-arm64` en dur, si bien que chaque build de test le repositionnait. Détecté en construisant la version candidate de cette version. Le `:latest` multi-architecture n'a jamais été menacé, puisqu'il est assemblé dans une étape déjà conditionnée, mais un tag flottant qui désigne un build candidat est un piège pour celui qui le tire ensuite.
- Maintenance (packages) : **les recettes pompe de piscine et chauffe-eau solaire sont montées de version dans le registre** (#748, #788).

## 1.60.x : Décrire une charge qui n'a pas de compteur

### v1.60.0 — 2026-08-27 { #v1-60-0 }

- Feat (energy) : **une recette peut désormais dire à l'arbitre si sa charge a réellement besoin de courant** (spec 166). Depuis la v1.59.0 le ruban sait dire qu'une charge accordée ne consomme rien, mais uniquement à partir de la mesure propre à cette charge, ce qui laisse toute charge non mesurée décrite indéfiniment comme « accordée », si longtemps soit-elle à l'arrêt. Sur l'installation de référence, cela concerne deux charges arbitrées sur quatre : une pompe de piscine qui n'expose qu'un état marche/arrêt, et une pompe à chaleur de piscine à inverter pilotée en consigne, dont l'état rapporté vient d'un autre appareil que celui que Sowel commande. Lire cet état relais a été envisagé puis écarté : il ment sur une charge à inertie, et ne dit rien du tout d'un inverter. Celui qui sait, c'est celui qui a demandé le surplus, alors la poignée de demande gagne un moyen de le déclarer, et l'arbitre reste hors des affaires de l'appareil : il reçoit un oui ou un non et ne demande jamais pourquoi une piscine est assez chaude. Une mesure fraîche l'emporte toujours, parce que la déclaration dit ce que la recette veut tandis que le compteur dit ce que l'appareil fait, et l'écart entre les deux est précisément ce que la version précédente a été écrite pour montrer. Deux règles sont venues de la relecture et non de la conception : un état posé par le compteur est tenu pendant un trou de report plutôt que rendu à la recette, sinon une charge qui parle moins souvent que la fenêtre de fraîcheur de deux minutes bascule entre les deux sources à chaque trou ; et la première mesure contradictoire renverse une déclaration immédiatement, puisque sur une telle charge la fenêtre de confirmation ne pourrait jamais arriver à terme et qu'une charge tirant 2 kW serait restée « accordée, ne consomme rien » indéfiniment. Ce n'est délibérément pas une panne : une pompe à chaleur entre deux cycles de compresseur et un chauffe-eau dont le thermostat a coupé sont tous deux déclarés en besoin et mesurés inactifs, et tous deux en parfaite santé. Rien ne change pour une charge dotée de son compteur, et une installation où aucune recette ne déclare quoi que ce soit se comporte exactement comme avant. (#746)
- Maintenance (packages) : **le plugin Zigbee2MQTT passe en 2.6.0** dans la registry, avec les littéraux de fil des lectures booléennes ajoutés en v1.59.0. (#743)

## 1.59.x : Un seul état pour la surface d'arbitrage

### v1.59.0 — 2026-08-27 { #v1-59-0 }

- Feat (energy) : **la carte d'arbitrage raconte enfin une seule histoire au lieu de deux** (spec 165). La carte, c'est un tableau de charges au-dessus d'un ruban temporel, et jusqu'ici chaque moitié décidait de l'état d'une charge dans son coin : le tableau aplatissait quatre tableaux dans le navigateur et redéduisait à partir de leurs champs, le ruban rejouait le journal de décisions dans le moteur. Rien ne les tenait synchronisés. Un chauffe-eau tenant une autorisation sans rien consommer s'affichait en vert atténué d'un côté et en pastille « Accordé » pleine de l'autre, au même instant ; après le coucher du soleil, une demande en attente lisait « Au repos » en haut et restait jaune en bas. Le moteur résout désormais l'état de chaque charge à un seul endroit et le publie, le navigateur se contente de l'afficher, et un vocabulaire unique remplace les trois familles de clés qui avaient divergé. Aucune décision d'arbitrage ne change : pas une autorisation, pas une révocation, pas une réservation. (#738)
- Feat (energy) : **le ruban distingue une autorisation qui a produit quelque chose d'une autorisation qui n'a rien produit.** Chaque quart d'heure sous autorisation était peint du même vert, si bien qu'un chauffe-eau est resté éteint une semaine sous une bande verte ininterrompue : la surface censée répondre à « où est passé mon surplus » ne savait pas dire que l'allocation n'avait rien donné. Un quart d'heure où la charge tenait son autorisation et était mesurée en train de consommer garde le vert actuel ; celui où elle tenait l'autorisation en étant mesurée à l'arrêt reçoit le même vert à 35 %, assez atténué pour se voir d'un coup d'œil. Seule la mesure fait foi, parce qu'un état de relais rapporté ment sur une charge à inertie. Observation pure, aucun changement de pilotage. (spec 164, #734)
- Feat (devices) : **une intégration peut désormais déclarer à quoi ressemble une lecture booléenne sur le fil.** Sowel refuse délibérément de deviner la polarité de vocabulaires comme OPEN/CLOSED ou LOCK/UNLOCK, un mauvais pari valant moins qu'un avertissement visible. Mais il refusait aussi sur des appareils qui n'ont rien d'ambigu : une prise Tuya qui rapporte `child_lock: "UNLOCK"` sur un expose indiquant précisément quel littéral vaut « allumé », d'où un avertissement et une chaîne brute stockée dans une colonne déclarée booléenne, à chaque découverte. Une intégration peut maintenant transmettre la paire qu'elle connaît déjà, et la déclaration l'emporte sur le vocabulaire en dur. Rien ne change quand elle n'est pas déclarée, donc le refus de deviner reste exactement où il était. Contribution de computingify. (#728)
- Fix (energy) : **le journal n'accuse plus une charge qui ne consomme rien d'avoir ignoré une révocation.** Le chien de garde n'avait qu'une preuve d'arrêt : l'export réseau devait remonter de la moitié des watts révoqués dans la fenêtre de grâce. Cette preuve ne vaut rien pour une charge qui ne consommait rien, et le soir l'export continue de baisser pour des raisons étrangères à la charge. Sur une installation réelle, le chauffe-eau, foyer absent et appareil à l'arrêt, a été révoqué avec les autres et dix minutes plus tard le journal affichait « ne s'est pas éteint sur demande ». Pire, le même chien de garde le marquait injoignable pendant deux fois la fenêtre de grâce, excluant une charge innocente de toute nouvelle autorisation pendant une vingtaine de minutes. Le chien de garde privilégie désormais la mesure propre à la charge plutôt que l'indicateur réseau, et une charge sans preuve d'aucun côté retombe sur l'ancien mécanisme, si bien qu'une recette qui ignore vraiment une révocation est toujours détectée. (#733)
- Fix (energy) : **trois défauts trouvés en relisant la nouvelle surface d'arbitrage, corrigés avant qu'ils n'atteignent une installation.** Une charge autorisée avant que quiconque n'ouvre la page de réglages de l'arbitre obtenait une ligne dans le tableau sans piste correspondante dans le ruban, exactement la divergence que la spec 165 vient supprimer. La dormance était déduite de la lecture réseau brute et entrait dans la clé de coalescence des événements : un foyer avec batterie qui oscille autour de zéro export la nuit émettait un événement de statut à chaque échantillon compteur, ce qui rechargeait et faisait clignoter la carte dans chaque onglet ouvert. Enfin, le repli de la route du modèle de lecture avait pris du retard sur les champs ajoutés depuis, masqué par un type de retour inféré. (#740)
- Maintenance (sécurité) : **trois avis de sécurité fermés.** `@fastify/multipart` 10.1.1 (deux avis, sur le chemin d'import de sauvegarde, vérifié de bout en bout sur une copie des données de production avant merge), plus les correctifs transitifs `brace-expansion` et `serialize-javascript`. (#665, #682, #735)
- Maintenance (deps) : **le retard de dépendances frontend est rattrapé.** Quatorze bibliothèques avancent d'un bloc, react 19.2.8, tailwind 4.3.3, recharts 3.10.1 et les autres, débloquées par une migration de types d'infobulle exigée par recharts 3.10. i18next 26 et react-i18next 17 arrivent ensemble, avec @types/node 26, globals 17 et lint-staged 17. Aucun changement de comportement attendu nulle part ; le formatage des infobulles est verrouillé par de nouveaux tests et le rendu des traductions a été vérifié sur des données réelles. (#737, #739, #668, #659, #656, #666, #670, #660, #736)
- Docs : **une visite guidée du suivi énergie sur docs.sowel.org**, et les articles de fond sont désormais accessibles depuis la page d'accueil et non plus seulement par URL. (#731, #726)

## 1.58.x : Savoir quand les panneaux décrochent

### v1.58.1 — 2026-08-26 { #v1-58-1 }

- Fix (energy) : **la carte de santé des panneaux dit désormais où en est sa référence pendant qu'elle se construit.** Observé moins d'une heure après l'arrivée de la v1.58.0 sur une installation réelle : le foyer réapprend un an de production, ouvre la carte de santé, et lit une ligne générique « en attente d'heures claires ». En dessous, le contrôle fonctionnait — les jours qualifiants s'accumulaient — mais la référence en exige 30 depuis le changement d'installation déclaré, et les jours d'avant ce changement décrivent du matériel qui n'existe plus. L'attente était juste ; le silence à son sujet ne l'était pas, et se lisait comme un historique ignoré. La carte montre maintenant les jours qu'elle a déjà et énonce sa progression : combien de jours clairs sont acquis, combien il en faut, et depuis quand ils comptent — le seuil et la date-couperet venant du serveur pour que l'affichage ne puisse pas diverger des règles. Le graphe de l'état « en construction » omet délibérément la ligne de référence pointillée : un étalon en cours de construction ne se dessine pas comme un étalon. (#725)
- Docs : **deux articles de fond sur docs.sowel.org** — l'arbitre de surplus (chaque réglage documenté, la boucle de décision, les modes de panne) et la surveillance de la santé des panneaux (la conception mesurée et sa validation sur une vraie panne de huit mois), chacun en une moitié grand public et une moitié technique, en anglais et en français. (#723)

### v1.58.0 — 2026-08-26 { #v1-58-0 }

- Feat (energy) : **Sowel prévient désormais le foyer quand l'installation solaire décroche** (spec 162). La v1.57.0 avait appris à Sowel ce que les panneaux devaient produire à chaque heure ; rien ne remarquait quand ils s'arrêtaient de le faire. Une fois par jour, la production mesurée est divisée par la lumière qui a réellement atteint les panneaux — l'irradiance dans le plan des panneaux, que le prévisionniste calcule déjà — sur les seules heures claires de mi-journée (10-16 h locales, fraction directe au-dessus de 0,75, au moins quatre heures), de sorte qu'une semaine couverte est ignorée plutôt que comptée comme une panne. Le ratio du jour est comparé à ce dont l'installation s'est récemment montrée **capable** : le 80e centile des 180 derniers jours qualifiants, et non une médiane — ce choix est le cœur de la fonctionnalité. Rejoué sur une vraie panne d'un panneau ayant duré huit mois sur l'installation de référence, une médiane glissante couvrait 7 % des jours de panne — la panne remplit la fenêtre, devient la référence, et se fait accepter comme nouvelle normale — quand le centile haut en couvre 91 % au même taux de fausses alertes de 2 %. Trois jours clairs consécutifs à plus de 10 % en dessous lèvent une seule alarme, par le même canal que toutes les alarmes Sowel (notifications, bannière, fil d'activité), avec la référence figée au déclenchement pour que la panne ne puisse pas éroder son propre étalon ; trois jours clairs revenus au-dessus la résolvent. Sur le rejeu, le détecteur a confirmé la panne en deux jours clairs, tenu l'alerte tout l'hiver, l'a résolue à la réparation, et est resté muet lors d'un ajout de 1 kWc qui avait été déclaré. La carte énonce ses propres limites : à quelle vitesse elle peut voir au rythme où les jours clairs arrivent (quasi endormie en décembre, et elle le dit), qu'elle nomme l'ampleur d'un défaut, jamais quel panneau. (#719)
- Feat (ui) : **le suivi photovoltaïque vit désormais dans Énergie > Production, sa configuration dans Réglages > Énergie** (spec 163). La prévision, son historique de justesse et la nouvelle carte de santé avaient tous atterri sur la fiche équipement du compteur de production — mêlant l'observation horaire à un acte d'administration fait une fois par changement d'installation, et cachant « mon solaire va bien ? » derrière Équipements pendant que la page Production se résumait à un histogramme. Les panneaux de suivi s'affichent maintenant sous ce graphique, un bloc par compteur déclaré ; le formulaire de déclaration et l'ajustement depuis l'historique rejoignent les tarifs et l'arbitre dans Réglages > Énergie ; la fiche équipement garde ce qui décrit le compteur en tant qu'appareil. La puissance crête déclarée reste visible sur la vue de suivi — une déclaration périmée doit se voir là où elle fait des dégâts — et pointe, pour les admins, directement vers la section qui la corrige. (#721)

## 1.57.x : Savoir ce que les panneaux vont produire

### v1.57.1 — 2026-08-25 { #v1-57-1 }

- Fix (energy) : **le graphique de production affiche désormais ce que le compteur a relevé, avant même qu'une prévision puisse lui être comparée.** Signalé une heure après l'arrivée de la v1.57.0 sur une installation réelle : le graphique traçait la courbe de production attendue au-dessus d'un passé vide, alors que les relevés du compteur étaient bel et bien en base, connus et invisibles. La courbe du réalisé était alimentée par la comparaison prévu/réalisé, qui par construction ne contient que les heures où une prévision _émise la veille_ peut être appariée à ce qui s'est passé — et une installation déclarée le matin même n'a aucun historique de prévisions. La courbe n'avait donc rien à tracer pendant une journée entière, précisément le moment où un foyer la regarde le plus. Le chiffre de justesse continue de ne compter que les heures appariées et reste inchangé ; la courbe n'en dépend plus. (#717)

### v1.57.0 — 2026-08-25 { #v1-57-0 }

- Feat (energy) : **une prévision horaire de ce que votre installation photovoltaïque va produire, jusqu'à cinq jours** (spec 160). Sowel savait déjà ce que les panneaux avaient produit ; il ne pouvait rien dire de ce qu'ils allaient produire. Le foyer déclare son installation une fois — inclinaison, orientation, puissance crête, une entrée par pan de toiture — et tout le reste est mesuré plutôt que demandé. L'ombrage en particulier ne se déclare jamais : le modèle l'apprend. Sur l'installation de référence il ressort à 53 % de rendement à 08 h et 61 % à 20 h, ce qui est les arbres du propriétaire, et 89 % aux heures les plus chaudes, ce qui est la perte thermique. Le modèle est volontairement de l'arithmétique sans mystère : un gain scalaire et un coefficient par heure de la journée, réajusté chaque nuit sur 45 jours glissants. Confronté à trois alternatives sur 92 jours de production réelle, il bat un modèle physique du champ (158 W d'erreur horaire contre 310 W) et un ajustement sur un dictionnaire d'orientations candidates (323 W). Nécessite la **version 2.3.0 du plugin Weather Forecast**, qui publie l'ensoleillement dont la projection a besoin. (#711)
- Feat (energy) : **la prévision peut s'ajuster sur la production déjà enregistrée, au lieu d'attendre douze jours qu'elle apprenne** (spec 161). Un apprentissage à froid demande environ 120 heures de jour exploitables : un foyer qui venait de déclarer son installation voyait une estimation provisoire pendant une quinzaine. Une action reconstruit désormais le modèle à partir de l'historique que Sowel détient déjà. Mesuré sur des jours que le modèle n'avait jamais vus : 186 W d'erreur horaire, et 101,7 kWh prévus contre 100,1 relevés. La borne est tout l'enjeu — l'installation de référence a gagné 1 kWc en cours de fenêtre, et ajusté à cheval sur cette date le gain ne décrit ni le champ d'avant ni celui d'après, doublant l'erreur à 325 W. La fenêtre est donc la plus courte entre 45 jours et une date « inchangé depuis » optionnelle, que seul le foyer peut fournir. Rien n'est effacé tant qu'un ajustement n'a pas réellement abouti : une date saisie de travers ne peut pas vous coûter l'historique que vous aviez. (#713)
- Feat (ui) : **la prévision et le réalisé sur une seule frise.** La courbe de production attendue et la comparaison prévu/réalisé étaient deux graphiques empilés, montrant la même grandeur dans la même unité sur des périodes qui se touchent — l'un finit à maintenant, l'autre y commence. Ils n'en font plus qu'un : le passé porte les deux courbes, un repère marque où s'arrête le relevé, et la prévision continue seule. Une heure passée affiche ce qui avait été promis pour elle la veille, jamais une valeur recalculée depuis, qui flatterait le modèle contre son propre relevé. La fenêtre remonte à 7, 30 ou 90 jours. (#714)
- Feat (ui) : **l'indice de confiance de la météo se lit comme une couleur, pas comme une notation d'ingénieur.** « ± 0,9 °C » sous une température n'apprend rien d'actionnable à un foyer. Chaque jour porte désormais une pastille à trois niveaux — élevée, moyenne, faible — avec les modèles qui y contribuent nommés en dessous. (#708)
- Feat (activity) : **le fil d'activité de zone consigne aussi la fin des alarmes, plus seulement leur déclenchement.** Il s'abonnait à `system.alarm.raised` et jamais à son pendant, si bien que chaque incident n'était raconté qu'à moitié : une coupure secteur apparaissait et ne se terminait jamais. (#709)
- Fix (ui) : **un compteur de production n'étiquette plus en consommation l'énergie qu'il a produite.** La carte des cumuls ne regardait pas le type de l'équipement. (#714)
- Fix (ui) : **les dates et les jours de la semaine s'affichent enfin en français pour un foyer français.** Trois composants comparaient la langue détectée à `"fr"` par égalité, alors que le navigateur annonce `fr-FR` ; les traductions se résolvaient bien pendant que toutes les dates à côté restaient américaines. (#713)
- Maintenance (packages) : **le plugin Weather Forecast passe en 2.3.0** dans le registre, apportant la confiance par ensemble, la série d'ensoleillement et les 45 jours d'ensoleillement passé dont les deux fonctionnalités ci-dessus ont besoin. (#715)
- Maintenance (packages) : **le plugin communautaire NUT passe en 0.2.0.** (#710)
- Maintenance (docs) : **un guide de maintenance pour trier les mises à jour de dépendances**, tiré d'une passe complète sur le backlog : comprendre pourquoi une PR est rouge avant d'agir, monter ensemble les majeures couplées par leurs pairs, et les versions volontairement retenues. (#690)

## 1.56.x : Savoir à quel point faire confiance à la météo

### v1.56.0 — 2026-08-24 { #v1-56-0 }

- Feat (ui) : **la carte de prévision indique désormais la confiance à accorder à ses propres chiffres** (spec 159). Jusqu'ici elle affichait une température par jour sans permettre de distinguer une valeur sur laquelle les modèles s'accordent d'une valeur sur laquelle ils divergent, et se fier à « demain il fera 34 °C » ne disait pas s'il fallait comprendre 33 à 35 ou 29 à 37. La carte affiche maintenant l'incertitude sous chaque maximum et nomme sa source sous la rangée : `AROME 2.5 km`, ou `médiane de 4 modèles`. Une journée sur laquelle les modèles s'écartent de 8 °C se lit immédiatement comme non exploitable, ce qu'aucun chiffre unique ne peut exprimer. Ces valeurs viennent de la **version 2.0 du plugin Weather Forecast**, qui résout chaque jour à partir de tous les modèles couvrant la maison au lieu d'accepter un choix non divulgué, et calcule une vraie probabilité de pluie sur 51 membres d'ensemble. Tant que ce plugin n'est pas mis à jour, la carte s'affiche exactement comme avant : les deux peuvent donc être mis à jour dans n'importe quel ordre. (#704)
- Maintenance (packages) : **un plugin NUT communautaire rejoint le registre**. `sowel-plugin-nut` expose les onduleurs servis par un serveur Network UPS Tools, le flux fourni par Synology, QNAP, Proxmox et la plupart des hôtes Linux, et se marie avec le type d'équipement UPS ajouté en v1.53.0. Il provient d'un auteur hors de la liste officielle : Sowel le signale donc comme paquet communautaire et demande une confirmation explicite à l'installation, empreinte de l'archive à l'appui. Il nécessite Sowel 1.53.0 ou plus récent. Contribution de adn-dev-adrien. (#703)

## 1.55.x : Mesurer l'arbitre, et réparer ce que chaque redémarrage perdait

### v1.55.0 — 2026-08-23 { #v1-55-0 }

- Feat (energy) : **le comportement de l'arbitre est désormais mesuré et conservé** (spec 158). Le journal de décisions et la série de surplus sont purgés au bout de 7 jours, si bien qu'une question comme « combien de fois par jour cette charge démarre-t-elle pour être révoquée quelques minutes plus tard ? » n'avait aucune réponse au-delà d'une semaine, et chaque réglage se décidait à l'intuition. Un rollup horaire les agrège maintenant dans deux tables journalières conservées 400 jours : par charge, le nombre de démarrages, de révocations, de **court-cycles** (un octroi révoqué pour déficit de surplus à l'intérieur de sa propre durée minimale de marche, autrement dit une charge qui a démarré sur un surplus qui n'a pas tenu), et le temps passé accordé, en attente, en marche hors arbitrage ou suspendu. Par jour, l'export, l'import, le surplus qu'une charge réclamait activement, et celui qu'une charge décalable aurait pu utiliser si quelque chose l'avait programmée. Lecture via `GET /api/v1/energy/arbiter/metrics` ou `scripts/energy/arbiter-metrics.ts`, qui ouvre la base directement et fonctionne donc sur une sauvegarde restaurée, sans instance démarrée. Pure instrumentation : pas une ligne de l'arbitre n'a changé, et aucune décision d'arbitrage n'est affectée. (#693)
- Fix (core) : **l'arrêt propre s'exécute enfin**. Un gestionnaire de signal enregistré tout en haut du démarrage terminait le processus immédiatement, masquant la vraie séquence d'arrêt enregistrée plus loin, Node appelant les gestionnaires dans l'ordre d'enregistrement. La conséquence était invisible mais réelle : à chaque redémarrage de conteneur, arrêt, ou mise à jour automatique, les intégrations n'étaient jamais fermées proprement, la base n'était jamais close (donc le WAL jamais consolidé), et le tampon d'écriture InfluxDB était **perdu**, avec les points d'énergie qu'il contenait encore. Un gestionnaire unique aiguille maintenant vers le bon comportement selon l'avancement du démarrage, borné par un chien de garde pour qu'un plugin bloqué ne transforme pas un arrêt propre en arrêt brutal. (#696)
- Fix (devices) : **un message d'appareil s'écrit désormais en une seule transaction au lieu d'une par attribut**, soit 10 fois moins d'octets écrits sur le disque et 2,8 fois moins de temps par message, sur le chemin le plus sollicité du moteur. La partie cohérence compte davantage : les événements partaient entre les écritures, donc tout consommateur relisant plusieurs valeurs d'un même équipement voyait un message partiellement appliqué, une fois par attribut. Dans le cas le plus grave observé, le suivi de température d'eau de piscine pouvait enregistrer une mesure d'eau stagnante comme dernière valeur valide et la servir pendant 24 heures. La dérivation d'état des portails, la classification des sous-compteurs et l'agrégation de zone étaient touchées de la même façon. Un attribut impossible à enregistrer est maintenant ignoré et journalisé au lieu de faire échouer tout le message, si bien qu'une seule mauvaise valeur envoyée par un plugin ne peut plus faire passer un appareil sain pour définitivement hors ligne. (#697)
- Maintenance (core) : **la pragma SQLite `synchronous` est fixée explicitement** au lieu d'être héritée du drapeau de compilation d'une dépendance, pour qu'une future mise à jour ne puisse pas changer silencieusement la fréquence des écritures forcées sur le disque. Aucun changement de comportement sur une installation existante. (#694)

## 1.54.x : Tuile de tableau de bord cliquable et diagramme de flux partagé

### v1.54.0 — 2026-08-22 { #v1-54-0 }

- Feat (ui) : **toute la tuile du tableau de bord bascule désormais un équipement on/off**. Lumières, interrupteurs, prises, chauffe-eau, vannes, radiateurs, pompes de piscine, lecteurs multimédia et portails à action unique changent d'état quand on clique n'importe où sur la carte, plus seulement sur le petit bouton sous l'icône, comme le faisait déjà la carte mobile. Les tuiles à plusieurs contrôles (volets, thermostats, volets de piscine, VMC) gardent leurs boutons, et en mode édition la tuile n'agit plus pour pouvoir être déplacée et renommée sans risque. Un glissement du curseur de luminosité relâché hors de sa piste n'éteint plus la lumière. (#689)
- Feat (ui) : **le panneau de détail onduleur est reconstruit sur un diagramme de flux partagé** (spec 157). Le diagramme de routage d'Energy · Live est extrait en composant réutilisable, et le panneau onduleur est rebâti dessus : trois cartes (le diagramme en direct, une carte marges et seuils, une fiche technique repliée) remplacent l'ancienne liste plate de lignes indifférenciées. Les noms de champs sont traduits, les booléens s'affichent par une coche ou un tiret au lieu du mot « false », et aucune valeur n'apparaît deux fois. La page Energy s'affiche exactement comme avant, protégée par un test de caractérisation écrit avant l'extraction. (#688)

## 1.53.x : Type d'équipement onduleur

### v1.53.0 — 2026-08-21 { #v1-53-0 }

- Feat (équipements) : **un nouveau type d'équipement onduleur (UPS), en lecture seule** (spec 156). Modélise un onduleur comme une seule unité fonctionnelle avec son état d'alimentation (sur secteur, sur batterie, batterie faible, by-pass, surcharge, sortie coupée), sa charge de batterie, son autonomie restante et sa charge de sortie. Il se lie à la télémétrie que le plugin expose, n'affiche que les valeurs réellement présentes et n'offre aucune commande, volontairement : un ordre d'arrêt accidentel vers un onduleur est irrécupérable, la chaîne d'arrêt propre reste du côté de l'hôte qui fait tourner `upsmon`. Un nouveau groupe « Alimentation » regroupe les onduleurs dans les vues zone et maison. L'intégration compagnon est `sowel-plugin-nut` (Network UPS Tools), qui lit le flux exposé par Synology, QNAP, Proxmox et la plupart des hôtes Linux. (#676)
- Maintenance : **mises à jour de dépendances et de CI**. React Router, PostCSS, nanoid, js-yaml et fast-uri ont été mis à jour côté interface, ainsi qu'un groupe backend mineur/correctif et les actions GitHub utilisées par la CI, plusieurs corrigeant des avis de sécurité. Aucun changement fonctionnel. (#641, #642, #643, #644, #645, #677, #678, #680)

## 1.52.x : Ventilation deux vitesses et arbitre plus stable

### v1.52.8 — 2026-08-21 { #v1-52-8 }

- Sécurité (ws) : **le WebSocket temps réel applique désormais une autorisation par rôle**. Les données sensibles (configuration des brokers MQTT et des publieurs de notification, et le flux de logs serveur) ne sont livrées qu'aux sessions admin ; une session non-admin ne peut plus s'abonner à ces flux. Le comportement admin est inchangé. (#646)
- Correctif (équipements) : **un équipement ne lit plus un statut d'appareil périmé comme un échec de livraison**. Après un redémarrage, la base contient encore le statut laissé par le dernier arrêt, jusqu'à ce que l'intégration rejoue le vrai une seconde ou deux plus tard ; le chemin rapide de confirmation d'ordre le prenait pour la preuve que la commande ne pouvait pas être délivrée et levait une fausse alarme. Il attend désormais une preuve réelle, et une charge re-commandée ne produit plus d'avertissements erronés répétés pendant une panne d'intégration. (#635)

### v1.52.7 — 2026-08-20 { #v1-52-7 }

- Feat (énergie) : **un délai d'extinction par équipement pour l'arbitre**. Une charge inertielle (par exemple un chauffe-eau Atlantic Calypso dont la pompe à chaleur continue de tourner environ 30 minutes après l'ouverture de son contact solaire) ne déclenche plus une fausse alarme « révocation non honorée » à chaque relâche. Renseignez le champ optionnel « Délai d'extinction » sur le panneau énergie de l'équipement pour que l'arbitre laisse passer cette traîne avant de la signaler ; la protection anti-cascade des autres charges reste immédiate. Sans délai renseigné, le comportement est inchangé. (#632)
- Correctif (énergie) : **l'énergie cumulée n'est plus remise à blanc en début d'heure, de jour, de mois ou d'année**. Une requête InfluxDB de plage nulle (par exemple entre 00:00 et 00:59 en heure locale, quand aucune heure du jour n'est encore close) levait une erreur et écartait toutes les valeurs cumulées de l'équipement, générant des centaines d'avertissements par nuit. Les plages vides valent désormais 0 sans requête, de sorte que les relevés restent stables à ces frontières. (#633)

### v1.52.6 — 2026-08-19 { #v1-52-6 }

- Feat (équipements) : **la bascule « inverser le sens » par équipement (spec 154) couvre désormais aussi les portails et déclencheurs booléens momentanés**. Un relais câblé pour déclencher sur le front OFF au lieu de ON (constaté sur un SONOFF MINI-ZBD pilotant une porte de garage) s'inverse directement depuis la page de l'équipement, la même bascule que celle utilisée pour inverser l'ouverture/fermeture d'un volet. Elle reste opt-in par équipement, donc les installations existantes ne sont pas affectées. (#628)

### v1.52.5 — 2026-08-19 { #v1-52-5 }

- Feat (équipements) : **une bascule « inverser le sens » par équipement pour les volets et stores** (spec 154). Quand le moteur a l'ouverture et la fermeture câblées à l'inverse de ce que Sowel suppose, et que l'intégration n'offre pas d'inversion côté passerelle, un admin peut désormais inverser le sens sur l'équipement lui-même. Cela s'applique à tous les chemins de commande (carte, actions groupées de zone, recettes, modes). (#623)
- Feat (ui) : **les journaux de recette sont désormais accessibles sur le téléphone (PWA)**. Le point d'entrée des journaux était masqué en dessous de 640 px ; il s'ouvre maintenant dans une feuille inférieure sur mobile, tout en conservant le panneau intégré sur ordinateur. (#622)
- Feat (ui) : **le tableau des charges de l'arbitre est désormais trié par priorité configurée** au lieu de l'état, pour rester cohérent avec la timeline. La pastille d'état de chaque ligne indique toujours si la charge est autorisée, en attente, suspendue ou inactive. (#621)
- Correctif (énergie) : **une charge sous-comptée inactive bascule désormais son total quotidien à la frontière de l'heure et de minuit**. Un sous-compteur de puissance seule resté à 0 W pouvait continuer d'afficher l'énergie cumulée de la veille pendant la nuit (par exemple un chauffe-eau bloqué à 2,92 kWh) ; un rafraîchissement aligné sur l'heure le recalcule maintenant depuis l'historique. (#619)
- Correctif (ui) : **les cellules « en attente » de la timeline de l'arbitre utilisent la même teinte douce que le tableau des charges** au lieu d'un orange d'avertissement plein, pour une lecture plus apaisée. (#620)
- Correctif (ui) : **un équipement de ventilation deux vitesses (VMC) apparaît désormais dans sa zone et la vue maison**. Il relève d'un nouveau groupe « Ventilation » ; il était auparavant filtré en silence de la liste de zone bien qu'il fonctionne. Son sélecteur OFF/V1/V2 devient aussi une pastille segmentée compacte. (#625)

### v1.52.4 — 2026-08-18 { #v1-52-4 }

- Correctif (ui) : **l'arbitre indique désormais « hors arbitrage » pour une charge non gérée**, au lieu de l'ancienne formulation moins claire, de sorte qu'une charge que l'arbitre d'énergie ne pilote pas se lit sans ambiguïté. (#611)
- Correctif (ui) : **les valeurs d'énergie sous-comptée sur la carte d'équipement compacte n'ajoutent plus le suffixe « aujourd'hui » redondant**, ce qui allège la lecture de la carte. (#612)

### v1.52.3 — 2026-08-18 { #v1-52-3 }

- Correctif (énergie) : **la timeline d'activité de l'arbitre n'affiche plus de bandeau « autorisé » fantôme après un redémarrage**. Quand Sowel redémarrait alors qu'une charge flexible était autorisée ou en attente, la timeline rejouait cet état jusqu'à maintenant alors même que la charge était redevenue inactive. Sowel ferme désormais le segment en suspens à la frontière du redémarrage et répare le journal persisté pour que tous les futurs rejeux soient corrects. Le tableau des charges a toujours été exact. (#606)

### v1.52.2 — 2026-08-18 { #v1-52-2 }

- Correctif (ui) : **la bascule « Solaire » de la carte d'équipement compacte fonctionne à nouveau**. Un appui ne faisait rien (la page détail de l'équipement n'était pas concernée) ; le gestionnaire de clic du bouton était neutralisé. Le pilotage solaire par l'arbitre d'énergie n'a jamais été impacté. (#600)

### v1.52.1 — 2026-08-18 { #v1-52-1 }

- Fix (énergie) : **une charge en dérogation manuelle n'apparaît plus deux fois sur la surface de l'arbitre**. Une charge flexible qui avait une demande en attente au moment où elle est allumée à l'interrupteur mural n'apparaît plus que « Suspendu », et non plus aussi « En attente ». (#599)

### v1.52.0 — 2026-08-18 { #v1-52-0 }

- Feat (équipements) : **la ventilation deux vitesses (VMC) devient un type d'équipement dédié**. Une VMC 2 vitesses se modélise directement ; son ordre de vitesse est décomposé en une séquence relais coupure-avant-établissement, de sorte que les deux enroulements ne sont jamais alimentés en même temps. Se marie avec la recette vmc-humidity. (#573, #586)
- Feat (équipements) : **un canal de commande on/off dédié aux équipements solaires** (spec 152), pour piloter une installation de production solaire indépendamment de son canal de mesure. (#574)
- Feat (énergie) : **la surface de l'arbitre affiche un état nuit dormant** quand aucun surplus n'est attendu la nuit, au lieu d'un vide d'apparence inactive. (#577, #581)
- Fix (caméras) : **le proxy de vue en direct HLS réécrit désormais les playlists imbriquées (maître vers variante), sert les segments binaires `.ts` octet par octet et prend en charge la balise `EXT-X-MAP`**. Cela répare les segments corrompus qui affectaient la vue en direct de la caméra Netatmo. (#580)
- Fix (énergie) : **l'arbitre et le flux d'activité se rafraîchissent à la reconnexion ou au retour de l'application au premier plan**, de sorte qu'un onglet en arrière-plan n'affiche plus une arbitration périmée. (#589, #591)
- Fix (énergie) : **les spans « en attente » de la timeline de l'arbitre sont désormais correctement fermés** au lieu de rester ouverts. (#584, #587)
- Fix (énergie) : **un sous-compteur purement énergie est exclu du flux d'affichage de la puissance instantanée**, pour ne pas gonfler la lecture. (#590, #592)
- Fix (ui) : **la page de détail d'un équipement ne recharge plus lors de changements d'équipements non liés**. (#579)
- Fix (ui) : **les clés de traduction brutes de l'arbitre (comme l'état d'attente) s'affichent désormais en texte correct**. (#575, #576)
- Sous le capot : **validation des entrées API durcie** (schémas de corps déclaratifs sur davantage de routes, en conservant l'ordre 403/404 avant 400) et chemin d'exécution des ordres d'équipement refactoré en fonctions nommées, le tout couvert par des tests. (#453, #482)
- Chore (registry) : la recette vmc-humidity publiée et mise à jour pour le support natif de la VMC ; entrée registry zigbee2mqtt rafraîchie. (#571, #572, #582, #585)

## 1.51.x : Double authentification et arbitre énergie affiné

### v1.51.0 — 2026-08-17 { #v1-51-0 }

- Feat (auth) : **double authentification (TOTP) avec codes de secours**. Un compte peut activer la 2FA par application (Google Authenticator, Authy et similaires) : enrôlement par QR code dans les réglages utilisateur, code à six chiffres à la connexion, et codes de secours à usage unique pour récupérer l'accès en cas de perte de l'authentificateur. (#541)
- Feat (énergie) : **une charge pilotable déclarée sans réservation active apparaît désormais dans la liste de l'arbitre avec un état d'attente**. Une charge que vous avez enrôlée mais qu'aucune automatisation ne réclame s'affiche en attente sur la surface d'arbitrage et la timeline, au lieu d'être invisible jusqu'à sa prochaine marche. (#561, #562)
- Change (énergie) : **l'arbitre de surplus ne demande plus de choisir la classe de charge ; elle est déduite du type d'équipement**. Le panneau Pilotage énergie a supprimé le sélecteur Confort/Différable. Qu'une charge soit un relais (pompe de piscine, chauffe-eau) ou auto-régulée (thermostat, climatisation) est une propriété du type d'équipement, donc Sowel la déduit, et un type sans sémantique énergie ne peut plus être déclaré charge pilotable. Pas de migration ; les profils existants sont inchangés. (#555, #568, #569)
- Fix (énergie) : **la courbe et la pastille de surplus de l'arbitre affichent le vrai solde réseau signé** (export positif, import négatif) au lieu d'un chiffre de réservation interne, si bien que la lecture correspond à votre compteur. (#563, #565)
- Fix (énergie) : **un sous-compteur qui ne rapporte aucune mesure de puissance est retiré de la répartition de consommation** au lieu d'y afficher une ligne à zéro parasite. (#560, #567)
- Fix (devices) : **un indicateur `battery_low` est classé comme lecture générique, pas comme niveau de batterie**. (#559)
- Chore (registry) : zigbee2mqtt en 2.5.1 (correctif jumeau battery_low), smart-cooling en 2.1.0 (pré-refroidissement proportionnel au surplus), pool-pump-schedule en 1.6.2. (#554, #556, #558, #564, #566)

## 1.50.x : Tolérance de surplus par équipement

### v1.50.0 — 2026-08-16 { #v1-50-0 }

- Feat (énergie) : **la quantité d'import réseau qu'une charge pilotable accepte pour tourner sur un surplus partiel se règle désormais sur l'équipement, à côté de sa puissance nominale**. L'arbitre de capacité engage une charge dès que le surplus couvre « puissance nominale + marge - import toléré » ; cette tolérance était jusqu'ici fixée par chaque recette, elle vit maintenant sur le profil énergie de l'équipement (panneau Pilotage énergie), comme la puissance nominale et les durées mini de marche/arrêt. Une automatisation peut toujours la surcharger pour un besoin ponctuel, mais l'équipement est la source de vérité par défaut, si bien que la même charge se comporte de façon cohérente quelle que soit la recette qui la pilote. Le défaut 0 conserve le comportement précédent. (#550, #551)

## 1.49.x : Sous-comptage universel

### v1.49.0 — 2026-08-16 { #v1-49-0 }

- Feat (énergie) : **tout équipement qui mesure une puissance ou une énergie est désormais compté dans le bilan, quel que soit son type**. L'enrôlement en sous-compteur reposait sur une liste blanche par type (compteurs dédiés, prises et chauffe-eau mesureurs) ; c'est maintenant l'inverse, si bien qu'un thermostat mesuré (une climatisation sur sa propre pince de mesure), une pompe de piscine, un électroménager ou une lumière variateur avec mesure entrent tous dans la répartition par usage et voient leur puissance intégrée en énergie, sans liste par type à maintenir. Seuls le compteur principal et les compteurs de production sont exclus. Une liaison doit porter une vraie mesure numérique : un état Marche/Arrêt exposé en « power » (un lecteur multimédia, l'interrupteur d'un thermostat) est un état, pas une mesure, et n'est jamais pris pour un sous-compteur à 0 W. La liste des sous-compteurs de l'afficheur d'énergie est désormais ordonnée compteurs dédiés d'abord pour que sa capacité fixe de 8 conserve les vraies pinces. (#523, #548)
- Feat (ui) : **les durées minimales de marche et d'arrêt du profil énergie s'éditent en minutes** au lieu de secondes, au plus près de la façon dont on raisonne ces valeurs. (#546, #547)
- Correctif (énergie) : **les runs hors pilotage ouverts sont restaurés depuis le journal au démarrage**, si bien qu'une charge laissée en marche hors arbitrage garde sa timeline correcte après un redémarrage au lieu d'être peinte hors pilotage jusqu'à son prochain cycle complet. (#543, #544)
- Chore (registry) : pool-pump-schedule passé en 1.5.0 (la pompe à chaleur de piscine peut désormais chauffer sur le surplus solaire via sa consigne). (#545)

## 1.48.x : Valeurs typées et portails sur tout relais

### v1.48.1 — 2026-08-16 { #v1-48-1 }

- Fix (energy) : **une charge à l'arrêt n'est plus affichée comme "en marche (hors pilotage)" sur la timeline de l'arbitre**. Une charge coupée manuellement, par un bouton, ou par sa propre régulation pouvait rester dessinée comme un run hors pilotage indéfiniment : une suspension déclenchée par un OFF était mappée sans condition sur hors pilotage, la clôture de fin de run n'était émise que pour les ordres de recette, et l'expiration d'une suspension passait silencieusement. Les décisions portent maintenant l'état on/off de la charge, tout OFF observé (un ordre de n'importe quelle source ou un état OFF rapporté, y compris une charge de confort qui s'arrête sur sa propre régulation) clôt le run hors pilotage, et l'expiration d'une suspension est journalisée avec l'état observé. (#535, #536)
- Fix (ui) : **l'axe X du graphe Analyse reste lisible quand mesures et états sont mélangés**. Deux séries tombant sur le même instant sous des écritures de timestamp différentes créaient deux points à la même position, ce qui désactivait l'espacement des libellés et peignait tous les libellés en une bande illisible. Signalé par Adrien Jouve (computingify). (#537, #539)
- Fix (ui) : **le sélecteur d'icône du dashboard mobile s'ouvre au-dessus des cartes en mode édition**. L'animation de tremblement du mode édition piégeait le sélecteur derrière les cartes situées en dessous, avec un fond qui n'assombrissait que sa propre carte ; le sélecteur s'ouvre désormais par-dessus tout l'écran avec un fond plein écran. Signalé par Adrien Jouve (computingify). (#538, #540)
- Chore (registry) : pool-pump-schedule passé en 1.4.2. (#533)

### v1.48.0 — 2026-08-15 { #v1-48-0 }

- Feat (devices) : **les valeurs des devices sont désormais normalisées une seule fois à l'ingestion, ce qui clôt la famille de bugs "ça marche dans Zigbee2MQTT, pas dans Sowel"**. Une donnée booléenne porte toujours un vrai booléen quelle que soit la forme envoyée par le device ("ON", "true", 1...), les nombres reçus en texte deviennent des nombres, et les valeurs d'énumération retrouvent leur casse déclarée : tous les consommateurs (dashboard, zones, historique, recettes, confirmation d'ordres) voient un type stable. Une valeur impossible à convertir sûrement est conservée telle quelle et signalée une fois dans le log ; les vocabulaires ambigus comme OPEN/CLOSED ne sont jamais devinés. Une déclaration dont le type contredit sa catégorie (un capteur de contact déclaré en texte, par exemple) est signalée au discovery. Aucune mise à jour de plugin nécessaire : tous les protocoles en bénéficient. (spec 150, #530)
- Feat (equipments) : **un portail peut désormais être piloté par n'importe quel relais on/off, y compris les modules contact sec Zigbee comme le SONOFF MINI-ZBD**. Jusqu'ici seuls les canaux de relais LoRa et les télécommandes Somfy RTS étaient proposés comme actionneurs de portail ; le sélecteur de devices propose maintenant tout relais on/off comme commande du portail (action impulsionnelle ; configurez l'impulsion/inching sur le module lui-même), les capteurs d'ouverture restent associables au même équipement pour l'état ouvert/fermé, et le bouton de commande actionne désormais les relais booléens (il n'envoyait silencieusement rien sur ceux-ci auparavant). (spec 150, #530)
- Fix (ui) : **les lumières variateur et couleur se lient à nouveau automatiquement à la création d'équipement**. La logique de liaison du sélecteur de devices avait divergé de celle du backend et ne proposait aucun candidat pour ces deux types ; les deux côtés partagent maintenant une implémentation unique. (spec 150, #530)
- Fix (energy) : **un sous-compteur en puissance seule affiche ses cumuls d'énergie à 0 dès sa création**. Un chauffe-eau mesuré qui n'avait jamais fonctionné montrait son panneau de puissance en direct mais aucun cumul ; il est désormais enrôlé avec des compteurs à zéro à la création, les vraies valeurs prenant le relais dès les premières mesures. (#527, #529)
- Fix (api) : **la requête des sous-compteurs de l'afficheur d'énergie renvoie maintenant les relais mesureurs**. Le firmware sowel-energy-display récupère sa ventilation via `?type=energy_meter` ; depuis que les relais mesureurs sont devenus des sous-compteurs, ce filtre littéral les excluait. Un filtre `?role=submeter` a été ajouté et la valeur historique continue de renvoyer le même ensemble, si bien qu'un afficheur non reflashé voit un chauffe-eau mesureur sans mise à jour. (#526, #528)
- Note (equipments) : les valeurs de reed LoRa arrivant en texte ("0") dérivaient auparavant un état de portail fermé ; la normalisation dérive maintenant ouvert correctement (correction de polarité).

## 1.47.x : Sous-comptage des chauffe-eau et finitions de l'arbitrage

### v1.47.0 — 2026-08-15 { #v1-47-0 }

- Feat (énergie) : **un chauffe-eau qui ne mesure que la puissance est désormais compté dans le bilan énergie**. Un équipement water_heater relié à une mesure de puissance, sans commande Marche/Arrêt nécessaire, est maintenant traité comme un sous-compteur de consommation, comme un compteur d'énergie dédié : ses watts sont intégrés en énergie, il apparaît dans la répartition par usage, et son énergie du jour s'affiche sur sa carte et sa vue détail. L'énergie se cumule à partir du moment où la mesure est reliée, sans rattrapage rétroactif. Les prises connectées avec mesure (spec 129) entrent elles aussi pour la première fois dans la répartition par usage. (#521, #522)
- Correctif (énergie) : **la courbe de surplus de l'arbitre reste vivante au lieu de se figer sur un instantané pris à l'ouverture de la page**. (#514, #515)
- Correctif (énergie) : **la pastille d'état de l'arbitre est plus petite et colorée selon le surplus ou le déficit**. (#511)
- Correctif (ui) : **les motifs du journal de décisions de l'arbitre suivent la langue de l'application**. Les motifs d'accord et de retrait n'étaient affichés qu'en anglais ; ils sont désormais localisés (FR/EN). (#518, #519)
- Correctif (déploiement) : **les journaux des conteneurs sont plafonnés et la sortie standard d'InfluxDB est réduite au silence**. Compose borne désormais la taille du fichier de log de chaque conteneur et fixe INFLUXD_LOG_LEVEL pour qu'InfluxDB cesse d'inonder la sortie standard, ce qui limite l'usage disque et le bruit des logs sur une instance qui tourne longtemps. (#512, #516, #517)
- Interne (ui) : la présentation des widgets du tableau de bord passe maintenant par un résolveur partagé (switch, media_player et pool_pump migrés), sans changement visible. (#325, #513)
- Interne (outillage) : la skill de gestion des issues Sowel a gagné une phase de revue par agent avant l'ouverture de la PR. (#520)

## 1.46.x : Finitions de la page Analyse, activité persistante et frise d'arbitrage plus claire

### v1.46.0 — 2026-08-15 { #v1-46-0 }

- Feat (énergie) : **la frise d'arbitrage est redessinée en une courbe signée surplus/déficit, avec un ruban par charge et un journal des décisions**. La vue du surplus disponible se lit désormais comme une seule courbe continue, verte au-dessus de la ligne quand il y a du surplus et rouge en dessous quand la maison puise sur le réseau, avec une voie par charge profilée et un journal des décisions d'accord et de retrait de l'arbitre. La courbe de surplus réutilise le vert de l'auto-consommation pour que la frise garde un seul vert. (#495, #500, #508)
- Feat (core) : **le fil d'activité et le journal de décisions de l'arbitre survivent maintenant à un redémarrage**. Tous deux étaient gardés en mémoire et effacés à chaque redémarrage de Sowel ; ils sont désormais persistés, si bien que l'historique récent est toujours là après une mise à jour ou un reboot. (#494, #499)
- Feat (équipements) : **actionner un portail depuis un téléphone demande maintenant un glissement de confirmation**. Un portail est lent et physique : un appui involontaire (téléphone en poche) ne doit pas l'ouvrir ; un glisser-pour-confirmer protège l'action sur mobile. (#320, #497)
- Feat (ui) : **la page Analyse s'ouvre sur votre premier graphique enregistré, sur aujourd'hui**. Ouvrir Analyse arrivait sur un constructeur de graphique vide ; elle ouvre désormais le premier graphique enregistré à la date du jour, avec le sélecteur zone/équipement replié pour un écran plus clair. Une entrée « Nouveau graphique » (barre latérale et tiroir mobile) permet toujours d'atteindre le constructeur vide. Signalé par Adrien Jouve (computingify). (#498, #505)
- Correctif (ui) : **l'infobulle de détail d'un point tient à l'écran sur mobile**. Les longs libellés « Zone / Équipement / Mesure » faisaient déborder l'infobulle ; c'est maintenant une carte compacte qui renvoie ses libellés à la ligne et reste dans l'écran. Signalé par Adrien Jouve (computingify). (#498, #506)
- Correctif (énergie) : **une courbe de relais Marche/Arrêt est désormais tracée sur toute la fenêtre**. Une série d'état n'est échantillonnée qu'au changement : un état qui n'a changé qu'une fois, ou pas du tout, dans la fenêtre était tracé à partir du premier échantillon et s'arrêtait au dernier. La ligne en escalier démarre maintenant au bord gauche dans le bon état précédent et prolonge sa dernière valeur jusqu'au bord droit. Signalé par Adrien Jouve (computingify). (#498, #507)
- Feat (auth) : **la gestion des tokens API a été déplacée dans Réglages > Compte, et le login QR mobile inutilisé a été retiré**. Les tokens API personnels (utilisés par des intégrations externes comme l'afficheur d'énergie) se trouvent désormais à côté du mot de passe dans l'onglet Compte, et le login QR de l'onglet Système, source de confusion et non documenté, a disparu. (#501)
- Correctif (ui) : **le bouton d'édition du tableau de bord ne chevauche plus la navigation du bas sur mobile**. Sur les appareils avec un home indicator, le bouton d'édition flottant retombait sur le bouton « Plus » / Réglages ; son décalage tient maintenant compte de la zone de sécurité (safe-area). Signalé par Adrien Jouve (computingify). (#496, #504)

## 1.45.x : Corrections d'affichage de l'arbitrage et nettoyage de l'UI

### v1.45.0 — 2026-08-13 { #v1-45-0 }

- Correctif (énergie) : **une charge qui tourne réellement n'est plus affichée « en attente de surplus »**. Quand une recette fait tourner une charge pilotable en repli « marche obligatoire » alors que sa demande de surplus solaire reste en attente (journée chaude, aucun surplus à accorder), la surface d'arbitrage l'indiquait « en attente de surplus » alors qu'elle consommait plusieurs kW. Une telle demande affiche désormais « en marche (hors surplus) » avec son propre marqueur ; une demande réellement à l'arrêt est inchangée. (#491, #492)
- Correctif (énergie) : **une demande d'arbitrage en attente indique le surplus qu'elle attend, pas sa propre consommation**. Une demande qui tolère d'acheter un peu de réseau démarre bien en dessous de sa puissance nominale ; afficher la puissance nominale laissait croire « ça ne démarrera jamais ». La ligne montre maintenant le surplus réellement testé par l'arbitre, avec la puissance de l'appareil et l'import réseau toléré en contexte, et la frise du surplus a gagné des segments par run pour les charges tournant hors arbitrage. Contribution d'Adrien Jouve (computingify). (#474)
- Correctif (ui) : **les tuiles d'équipements portant le même nom sont distinguées par leur zone**. Deux capteurs de même nom dans des pièces différentes étaient indiscernables sur le tableau de bord ; chacun affiche désormais sa zone distinctive sur une deuxième ligne, en réutilisant l'étiquetage par plus court suffixe déjà employé ailleurs dans l'application. Contribution d'Adrien Jouve (computingify). (#488)
- Correctif (ui) : **les nœuds au repos du schéma énergétique en direct restent opaques**. Un nœud à l'arrêt s'estompait assez pour laisser transparaître les flux à travers son icône ; la boîte garde maintenant une opacité pleine et seul son contenu s'estompe. Contribution d'Adrien Jouve (computingify). (#487)
- Correctif (ui) : **la tuile compteur d'énergie s'affiche désormais sur mobile et la tuile lecteur multimédia sur ordinateur**. Chacune des deux catégories de tuiles ne s'affichait que sur un seul format d'écran. (#323, #324, #485)
- Interne (ui) : grande passe de maintenabilité sur l'UI des recettes et des publishers, sans changement visible. Le fichier `ZoneRecipesSection` de 2200 lignes a été découpé en modules par composant avec un hook partagé d'options de zone, les pages de publishers de notifications et MQTT ont été unifiées sur un éditeur descriptif et une couche de source de mapping partagés, et un niveau de tests de composants jsdom + Testing Library a été introduit. (#456, #387, #457, #458, #484, #486, #489, #490)

## 1.44.x : Validation des entrées API et OpenAPI

### v1.44.0 — 2026-08-13 { #v1-44-0 }

- Fix (devices) : **les alertes de batterie faible nomment désormais l'équipement concerné et restent cantonnées à sa zone**. Un capteur en batterie faible n'apparaissait que par le nom du device et remontait dans le fil d'activité de toutes les zones. Le bandeau d'avertissement et l'activité de zone affichent maintenant le nom de l'équipement associé à côté du device, et l'alerte est rattachée à la zone de l'équipement. Contribué par Adrien Jouve (computingify). (spec 143, #472, #473)
- Interne (api) : **les corps de requête sont désormais validés par des schémas déclaratifs sur la plupart des routes API**. Les vérifications écrites à la main et dupliquées dans les handlers ont été remplacées par des schémas JSON Fastify, offrant une frontière de validation cohérente et une forme unique `{ error }` pour les réponses 400. Les routes, méthodes et codes de statut sont inchangés ; seul le libellé des messages d'erreur de validation change. Les routes qui contrôlent l'authentification ou l'existence d'une ressource dans le handler conservent leurs vérifications actuelles pour l'instant (suivi dans #482). (#452, #475, #476, #477, #478, #479, #480)
- Interne (api) : **une description OpenAPI 3 de l'API est maintenant générée à partir de ces schémas**, servie en JSON sur `/api/v1/openapi.json` pour les utilisateurs authentifiés. Aucune interface de documentation interactive n'est montée. (#452, #481)

## 1.43.x: Alertes batterie faible et contrôles du graphe Analyse

### v1.43.0 — 2026-08-12 { #v1-43-0 }

- Feat (devices): **alertes de batterie faible pour les appareils sur pile**. Un capteur sur pile pouvait tomber à plat en silence : la spec 116 considère le silence radio des équipements à pile événementiels comme normal, donc une pile morte restait affichée en ligne pendant que le pourcentage bas dormait, non lu. Sowel surveille désormais le niveau de batterie de chaque appareil sur pile, lève une alerte système à 20% ou moins (levée à nouveau à 25%), rappelle une fois par semaine tant que le niveau reste bas, et résout l'alerte au remplacement de la pile. La carte d'équipement affiche un indicateur de batterie à côté de ses valeurs. Les appareils sont détectés automatiquement, et précisément dès que le plugin Zigbee2MQTT 2.5.0 déclare la source d'alimentation de chaque appareil. À cette occasion, les alarmes système (batterie, ordres non confirmés, erreurs d'intégration) atteignent maintenant tous les publishers de notification activés au lieu du seul premier Telegram, si bien qu'une installation en web-push seul les reçoit aussi. Contribué par Adrien Jouve (computingify). (spec 143, #444)
- Feat (ui): **couleurs par série et axes Y ajustés sur le graphe Analyse**. Trois choses échappaient au contrôle sur un graphe Analyse. Les couleurs suivaient l'ordre d'ajout sans rien de sauvegardé, si bien que retirer une série recolorait les autres ; chaque série ouvre désormais un sélecteur de couleur et le choix est sauvegardé. Un axe de mesure était ancré à zéro, donc une température de ballon entre 48 et 55 degrés se lisait comme une ligne plate en haut ; une bascule ajuste maintenant chaque axe de mesure à sa propre plage. Et toutes les mesures partageaient une seule échelle ; un graphe traçant exactement deux quantités obtient désormais un axe chacune, à gauche et à droite, groupées par unité. Les deux réglages sont optionnels, donc un graphe sauvegardé avant ce changement garde l'ordre de la palette et l'axe ancré à zéro, sauf qu'un graphe existant traçant exactement deux quantités d'unités différentes s'ouvrira désormais avec des axes gauche et droite séparés. Contribué par Adrien Jouve (computingify). (spec 145, #446)
- Interne : couverture de tests automatisés élargie (le UserManager, plusieurs modules backend jusque-là non testés, et les stores UI useAuth et useWebSocket), un nettoyage des gardes de démarrage du mode ombre et du client API UI, plus un nouveau garde-fou CI et des documents de conception complétés pour les dossiers de spec. Aucun changement visible. (#459, #461, #462, #463, #464, #465, #466, #467, #468)

## 1.42.x: Historique des états et navigation plus claire

### v1.42.0 — 2026-08-12 { #v1-42-0 }

- Feat (ui): **les états des équipements apparaissent enfin dans l'historique, à côté des mesures**. Le retour d'état marche/arrêt d'un actionneur (un relais, une pompe, un interrupteur) était enregistré mais jamais tracé, car seules les séries numériques l'étaient. Les valeurs d'état sont désormais stockées aussi sous forme numérique : la page Analyse peut tracer une courbe de température et le relais qui la pilote sur un même graphe, le relais sur son propre axe 0/1 à droite. Les volets, portails et serrures à plus de deux valeurs se tracent en série numérique simple. L'historisation des états est côté cœur ; l'axe mixte d'Analyse a été contribué par Adrien Jouve (computingify). (spec 144, #434, #442)
- Feat (ui): **les recettes peuvent afficher une ligne de statut en direct sur leur carte**. Une recette peut résumer en une ligne ce qu'elle fait, par exemple une pompe de piscine affichant « Filtration 2,1/9,6 h, heures creuses » au lieu que ce contexte vive uniquement dans le journal de la recette. (#431)
- Feat (ui): **les chemins de zone sont affichés dans tous les menus et libellés de zone**. Deux pièces de même nom (une « Salle de bain » à chaque étage) étaient indiscernables dans la plupart des sélecteurs ; chaque zone porte désormais son chemin de désambiguïsation partout. Contribué par Adrien Jouve (computingify). (spec 139, #433)
- Fix (ui): **la vue énergie est atteignable juste après minuit local**. « Aujourd'hui » était calculé en UTC, donc pendant les premières heures après minuit (jusqu'à 02:00 l'été) le jour courant était traité comme futur et ses données inaccessibles. Le jour calendaire local est désormais utilisé. (#432)
- Fix (equipments): **les appareils qui reportent à la variation ne clignotent plus entre online et degraded**. Une prise avec mesure ne remonte sa puissance qu'au changement : une charge stable cesse de mettre à jour et la fenêtre de fraîcheur serrée basculait l'équipement en degraded à chaque cycle (180 changements de statut en une heure sur une installation). La puissance, le courant et la tension qui arrivent en bonus sur un équipement non-compteur sont désormais exemptés de cette fenêtre ; les vrais compteurs restent dégradés en cas de silence réel. Contribué par Adrien Jouve (computingify). (spec 116, #440)

---

## 1.41.x: Précision des mesures et alarmes acquittables

### v1.41.0 — 2026-08-12 { #v1-41-0 }

- Feat (ui) : **les alarmes du bandeau peuvent désormais être acquittées**. Une alarme dont la condition persiste (une prise laissée débranchée, un plugin qui reste hors ligne) restait dans la pastille d'alarme de l'en-tête sans aucun moyen de l'effacer. Chaque alarme dispose maintenant d'une action d'acquittement dans la feuille des alarmes ; les alarmes acquittées passent dans une section grisée d'où l'on peut les réafficher, et la pastille de l'en-tête ne compte plus que celles qui ne sont pas acquittées. L'acquittement est mémorisé dans votre navigateur et lié à l'alarme précise, donc la même reste masquée après un rechargement tandis qu'un problème réellement nouveau réapparaît. L'icône de la pastille est désormais un octogone pour les erreurs et un triangle pour les avertissements, cohérente avec la feuille. (#424)
- Fix (energy) : **l'énergie n'est plus perdue sur les compteurs qui rapportent plusieurs fois par minute**. Un tick d'énergie temps réel porte les wattheures accumulés depuis le précédent, mais la déduplication générique le traitait comme un échantillon et en écartait la plupart, si bien qu'un compteur bavard (le Tuya PJ-1203A publie une trentaine de ticks par minute) voyait sa production plaquée à zéro et laissait le graphe Production vide. Les ticks sont désormais cumulés en un point par minute, la série d'énergie réseau a un écrivain unique pour supprimer une double écriture, et le découpage HP/HC est calculé sur la vraie fenêtre d'une minute au lieu de trente, donc l'énergie n'est plus étalée de part et d'autre d'une bascule tarifaire. L'historique passé n'est pas reconstruit ; les chiffres sont justes à partir de cette version. Contribution d'Adrien Jouve (computingify). (#415)
- Fix (equipments) : **les équipements reposant sur un état marche/arrêt ne sont plus signalés « dégradés » alors qu'ils sont en ligne**. Un binding power booléen (Panasonic Comfort Cloud, une TV, un lave-linge) se rafraîchit au rythme propre de l'intégration, souvent plus lent que la fenêtre de streaming de deux minutes, si bien qu'un état marche/arrêt stable était lu comme périmé et faisait basculer tout l'équipement en dégradé alors que l'appareil était en ligne et interrogé. Les états booléens sont désormais exemptés de la péremption de streaming ; les lectures numériques temps réel (Shelly, pinces Legrand) continuent de se dégrader sur un vrai silence. (#422)
- Chore (registry) : pool-pump-schedule passe en 1.2.0 ; smart-cooling en 1.4.0. (#427)

---

## 1.40.x: Réglages énergie et résilience de l'Activité

### v1.40.0 — 2026-08-11 { #v1-40-0 }

- Feat (ui) : **les réglages d'énergie ont désormais leur propre onglet**. La grille tarifaire et l'arbitre de surplus quittent Réglages > Administration, où ils voisinaient avec la gestion des utilisateurs, pour un onglet dédié **Réglages > Énergie**, rassemblant tout ce qui touche à l'énergie. Chaque seuil avancé de l'arbitre gagne une bulle d'aide au survol expliquant son rôle et son unité, pour qu'ils ne soient plus des nombres opaques. (#418)
- Fix (energy) : l'arbitre de surplus **ne prend plus une réémission d'ordre pour une commande manuelle**. Quand l'appareil d'une charge pilotable passait hors ligne puis revenait avec un ordre non confirmé, Sowel réémettait cet ordre (le renvoi de confirmation de livraison de la v1.39.0) et l'arbitre y voyait une prise de main humaine, se suspendant deux heures. Il ignore désormais son propre canal de réémission, donc une charge Zigbee instable n'affiche plus un « Manuel jusqu'à ... » injustifié sur son panneau énergie. (#420)
- Fix (ui) : le **panneau Activité se remet des échecs de chargement passagers** au lieu de rester bloqué sur « Impossible de charger l'activité » jusqu'à ce qu'on quitte la zone et y revienne. Il réessaie, propose un bouton Réessayer, recharge à la reconnexion WebSocket, et ne laisse plus une requête périmée écraser un résultat plus récent. Les rafales de rechargement WebSocket qui pouvaient épuiser la limite de requêtes (un rechargement complet par événement de recette ou d'équipement) sont regroupées, et les requêtes GET réessaient une fois sur une réponse de dépassement de limite. Contribution d'Adrien Jouve (computingify). (#413)

---

## 1.39.x: Arbitrage du surplus énergie

### v1.39.1 — 2026-08-11 { #v1-39-1 }

- Fix (ui) : plusieurs correctifs de l'interface de l'arbitre de surplus livrée en v1.39.0. L'**interrupteur d'activation apparaît désormais dès que vous avez un compteur principal** (réseau) au lieu d'exiger un compteur de production séparé, pour qu'une maison dont le solaire apparaît en injection réseau puisse réellement l'activer. La **liste de priorité est maintenant respectée telle qu'affichée** (une charge nouvellement déclarée pouvait être ignorée jusqu'à un réordonnancement). Déclarer une charge pilotable ne mène plus à une impasse : les champs classe et puissance apparaissent en cochant la case, avec une explication de Différable vs Confort, un bouton Enregistrer explicite et une confirmation avant suppression. Les seuils avancés ne peuvent plus être vidés vers une valeur qui désactive l'arbitre en silence, le badge « Manuel jusqu'à » apparaît en temps réel, et plusieurs points d'accessibilité et de formulation ont été corrigés. (#416)

### v1.39.0 — 2026-08-11 { #v1-39-0 }

- Feat (energy) : **l'arbitre de surplus énergie** (spec 140). Un arbitre central distribue le surplus solaire à vos charges pilotables dans l'ordre de priorité que vous choisissez, mettant fin au bras de fer où plusieurs automatisations conscientes du surplus s'allument chacune en voyant de l'injection, dépassent ensemble, puis l'effondrent. Déclarez une charge pilotable (pompe de piscine, chauffe-eau, etc.) sur sa fiche d'équipement (classe, puissance nominale, marche/arrêt minimum, pré-remplis depuis le type et sa propre mesure), activez l'arbitre dans Réglages > Administration > Énergie, et ordonnez vos charges. Énergie > En direct gagne une surface d'arbitrage : une barre d'allocation de là où va la production en ce moment, une frise du jour par charge, et un journal des décisions en langage clair. **Opt-in et désactivé par défaut**, et l'arbitre n'émet aucun ordre lui-même. C'est la fondation contre laquelle les recettes conscientes du surplus réclament de la capacité (`ctx.helpers.energy`) ; les recettes qui l'utilisent arrivent ensuite, donc sur cette version l'arbitre est là pour être activé et observé. Durci par deux passes de revue adversariale indépendantes avant le merge. (#412)
- Feat (equipments) : **confirmation de livraison d'ordre** (spec 141). Un ordre envoyé avec succès ne prouvait que son arrivée à l'intégration, pas au device : un OFF de pompe de piscine envoyé pendant une fenêtre hors ligne de 104 secondes a un jour laissé la pompe tourner 15,5 h sans que rien ne le signale (issue #398). Les ordres confirmables sont désormais surveillés pour que la valeur commandée apparaisse réellement sous 30 s (verdict immédiat quand tous les devices cibles sont hors ligne) ; sinon, Sowel lève une alarme d'avertissement (transmise en notification push) et renvoie l'ordre une fois quand le device revient dans l'heure. (#404)
- Feat (core) : **garde-fou données restaurées**. Une base restaurée depuis un autre déploiement porte les brokers MQTT et canaux de ce déploiement ; une instance pleinement armée sur ces données se bat contre l'originale. Une instance restaurée démarre désormais inerte jusqu'à ce que vous confirmiez la reprise, pour que les deux ne se disputent jamais les mêmes devices. (#405)
- Fix (mqtt) : chaque processus utilise un **client id de publisher MQTT unique** (suffixe aléatoire par connexion) et limite les avertissements de reconnexion, pour qu'une instance de dev sur une copie d'une base de production ne mette plus l'originale dehors en boucle. (#402)
- Fix (logging) : les fichiers de log quotidiens sont **datés et conservés à travers la recréation du conteneur**, et les fichiers de log au format pré-daté laissés par les anciennes versions sont purgés automatiquement au démarrage. (#403, #408)
- Fix (ui) : la liste des équipements **regroupe par identité de zone, pas par nom de zone** (deux pièces au même nom ne fusionnent plus), et le badge des plugins communautaires affiche une icône Utilisateurs plutôt qu'un triangle d'avertissement. (#406, #411)
- Chore (registry) : Zigbee2MQTT passé à 2.4.0 ; pool-pump-schedule à 1.1.0 ; netatmo_weather à 2.1.0. (#397, #409)
- Docs : les règles de configuration multi-coordinateurs Zigbee sont reportées dans les pages device et prise en main qui couvrent déjà Zigbee ; nouvelle documentation utilisateur et développeur pour l'arbitre de surplus. (#407)

---

## 1.38.x: Plusieurs coordinateurs Zigbee

### v1.38.0 — 2026-08-10 { #v1-38-0 }

- Feat (settings) : **une instance Sowel peut désormais servir plusieurs coordinateurs Zigbee** (grande maison, dépendance hors de portée radio, limite d'appareils du coordinateur). Zigbee2MQTT pilote un coordinateur par instance : le réglage `base_topic` de l'intégration Zigbee2MQTT accepte donc une liste séparée par des virgules, une entrée par instance Z2M sur le broker MQTT partagé. Le core expose la liste au plugin, et une nouvelle section **« Plusieurs coordinateurs Zigbee »** du guide de préparation de l'hôte détaille toute la mise en place : un conteneur par coordinateur, les différences de configuration, et pourquoi les base topics et les canaux Zigbee doivent différer. Fonctionne avec le plugin Zigbee2MQTT **2.4.0**, qui requiert cette version. Contribution d'Adrien Jouve (computingify). (#395)
- Fix (ui) : les sélecteurs des recettes **choisissent automatiquement une zone qui ne contient qu'un seul candidat** au lieu de laisser un menu à option unique, et les puces récapitulant un slot de liste d'équipements affichent zone puis équipement, dans l'ordre des contrôles qui les ont produites. Le prédicat de filtrage des candidats, écrit quatre fois en ligne, devient un helper unique et testé. (#390, #393)
- Fix (packages) : le badge de mise à jour **ne propose plus une version que vous avez déjà sautée**. Les installations par source personnelle téléchargent la dernière release en direct, mais le badge lisait un cache d'une heure que rien n'invalidait après une installation : sautez une version, installez la suivante, et l'interface continuait de proposer un retour en arrière. Le cache est désormais invalidé après chaque installation ou mise à jour personnelle, et une version en cache plus ancienne que celle installée n'est jamais présentée comme une mise à jour. (#391)

---

## 1.37.x: Tarif HP/HC pour les recettes

### v1.37.1 — 2026-08-10 { #v1-37-1 }

- Fix (ui) : les **sélecteurs d'équipements et de zones des recettes précisent désormais la zone**, pour distinguer les pièces et capteurs homonymes (spec 139). Une installation avec une salle de bain par étage listait « Salle de bain » plusieurs fois sans rien pour choisir, et les listes d'équipements affichaient le nom nu (les intégrations nomment tous les capteurs « Température »). Chaque option porte maintenant le plus court chemin d'ancêtres qui la rend unique, et le même helper nettoie les libellés de la vue Analyse. Contribution d'Adrien Jouve (computingify). (#386)
- Fix (ui) : la **page Tarifs énergie n'affiche plus ses horaires par défaut comme s'ils étaient enregistrés** (#384). Sur une instance qui n'a jamais enregistré de tarif, le planning standard 06:00-22:00 HP / 22:00-06:00 HC semblait configuré alors qu'il ne l'était pas, faisant paraître cassées l'attribution des coûts et les recettes de délestage. Le formulaire propose toujours ces horaires par commodité, mais une bannière les signale comme une suggestion tant que vous n'avez pas cliqué sur Enregistrer. Signalé par Adrien Jouve (computingify). (#388)

### v1.37.0 — 2026-08-09 { #v1-37-0 }

- Feat (recipes) : **les recettes peuvent lire le planning tarifaire HP/HC configuré** (spec 138). Une recette de délestage (chauffe-eau, pompe de piscine, recharge VE) n'a plus à redemander des heures creuses que l'instance connaît déjà : `ctx.helpers.getTariff()` retourne les créneaux heures creuses du jour et si l'heure courante est en heures creuses, directement depuis le planning configuré dans les Réglages. Lecture seule par construction, et les **prix ne sont volontairement pas exposés** aux packages de recettes — savoir quand l'énergie est bon marché suffit pour placer une charge. Les recettes gardent leurs propres créneaux en repli pour les instances sans tarif configuré. Contribution d'Adrien Jouve (computingify). (#379)
- Fix (api) : la lecture de la configuration tarifaire via l'API (`GET /api/v1/settings/energy/tariff`) exige désormais le **rôle admin**, comme le reste des réglages. Tout utilisateur authentifié pouvait auparavant lire le planning et les prix ; l'écriture était déjà réservée aux admins, et les recettes ne sont pas concernées puisqu'elles lisent via le nouveau helper. Découvert pendant la revue de la #379. (#382)
- Docs : rattrapage de l'index des specs (specs 137/138) et traduction française de la nouvelle documentation tarifaire des recettes. (#380)

---

## 1.36.x: Catégories de plugins, recherche, mesures électriques live

### v1.36.0 — 2026-08-09 { #v1-36-0 }

- Feat (plugins) : la page Plugins **regroupe désormais les recettes par catégorie** (spec 137) — Éclairage, Chauffage et climatisation, Arrosage et piscine, Planification, Sécurité et surveillance, Énergie et affichage — dans les onglets Installés et Store, avec un **champ de recherche** qui filtre intégrations et recettes au fil de la saisie, en cherchant dans les noms, descriptions et mots-clés dans la langue affichée, accents ignorés. L'onglet Store affiche aussi enfin les noms et descriptions en français déjà écrits dans le catalogue (ils étaient perdus en route jusqu'ici). Les catégories viennent du catalogue de plugins : les installations existantes les récupèrent automatiquement, aucune mise à jour de recette nécessaire. (#375)
- Feat (equipments) : **données électriques live sur les compteurs d'énergie** — la carte en vue zone de chaque type de compteur (consommation, principal, production) affiche désormais la puissance instantanée en direct à côté de la consommation du jour, que le compteur remonte une puissance directe ou une demande 5 minutes Legrand NLPC. La page de détail gagne un panneau **Mesures électriques** avec des tuiles live puissance, tension, courant et facteur de puissance, chacune affichée quand la donnée correspondante est associée ; le panneau « Consommation énergie » est inchangé. (#377)
- Feat (ui) : le tiroir **« Plus » sur mobile** expose désormais la navigation Administration complète (Appareils, Équipements, Zones, Plugins, Logs, Sauvegarde, ...) depuis une source unique partagée avec la barre latérale desktop, badge de mise à jour des plugins compris. Les utilisateurs non admin retrouvent les pages de consultation (Équipements, Zones) dans la section principale. Auparavant, seuls Réglages, Analyse et quatre entrées admin étaient accessibles sur mobile. (#374)
- Docs : nouvelle page **guide utilisateur Plugins** sur docs.sowel.org — les deux onglets, trouver un plugin, les niveaux de confiance, les sources personnelles et la confirmation par empreinte. (#371)
- Chore (core) : le contexte d'exploitation propre à une installation quitte le dépôt public pour un dépôt compagnon privé ; nouveau skill agent pour le développement de recettes personnelles ; index des specs mis à jour. (#368, #370, #372)

---

## 1.35.x: Sources personnelles de plugins

### v1.35.0 — 2026-08-08 { #v1-35-0 }

- Feat (plugins) : **sources personnelles de plugins** (spec 136). Ajoutez vos propres dépôts GitHub publics comme sources de plugins et installez vos propres intégrations et recettes sans passer par le registre central, ni pour la première publication ni pour les montées de version. Un troisième niveau de confiance apparaît à côté d'officiel et communautaire : les entrées personnelles portent un badge bleu **Perso**, et la confiance suit un modèle « au premier usage ». Sowel télécharge le tarball de la release, affiche sa version et son empreinte SHA256 dans une boîte de confirmation, puis épingle le hash ; tout changement de contenu ultérieur (mises à jour comprises) redemande confirmation avec la nouvelle empreinte, et les restaurations de sauvegarde vérifient les retéléchargements contre le hash épinglé. Le chemin d'installation du registre est inchangé, et les paquets personnels ont des gardes supplémentaires : le dépôt du manifest doit correspondre à la source, et un id de plugin ne peut pas masquer une entrée du registre. Tout se gère depuis la nouvelle section « Sources personnelles » de la page Plugins. (#367)
- Chore (registry) : **plugin Zigbee2MQTT 2.3.1** : les topics de disponibilité par appareil sont désormais ignorés quand la fonction availability de Z2M est désactivée ; les messages retained périmés laissés sur le broker ne marquent plus des appareils fonctionnels hors ligne à chaque démarrage ou reconnexion. (#365)
- Chore (registry) : **recette Schedule On/Off 2.0.1** : les équipements chauffe-eau (introduits en v1.34.0) sont désormais sélectionnables dans le slot équipements de la recette. (#366)

---

## 1.34.x: Équipement chauffe-eau

### v1.34.0 — 2026-08-08 { #v1-34-0 }

- Feat (equipments) : nouveau type d'équipement **chauffe-eau** (spec 135). Commande ON/OFF via le canal on/off standard (les relais Zigbee comme le Tuya WHD02 fonctionnent directement), affichage optionnel de la **température de l'eau** liée sous son propre alias pour ne jamais fausser la moyenne de température de la zone, et affichage automatique puissance/énergie quand le relais mesure la consommation (comme les prises avec mesure). Créer un chauffe-eau depuis un relais lie tout automatiquement, et une icône dédiée indique quand il chauffe. Support complet du dashboard PC et mobile. (#359)
- Fix (equipments) : les commandes on/off booléennes envoyées aux relais Zigbee via l'API REST ou par les automatisations étaient **silencieusement ignorées** : l'appel répondait succès, mais Zigbee2MQTT rejetait le message car les interrupteurs binaires attendent leur forme déclarée (`"ON"`/`"OFF"`), pas un booléen JSON. Les intégrations peuvent désormais déclarer la représentation « fil » d'un ordre booléen à la découverte, et Sowel traduit la valeur à l'envoi : `true` devient `"ON"`, ou `"LOCK"`, ou ce que l'appareil déclare. Fonctionne avec le plugin Zigbee2MQTT v2.3.0, qui déclare ces valeurs ; les ordres qui ne les déclarent pas sont envoyés exactement comme avant. (#360, #362)
- Fix (equipments) : les modules relais exposant le on/off comme ordre booléen (Tuya WHD02 et similaires) ne pouvaient pas être associés à un équipement **lumière ou pompe de piscine** : la règle de candidats n'acceptait que les enums ON/OFF pour ces types, alors que le même relais se liait sans problème à un interrupteur. Les deux acceptent désormais les ordres on/off booléens, alignés sur la règle des interrupteurs. (#358)
- Chore (registry) : ajout du plugin communautaire **caméra Netatmo** 1.0.0 (Netatmo Presence : instantané, vue en direct, surveillance on/off, projecteur, détections de mouvement), qui se lie au type d'équipement caméra introduit en v1.31.0. Par Romain (alpitux). (#356)
- Chore (registry) : **plugin Zigbee2MQTT 2.3.0** : le compteur d'énergie bidirectionnel double pince Tuya PJ-1203A arrive désormais comme un appareil par voie alimentant la chaîne énergie (deltas d'énergie signés, même forme que le Shelly Pro 3EM), contribution d'Adrien Jouve (computingify) ; plus le correctif de liaison des relais Tuya et les déclarations de valeurs « fil » utilisées par le correctif d'ordres ci-dessus. (#357, #363)

---

## 1.33.x: Corrections de fiabilité

### v1.33.0 — 2026-08-07 { #v1-33-0 }

- Fix (equipments) : les télécommandes et boutons sans fil à pile ne sont plus affichés « **Déconnecté** » simplement parce qu'ils sont restés silencieux. Ces appareils n'émettent qu'à l'appui : le silence est normal, le badge rouge était un faux positif (et il apprenait à ignorer les badges rouges, masquant les vraies déconnexions). Ils restent désormais en ligne ; une pile réellement faible reste signalée par la donnée de batterie. Valable pour toutes les intégrations (Zigbee, LoRa, ...). (#348)
- Fix (recipes) : mettre à jour une recette depuis le store redémarre désormais immédiatement ses automatisations en cours. Avant, la nouvelle version était chargée et visible dans le formulaire, mais les instances actives continuaient d'exécuter l'ancienne logique jusqu'à un désactiver/réactiver manuel — un piège silencieux. (#349)
- Fix (plugins) : le bouton **Rafraîchir** de la page Plugins affiche désormais un changement de catalogue tout juste publié en quelques secondes au lieu d'attendre plusieurs minutes. Il interrogeait une copie en cache qu'il ne pouvait pas contourner ; il lit maintenant la source à jour directement. (#353)

---

## 1.32.x: Min/max météo du jour

### v1.32.0 — 2026-08-05 { #v1-32-0 }

- Feat (equipments) : les équipements station météo affichent désormais **les températures minimale et maximale mesurées aujourd'hui**, en petit sous chaque température — sur le widget du dashboard (PC et mobile) et sur la page de détail de l'équipement (modules extérieur et intérieur). Sowel calcule lui-même cette enveloppe à partir des mesures qu'il reçoit déjà : cela fonctionne avec toute station qui remonte une température, sans configuration et quel que soit le fabricant. L'enveloppe se remet à zéro à minuit local et survit aux redémarrages. À noter le premier jour après la mise à jour : le min/max démarre au moment de la mise à jour, il devient exact dès le lendemain. (#344)

---

## 1.31.x: Équipement caméra

### v1.31.1 — 2026-08-05 { #v1-31-1 }

- Fix (notifications) : une notification associée à une source on/off (typiquement l'alarme d'une recette) envoyait son message sur les deux transitions, si bien qu'un texte fixe comme « Machine à laver terminée » partait aussi au moment où l'alarme se résolvait — pour une surveillance de l'état repos, c'est précisément le démarrage d'un cycle. Ces notifications ne partent désormais qu'à l'activation de la source ; les notifications associées à des textes d'état (par ex. un nom de mode) ou à des valeurs numériques sont inchangées. (#342)

### v1.31.0 — 2026-08-05 { #v1-31-0 }

- Feat (equipments) : nouveau type d'équipement **caméra**, indépendant du fabricant (spec 133). Un équipement caméra affiche un instantané rafraîchi périodiquement (page de détail et widget dashboard) et une vue en direct à la demande (HLS), plus, quand l'intégration les expose, des commandes de surveillance on/off, de mode d'éclairage et de sirène. Les médias transitent par le backend Sowel : le navigateur ne parle jamais directement à la caméra ou au relais du fabricant, et l'URL réelle de la caméra n'est jamais exposée. Chaque fonction s'active simplement en liant sa catégorie de donnée ou d'ordre, avec contrôle côté serveur. Aucune intégration caméra n'est incluse dans le cœur : ce sont les plugins qui fournissent les appareils (un plugin communautaire pour les caméras Netatmo est en préparation). Limitation connue : la vue en direct n'est pas encore disponible sur Safari iOS (l'instantané fonctionne partout). Contribution de Romain (alpitux). (#339)
- Fix (ui) : la règle du service worker censée garder les appels API en réseau seul ne s'appliquait en réalité jamais, le motif étant testé contre l'URL complète au lieu du chemin. Aucun impact utilisateur connu, corrigé par rigueur. (#339)
- Chore (plugins) : l'ancien plugin Netatmo Security (surveillance on/off uniquement) est retiré du store, remplacé par le type d'équipement caméra et le futur plugin caméra Netatmo. Les instances qui l'ont déjà installé continuent de l'utiliser ; il n'est simplement plus listé ni mis à jour. (#340)

---

## 1.30.x: Comptage triphasé

### v1.30.0 — 2026-07-31 { #v1-30-0 }

- Feat (energy) : la page Énergie → Live peut désormais afficher la répartition de puissance par phase pour les installations triphasées. Un équipement compteur principal peut porter des liaisons de données `power_l1` / `power_l2` / `power_l3` (une convention que toute intégration exposant la puissance par phase peut adopter), et dès que deux phases au moins sont liées, un panneau « Répartition par phase » affiche une barre par phase sous le diagramme de flux, ce qui rend visible d'un coup d'œil une phase déséquilibrée. Les installations monophasées ne sont pas concernées : sans ces liaisons, le panneau n'existe pas. Fonctionne avec le plugin Legrand Energy v2.1.0, qui découvre maintenant les compteurs triphasés Legrand Drivia with Netatmo (modules NLY, réf. 412175) sous forme d'un appareil « Total » plus un appareil par phase. Contribution de Romain (alpitux). (#336, legrand-energy #1)

---

## 1.29.x: Rôle Standard et parité du dashboard

### v1.29.4 — 2026-07-26 { #v1-29-4 }

- Fix (ui) : le tooltip du graphe de pluie affichait la mauvaise barre en vue 7 jours. Une fenêtre de 7 jours affiche 8 barres quotidiennes, donc le jour de semaine servant de clé se répétait et survoler une barre pouvait montrer la valeur d'un autre jour (ex. survoler la barre ~1 mm d'aujourd'hui affichait « dimanche 19 / 0 mm »). Les barres sont désormais indexées sur leur horodatage. (#334)
- Fix (history) : les totaux de pluie tombaient à ~0 mm en vue 30 jours. La pluie est un cumul, mais l'historique journalier ne stockait que la moyenne (environ le total divisé par 24). Le total journalier est maintenant sommé à partir des données horaires, donc la vue 30 jours affiche les vrais totaux, cohérents avec les vues 24h et 7 jours (déjà correctes). (#334)

### v1.29.3 — 2026-07-21 { #v1-29-3 }

- Fix (ui) : les commandes groupées « Arrêter tous les volets » / « Arrêter tous les stores » (barre de zone, maison entière, widget de zone du tableau de bord et sa feuille de détail, et le sélecteur d'action bouton) sont désormais masquées quand un volet du périmètre ne peut pas réellement s'arrêter en cours de course (ex. Bubendorff via iDiamant). Cela étend le correctif volet unique de la v1.29.2 aux commandes de groupe, qui agissent sur tout le sous-arbre de la zone. Les groupes dont tous les volets gèrent le Stop ne changent pas. (#332)

### v1.29.2 — 2026-07-20 { #v1-29-2 }

- Fix (ui) : le bouton Stop d'un volet est désormais masqué quand le pont ne peut pas réellement arrêter le moteur en cours de course. Certains ponts (confirmé sur des volets Bubendorff via un pont iDiamant with Netatmo) ne font qu'une brève pause avant de repartir vers la cible initiale ; un bouton Stop y était donc trompeur. Une intégration le signale en omettant « STOP » de l'ordre de mouvement ; les volets qui gardent un vrai Stop ne changent pas. (#327)
- Fix (equipments) : l'auto-liaison d'un volet fonctionne maintenant pour les intégrations qui n'utilisent pas les noms de clés à la Tasmota. Ajouter un volet dont l'appareil expose current_position / target_position / state (ex. Legrand / Bubendorff Home+Control) créait un équipement sans aucune liaison, affiché hors ligne ; une bascule basée sur la catégorie le lie désormais correctement. (#327)

### v1.29.1 — 2026-07-19 { #v1-29-1 }

- Fix (auth) : suite du rôle Standard de la v1.29.0. Un compte Standard pouvait encore voir des contrôles de configuration que le serveur refuse avec un 403 (Modifier / Supprimer sur un équipement, le panneau Configuration d'un équipement, l'activation d'un mode, la sauvegarde / suppression de graphe, la pastille de mise à jour). Ils sont désormais masqués, et les pages purement de configuration (appareils, calendrier, intégrations, plugins, publishers MQTT / notifications, logs, sauvegarde) redirigent un compte Standard vers le tableau de bord. Le pilotage (lumières, portails, volets, commandes de zone) et les réglages personnels (profil, mot de passe, jetons API) ne changent pas. (#319)

### v1.29.0 — 2026-07-19 { #v1-29-0 }

- Feat (auth) : le rôle **Standard** est désormais limité à la consultation et au pilotage. Un utilisateur Standard peut parcourir le dashboard et les zones, voir l'état des équipements et actionner les équipements (ouvrir un portail ou une porte, allumer une lumière), mais ne peut plus créer, renommer ou supprimer d'équipements, de recettes, de zones ou de modes, ni modifier la moindre configuration. Toute la configuration est maintenant réservée aux administrateurs, masquée dans l'UI et bloquée côté serveur (une action interdite renvoie 403, donc impossible à contourner). Cela répond à la surprise qu'un compte Standard puisse modifier des équipements et des recettes par accident. Aucune migration nécessaire : les comptes Standard existants perdent simplement les actions de configuration qu'ils n'auraient pas dû avoir. (#319)
- Fix (ui) : l'icône personnalisée d'un widget s'affiche désormais à l'identique sur navigateur PC et sur mobile. Le dashboard desktop ignorait l'icône personnalisée pour la plupart des types de widgets (une icône de pompe de piscine choisie pour une prise s'affichait sous Android mais repassait à l'icône de prise sur PC) ; il respecte maintenant l'icône choisie pour les lumières, prises, volets, stores, thermostats, chauffages, vannes d'eau et équipements de piscine, comme sur mobile. (#318)

---

## 1.28.x: Arrosage par jour

### v1.28.2 — 2026-07-18 { #v1-28-2 }

- Fix (ui) : sur le dashboard mobile, un capteur de contact (porte/fenêtre) modélisé en **Capteur** affiche désormais « Ouvert / Fermé » au lieu d'un simple « Oui / Non ». La carte widget mobile formatait les booléens de façon générique ; elle utilise maintenant les mêmes libellés selon la catégorie que la carte desktop et la vue zone (corrige aussi mouvement / fuite d'eau / fumée sur mobile). À noter : une porte/portail motorisé se modélise plutôt en **Ouvrant**, qui dérive déjà ouvert/fermé depuis un contact et s'affiche correctement partout. (#316)

### v1.28.1 — 2026-07-18 { #v1-28-1 }

- Fix (météo) : les cumuls de pluie pouvaient exploser (ex. 1392 mm sur 24h pour 11,9 mm réels), ce qui bloquait en permanence le saut de pluie de l'Arrosage Auto et affichait un plateau « 11,9 mm chaque heure » sur les graphes. Les cumuls roulants 1h / 24h de Netatmo (`sum_rain_1` / `sum_rain_24`) étaient sommés à chaque interrogation. Sowel les lit désormais comme les totaux qu'ils sont déjà, et ne les stocke plus comme séries temporelles. Les valeurs live ne changent pas ; les graphes de pluie existants se corrigent d'eux-mêmes sous ~24h. (#312)

### v1.28.0 — 2026-07-17 { #v1-28-0 }

- Feat (recettes) : les formulaires de recette gèrent désormais les champs à choix multiple, affichés en pastilles plutôt qu'en simple liste déroulante. Cela apporte un nouveau sélecteur de **jours de la semaine** par créneau dans la recette Arrosage Auto (mettez la recette à jour en v1.2.0) : chaque créneau d'arrosage peut être limité à certains jours, et le laisser vide continue d'arroser tous les jours. Exemple : arroser à 07h30 les jours d'école et à 09h00 le mercredi et le week-end. Les planifications d'arrosage existantes ne changent pas. (#310, auto-watering #2)

---

## 1.27.x: Prise avec métrologie

### v1.27.1 — 2026-07-10 { #v1-27-1 }

- Fix (équipements) : créer un Interrupteur / Prise sur un appareil à métrologie (ex. SONOFF S60ZBTPF) binde désormais sa puissance/énergie, pas seulement le canal on/off. La v1.27.0 apportait l'affichage mais l'étape de binding oubliait la métrologie. Note : les prises bindées avant ce correctif gardent leur binding on/off seul ; recréez-les ou re-bindez-les pour récupérer puissance/énergie. (#302)

### v1.27.0 — 2026-07-10 { #v1-27-0 }

- Feat (équipements) : un Interrupteur / Prise remonte désormais la puissance et l'énergie quand l'appareil les fournit. Une prise connectée à métrologie (ex. SONOFF S60ZBTPF en Zigbee2MQTT) modélisée en Interrupteur affiche sa puissance instantanée à côté du bouton on/off, alimente le tableau de bord énergie (historique et HP/HC) et apparaît dans la répartition live par équipement, tout en gardant sa commande marche/arrêt. Un relais basique sans métrologie ne change pas. (#300)

---

## 1.26.x: Re-notification

### v1.26.0 — 2026-07-07 { #v1-26-0 }

- Feat (notifications) : les mappings de notification gagnent une option de re-notification explicite. Tant qu'une valeur mappée reste « active » (ex. l'alarme d'une surveillance d'état), la notification est renvoyée à intervalle régulier et s'arrête en silence une fois résolue. Choix par mapping : « Aucune », « Indéfiniment » ou « Limité à N rappels » — distinct de l'anti-spam. (#294)

---

## 1.25.x: Éditeur de mappings de notification

### v1.25.0 — 2026-07-01 { #v1-25-0 }

- Fix (ui) : l'éditeur de mappings de notification restaure le filtre de zone à la ré-édition. Une recette ou un équipement choisi dans une zone précise (ex. un State Watch dans la cave) n'affiche plus « toutes les zones » avec une liste de sources non filtrée. (#291)
- Feat (ui) : la liste déroulante des recettes affiche désormais le(s) équipement(s) ciblé(s) par chaque instance, ex. « State Watch (Machine à laver) », pour distinguer plusieurs instances d'une même recette. (#291)

---

## 1.24.x: Notifications Web Push

### v1.24.3 — 2026-06-29 { #v1-24-3 }

- Fix (notifications) : les notifications Web Push sont séparées en un titre (le message) et un corps (la valeur). Une notification plus longue comme « Porte de garage ouverte depuis » suivie d'un horodatage se lit désormais sur deux lignes au lieu d'être tronquée sur une seule. Telegram conserve son format sur une ligne. À noter : la mention « from Sowel » sur la notification est ajoutée par le navigateur / le téléphone lui-même (il affiche toujours quelle app a envoyé le push) et ne peut pas être retirée.

### v1.24.2 — 2026-06-29 { #v1-24-2 }

- Fix (notifications) : le bouton « Tester le canal » envoie désormais une vraie notification pour le canal Web Push. Auparavant il ne faisait que valider les clés VAPID sans rien envoyer, donc il semblait ne rien faire. Il renvoie aussi une erreur claire si aucun appareil n'a encore activé le push. (#288)
- Fix (notifications) : les notifications Web Push n'affichent plus un titre « Sowel » redondant. L'app installée (et le navigateur) affiche déjà le nom Sowel, donc c'est désormais le message lui-même qui sert de titre à la notification. (#288)
- Fix (ui) : la page Administration > Notifications est désormais lisible sur mobile. Les actions du publisher passent sur leur propre ligne, le canal (Telegram ou Web Push) est affiché correctement au lieu de toujours « Telegram », et les lignes de mapping s'affichent proprement. (#288)

### v1.24.1 — 2026-06-29 { #v1-24-1 }

- Fix (core) : le Web Push fonctionne désormais sur iOS et Safari. La passerelle push d'Apple rejetait chaque notification (HTTP 403) car le sujet VAPID par défaut utilisait un domaine `.local`, refusé par Apple (Chrome et Android n'étaient pas affectés). Le défaut est maintenant un contact valide, et les instances existantes corrigent automatiquement la valeur stockée à la mise à jour, sans régénérer les clés, donc les appareils déjà abonnés continuent de fonctionner. (#287)

### v1.24.0 — 2026-06-29 { #v1-24-0 }

Web Push comme canal de notification pour la PWA installée, plus deux correctifs d'affichage mobile :

- Feat (core) : nouveau canal de notification **Web Push** en complément de Telegram. La PWA installée (en HTTPS) peut recevoir des notifications natives. Les clés VAPID sont générées au premier démarrage, les abonnements sont par utilisateur, et les abonnements expirés sont purgés automatiquement. À configurer dans Réglages > Notifications : activez le push sur un appareil, puis mappez un publisher « Web Push » sur une valeur d'équipement, de zone ou de recette. (#284)
- Fix (ui) : sur mobile, l'heure et le lever/coucher du soleil s'affichent désormais dans la barre du haut (auparavant réservés au bureau). (#285)
- Fix (ui) : sur mobile, le sélecteur Wh / € de Énergie > Consommation est de nouveau accessible ; il ne déborde plus hors de l'écran à côté du sélecteur de période. (#285)

---

## 1.23.x: Briques pour recettes solaires

### v1.23.0 — 2026-06-24 { #v1-23-0 }

Briques de formulaire pour la programmation horaire solaire (spec 126) :

- Feat (recipes) : nouveau type de slot `select`, affiché en menu déroulant avec libellés d'options traduits. Une recette peut désormais proposer une petite liste fermée de choix nommés.
- Feat (recipes) : nouveau `ctx.helpers.getSunlight()` qui expose aux recettes le lever, le coucher et l'indicateur de jour courants (depuis le gestionnaire de soleil existant, décalages appliqués), pour programmer sur les heures du soleil. À coupler à l'événement `sunlight.changed` pour se resynchroniser au fil des jours.
- Feat (recipes) : nouvelle règle de slot `hiddenWhen` : le formulaire n'affiche que le champ pertinent (ex. un sélecteur d'heure pour « heure fixe », un décalage en minutes pour « lever/coucher ») ; le champ non pertinent est retiré de la mise en page, qui reste alignée.
- Feat (ui) : les slots `number` s'affichent en champs numériques (avec min/max), pour saisir proprement un décalage positif ou négatif en minutes ; les grilles de slots utilisent des colonnes de largeur égale.

Ces briques équipent la nouvelle recette **Programmation horaire** (créneaux heure fixe / lever / coucher du soleil), disponible depuis le store de plugins.

---

## 1.22.x: Pilotage des prises et association Zigbee on/off

### v1.22.0 — 2026-06-23 { #v1-22-0 }

Corrections d'association des équipements on/off Zigbee et pilotage des prises :

- Fix (equipments) : les prises et relais Zigbee2MQTT (Lidl, Legrand, ...) sont désormais proposés à l'association d'un équipement `switch` (prise). Leur commande on/off est un ordre booléen `light_toggle`, que le moteur ne reconnaissait qu'en énumération ON/OFF, donc seuls les Tasmota apparaissaient. (#276)
- Feat (ui) : les équipements `switch` (prise) disposent maintenant de commandes on/off partout (carte compacte, carte équipement, page détail) et d'un widget dashboard dédié (picto prise murale et bouton ON/OFF), au lieu d'un simple badge en lecture seule. (#277)
- Fix (equipments) : les vannes Zigbee (ex. SONOFF SWV) sont désormais proposées à l'association d'un équipement `water_valve`, et associent toute leur télémétrie (état, débit, batterie, irrigation) au lieu d'être ignorées. (#278)

Nouvelle recette dans le store : **Programmation horaire**, jusqu'à 3 créneaux marche/arrêt par jour pour n'importe quel équipement on/off.

---

## 1.21.x — Équipement panneau photovoltaïque

### v1.21.0 — 2026-06-12 { #v1-21-0 }

Équipement Panneau Photovoltaïque + intégration APsystems (spec 125) :

- Feat (equipments) : nouveau type d'équipement `solar_panel` (« Panneau Photovoltaïque »). Un équipement = un panneau = une voie d'onduleur ; lier un onduleur multi-voies propose un candidat par voie (Panel 1 / Panel 2), une voie déjà utilisée par un autre panneau n'est plus proposée, et la sélection est mono-appareil. Lecture seule.
- Feat (core) : nouvelle catégorie de donnée générique `temperature_device` — la température interne d'un appareil (ex. un onduleur), distincte de `temperature` pour ne jamais polluer la moyenne de température d'une zone. Streaming (fraîcheur 15 min) et historisée par défaut.
- Feat (ui) : widget dashboard solaire dédié — logo de panneau PV + puissance · courant · tension, identique sur desktop et mobile, « Veille » hors production. Nouveau groupe « Solaire » sur la vue Maison, et un panneau de détail en lecture seule (puissance / énergie / tension / courant / température onduleur).
- Nouveau plugin : `apsystems` (lecture seule) — découvre les micro-onduleurs APsystems (DS3 / YC600 / QS1) via le pont MQTT [ESP32-ECU](https://github.com/mchacher/ESP32-ECU), un device par onduleur, en utilisant le Name du firmware comme identité stable pour qu'un remplacement matériel préserve la config Sowel (le serial est exposé comme donnée en lecture seule). Installez-le depuis le store de plugins.

---

## 1.20.x — Valorisation des coûts énergie + mode shadow

### v1.20.0 — 2026-06-03 { #v1-20-0 }

Valorisation des coûts énergie (spec 123) :

- Feat (énergie/api) : `GET /api/v1/energy/history` renvoie désormais `cost_hp`, `cost_hc` et `cost_total` (€) sur chaque point et dans les totaux, calculés au moment de la requête à partir des `TariffPrices.hp` / `TariffPrices.hc` (€/kWh) déjà stockés dans le réglage `energy.tariff`. Le coût par point reflète la consommation brute du créneau (cohérent avec les tooltips du graphique) ; le coût des totaux reflète les hp/hc côté réseau (après soustraction de l'autoconsommation) et correspond à la carte récapitulative. Si le tarif est absent ou les deux prix valent 0, tous les champs de coût valent exactement 0 et la requête réussit.
- Feat (énergie/api) : `GET /api/v1/energy/by-usage` ajoute un `cost` par sous-compteur ainsi que `totals.costByEquipment`, `totals.otherCost` et `totals.totalCost`, calculés via un taux €/kWh moyen pondéré sur la période, dérivé des totaux HP/HC du compteur principal pour la même fenêtre. Les sous-compteurs ne stockent que `energy` (pas de canal HP/HC), donc ce taux moyen permet de ne faire qu'un seul passage Influx ; le compromis est un léger écart d'attribution (~5 %) pour un équipement qui ne tournerait qu'en HC par rapport à une attribution facture-exacte. Sans compteur principal, le taux moyen vaut 0 et les coûts sous-compteurs sont à 0.
- Feat (UI/énergie) : nouveau toggle Wh / € dans l'en-tête de la page Énergie. Le mode coût bascule l'axe Y du graphique, ses tooltips, les totaux de la carte récap et le diagramme empilé "Par usage" en euros. La préférence est persistée en `localStorage` (`sowel_energy_unit`). Si le tarif n'est pas configuré, le toggle est désactivé avec une tooltip qui renvoie vers Réglages > Tarif. L'autoconsommation n'a pas de coût facturé et est donc masquée du graphique en mode €.
- Feat (UI/réglages) : la page Tarif affiche une ligne d'aide sous les prix — « Ces prix valorisent toute votre consommation passée et future » — pour rendre visible la sémantique de valorisation au moment de l'affichage (modifier les prix revalorise les données passées).
- Change (énergie/api) : la sémantique de `/api/v1/energy/status.tariffConfigured` se resserre : on passe de « un blob `energy.tariff` existe » à « au moins un de `prices.hp` / `prices.hc` est > 0 ». Un tarif qui n'a qu'une grille horaire avec 0/0 en prix n'active plus l'UI coût.

Mode shadow (spec 124) :

- Feat (core) : nouvelle variable d'environnement `SOWEL_SHADOW_MODE=1`. Quand elle est positionnée, Sowel démarre son serveur HTTP et sert l'UI normalement, mais chaque sous-système sortant est coupé à la fois au boot et au runtime : aucun plugin ne démarre (pas de MQTT connect, pas de poll cloud, pas de refresh OAuth), aucune instance de recette n'est restaurée ou armée, aucun MQTT publisher ne se connecte, aucun notification publisher ne s'abonne, aucun poll GitHub. Les runtime gates sur `PluginLoader.loadPlugin` et `RecipeManager.startInstance` font qu'un admin qui clique _Enable_ sur un plugin ou une recette à l'intérieur d'une instance shadow NE déclenche PAS de connexion sortante : la ligne SQLite est écrite, mais le runtime reste inerte.
- Feat (api) : `GET /api/v1/system/mode` renvoie `{ shadowMode: boolean }`, consommé par le bandeau UI. Auth requise, accessible à tout utilisateur authentifié.
- Feat (ui) : bandeau **MODE SHADOW** ambre pleine largeur au-dessus du sidebar et du contenu, sur toutes les pages, non-dismissable, quand `shadowMode === true`. Localisé FR + EN.
- Feat (logs) : quand le mode shadow est actif, une ligne de log structurée `warn` `module: "shadow-mode"` est émise au boot avec le hostname du conteneur, pour qu'une activation accidentelle du mode shadow sur la production soit immédiatement visible dans `docker logs sowel` et puisse déclencher une alerte.
- Docs : nouveau playbook interne dans `scripts/howto-shadow.md` (non publié sur docs.sowel.org) qui décrit le cycle de vie complet d'une instance shadow : checklist pré-vol, backup, run avec `SOWEL_SHADOW_MODE=1`, restore, test, cleanup, et une section de recovery pour le cas "j'ai oublié de positionner la variable".

---

## 1.19.x — Action wake afficheur

### v1.19.1 — 2026-06-02 { #v1-19-1 }

- Fix (UI/équipements) : l'auto-binding ramasse désormais l'ordre `wake` sur les équipements display. Avant ce correctif, la whitelist `RELEVANT_ORDERS["display"]` dans `bindingUtils.ts` ne listait que `language` et `brightness`, donc même après que le firmware ait annoncé la nouvelle capacité `display_wake` (iter 036) et que le plugin displays v0.2.1 l'ait exposée sur le device, le flow de création d'équipement la filtrait silencieusement. Résultat : la recette presence-display v0.2.0 refusait de démarrer avec `Display "..." has no order of category "display_wake" — firmware too old`. Correctif : ajout de `wake` à la whitelist display. Compagnon de la spec 122. Note : le `CANDIDATE_BASED_TYPES` côté UI exclut encore `display` (asymétrie avec le `binding-candidates.ts` du backend qui traite display en "all"-candidate). L'alignement est un suivi ; ce correctif est le patch minimal pour le problème utilisateur.
- Feat (UI/afficheurs) : la carte d'équipement dans la vue zone fait désormais apparaître la luminosité courante de l'afficheur à côté du label de type — `Afficheur · 30 %` quand allumé, `Afficheur · Éteint` quand la luminosité vaut 0 (état de veille piloté par la recette). Avant, il fallait cliquer sur l'équipement pour lire la valeur du slider et savoir si le panneau était endormi.

### v1.19.0 — 2026-06-02 { #v1-19-0 }

- Feat (core) : nouvelle catégorie d'ordre `display_wake` pour le type d'équipement afficheur. Action sans valeur qui demande à l'afficheur de restaurer la dernière luminosité choisie par l'utilisateur (stockée dans sa NVS locale). Spec 122. Utilisée par la recette de mise en veille sur absence (`sowel-recipe-presence-display` v0.2.0+) qui n'a donc plus besoin de connaître la luminosité préférée. Changements compagnons : `sowel-plugin-displays` v0.2.0 route l'ordre vers `<prefix>/<id>/cmd/wake` ; sowel-energy-display iter 035 sépare la NVS en `current_pct` + `user_pct`, restaure `user_pct` sur tap ou `cmd/wake`, et s'éteint automatiquement 2 minutes après un tap-wake si la recette n'a pas confirmé.

---

## 1.18.x — Type d'équipement Afficheur

### v1.18.4 — 2026-06-02 { #v1-18-4 }

- Fix (UI/afficheur) : finition du curseur de luminosité. La mise en place v1.18.3 du clear basé sur l'echo serveur laissait une courte fenêtre où la valeur affichée pouvait flasher en arrière sur la valeur précédente, entre le relâchement et l'écho serveur. Remplacé par un hold plat de 1,5 s post-commit : le curseur reste fixé sur la cible utilisateur jusqu'à ce que l'aller-retour firmware soit arrivé à coup sûr, plus de flicker. Pas du curseur porté de 5 à 10 (`min=0 max=100 step=10` → 11 paliers bien espacés dont la position "Off" à 0), suite à un retour utilisateur (pas de 5 % trop fin et difficulté à toucher exactement 0).

### v1.18.3 — 2026-06-02 { #v1-18-3 }

- Fix (UI/afficheur) : le curseur de luminosité envoie maintenant la commande sur `onPointerUp` (relâchement du pointeur) au lieu de passer par le debounce 300 ms de la v1.18.2 — latence quasi nulle entre le relâchement et la réaction du panel. Un debounce 500 ms de secours sur `onChange` couvre toujours la navigation clavier / accessibilité où pointerup ne se déclenche pas. La valeur locale du curseur reste fixée sur la cible utilisateur jusqu'à ce que le WebSocket renvoie la même valeur du serveur, ce qui élimine le saut-arrière du pouce pendant les ~700 ms de l'aller-retour.
- Feat (UI/afficheur) : `min` du curseur passe de 5 à 0 pour rendre la position "Off" (extinction complète du panel, duty LEDC à zéro côté firmware) accessible depuis la page détail de l'équipement. Le readout numérique affiche "Off" au lieu de "0 %" quand la valeur atteint zéro. Modifications compagnon sur sowel-energy-display iter 035 : 0 accepté comme valeur d'extinction, repli sur 80 % au boot si la NVS est restée bloquée à 0 (récupération suite à une coupure pendant qu'une recette de veille était active), et réveil du panel sur n'importe quel tap quand il est éteint (failsafe si la recette ne dispatche plus).

### v1.18.2 — 2026-06-02 { #v1-18-2 }

- Fix (UI/afficheur) : le curseur de luminosité sur la page détail d'un équipement afficheur est désormais debouncé (300 ms en sortie). Le `onChange` React sur un `<input type="range">` se déclenche sur chaque mouvement du pointeur pendant un drag (5..10 / s) — avant 1.18.2 chaque événement postait sur `/api/v1/equipments/:id/orders` et le plugin afficheurs republiait un `cmd/brightness`, ce qui martelait le firmware et amplifiait l'avalanche de commandes. Un scrub lent de 100 % à 5 % produit maintenant exactement une seule commande MQTT (la valeur finale). Le curseur et la valeur numérique suivent toujours le drag localement pour rester réactifs. Correctif firmware compagnon sur sowel-energy-display iter 035 : la commande est marshalée via `lv_async_call` avec coalescing pour absorber tout flood qui passerait encore.

### v1.18.1 — 2026-06-02 { #v1-18-1 }

- Fix (UI/équipements) : le sélecteur d'appareils à la création d'équipement filtre désormais correctement quand le type est `display`. La v1.18.0 avait oublié l'entrée `display` dans les tables `EQUIPMENT_TYPE_CATEGORIES` (DeviceSelector) et `RELEVANT_DATA / RELEVANT_ORDERS` (bindingUtils), ce qui listait tous les appareils du système et créait l'équipement sans aucune liaison automatique. Les filtres matchent maintenant sur les champs canoniques d'un afficheur (`display_brightness` / `language` / `rssi`) et l'auto-binding crée les 5 liaisons de données (firmware_version / uptime / rssi / language / display_brightness) + 2 liaisons d'ordre (language / brightness) à la sélection d'un appareil supervisé. Suite de la spec 120.

### v1.18.0 — 2026-06-01 { #v1-18-0 }

- Feat (équipements) : nouveau type d'équipement `display` pour les afficheurs supervisés par Sowel. Le plugin compagnon `sowel-plugin-displays` (repo séparé) découvre les afficheurs via MQTT (payload `state` retenu, disponibilité pilotée par le LWT) et les expose comme des devices Sowel à binder sur le nouvel équipement `display`. Le premier vendeur est le firmware AMOLED sowel-energy-display (iter 035, repo séparé) ; tout futur afficheur e-paper / OLED / ePOS suit le même contrat de format de message sans modification du plugin. Nouvelles catégories `DataCategory` : `firmware_version`, `uptime`, `rssi`, `language`, `display_brightness`. Nouvelles catégories `OrderCategory` : `set_language`, `set_display_brightness`. Nouvelle famille de widget `displays` (agrégation à la zone `displaysOnline / displaysTotal`). Nouveau `DisplayPanel.tsx` sur la page de détail de l'équipement, qui affiche les champs canoniques avec un menu langue et un curseur de luminosité en ligne, masqués si la liaison correspondante est absente. Le sélecteur de widget du dashboard masque les afficheurs — ce sont des surfaces de contrôle, pas des choses de la maison à résumer. Spec 120 + 121.
- Feat (plugins/registry) : ajout du plugin `displays` (v0.1.0, owner mchacher, officiel) — installable depuis Admin → Plugins → Parcourir pour commencer à superviser des afficheurs. Le plugin expose `mqtt_url` / `mqtt_username` / `mqtt_password` / `topic_prefix` (défaut `sowel-display`) dans sa page de réglages.

---

## 1.17.x — Agrégation des historiques énergie par période

### v1.17.0 — 2026-05-31 { #v1-17-0 }

- Feat (backend/api) : `GET /api/v1/energy/history` et `GET /api/v1/energy/by-usage` renvoient désormais un nombre fixe de buckets pré-agrégés par période — 24 horaires en `day`, 7 quotidiens lundi à dimanche en `week`, 28 à 31 quotidiens en `month`, 12 mensuels janvier à décembre en `year`. Avant la spec 119, un appel `?period=week` renvoyait 168 points horaires et `?period=year` renvoyait environ 365 points journaliers, forçant chaque consommateur (le `EnergyBarChart.tsx` du web UI et le nouveau firmware sowel-energy-display iter 034) à ré-agréger côté client. L'agrégation se fait maintenant en une fois dans InfluxDB via `aggregateWindow(every: $resolution, location: $tz)`, avec des bornes de buckets alignées sur le fuseau local du serveur (`Europe/Paris` par défaut, journalisé au démarrage). La séparation tarifaire HP / HC est préservée sur chaque bucket. Les buckets vides sont retournés zéro-fillés pour que les consommateurs puissent itérer `0..N-1` sans gérer les trous. Le littéral `EnergyHistoryResponse.resolution` gagne `"1mo"` pour le bucket annuel. Spec 119.

---

## 1.16.x — Améliorations des graphiques Analyse

### v1.16.0 — 2026-05-30 { #v1-16-0 }

- Évolution (UI/Analyse) : familles de catégories verrouillées par graphique. `temperature` / `humidity` / `pressure` / `co2` / `voc` / `noise` / `luminosity` / `power` / `voltage` / `current` / `wind` / `battery` forment la famille **Mesures** (graphique linéaire). `rain` / `energy` forment la famille **Cumuls** (graphique en barres). `motion` / `contact_door` / `contact_window` / `water_leak` / `smoke` forment la famille **États** (graphique en marches sur axe `[0, 1]` avec ticks sémantiques — « fermé » / « ouvert », « absent » / « présent », etc.). Le picker grise les bindings d'une autre famille avec un tooltip « Famille incompatible » ; un bouton « Vider le graphe » réinitialise le verrouillage. Spec 118 F2 / F5 / F7.
- Évolution (UI/Analyse) : enveloppe min/max sur les séries Mesures à dynamique lente (température, humidité, pression, CO2, COV, bruit, luminosité, puissance) en résolution 1h / 1d. Une zone semi-transparente est rendue autour de la ligne moyenne entre les champs `min` et `max` retournés par l'API (déjà présents dans les buckets downsampled). Un toggle « Enveloppe min/max » dans l'en-tête active/désactive la bande, par défaut activée, mémorisée en mémoire seulement. Le tooltip affiche `21.5 °C (18 / 26)` quand la bande est visible. Spec 118 F1.
- Correctif (backend/history) : les requêtes d'historique pour les catégories cumulatives (`rain`, `energy`) lisent désormais le champ pré-agrégé `mean` directement dans les buckets downsampled (`sowel-hourly`, `sowel-daily`) au lieu de filtrer sur `value_number`, qui n'existe que dans le bucket raw. L'ancienne requête retournait systématiquement zéro point sur tout graphique pluie / énergie agrégé, puis bascule en fallback sur le bucket raw qui ne contient que quelques jours du writer live. Détecté sur sowelox juste après un backfill 12 mois de la pluie : le graphique « Pluie » en vue Mois restait vide alors que les totaux journaliers `sum_rain_24` étaient correctement écrits par le script Netatmo. Spec 118 F8, avec nouveaux tests `buildFluxQuery` couvrant les deux branches downsampled et raw.
- Correctif (UI/nav) : cliquer sur « Analyse » dans la sidebar depuis une route de chart sauvegardé (`/analyse/<chartId>`) navigue désormais bien vers le workspace vide `/analyse` au lieu de juste replier la section. L'ancien gestionnaire appelait `preventDefault` pour tout chemin commençant par `/analyse`, ce qui rendait le workspace de création de nouveau graphique inaccessible une fois qu'un graphique enregistré avait été ouvert. Spec 118 F9.
- Évolution (UI/Analyse) : le workspace Analyse vide ouvre le picker d'ajout par défaut et présélectionne la première zone, pour que le flow de création (zone → équipement → métrique) soit visible immédiatement à l'entrée sur `/analyse`. Le placeholder de graphique vide se réduit à un panneau discret en pointillés pointant vers le picker au-dessus. Spec 118 F9.
- Changement (history) : la direction du vent et les détails des rafales (`wind_angle`, `gust_strength`, `gust_angle`) ne sont plus historisés par défaut. Ils restent visibles en live dans le widget `WeatherPanel` (flèche de direction, hero des rafales) mais disparaissent du picker Analyse sur nouvelle installation et après redéploiement sur les installations existantes. Les points existants dans InfluxDB sont inoffensifs et disparaîtront avec la rétention. Spec 118 F6.

---

## 1.15.x — Décomposition consommation live

### v1.15.7 — 2026-05-30 { #v1-15-7 }

- Correctif (UI/Analyse) : dans les vues Année / Mois, l'axe des X répétait le même libellé de mois plusieurs fois (« mars mars mars … avr. avr. avr. »). Cause : l'axe X était câblé en mode catégorique (chaque point quotidien était sa propre catégorie). Passage à une échelle temporelle continue (epoch ms + `tickFormatter`) : Recharts espace désormais les ticks régulièrement dans le temps et le formatter ne rend « mars » qu'une fois là où un tick atterrit. `minTickGap` est désormais sensible à la période (60/70/80/90 px pour jour/sem/mois/année).

### v1.15.6 — 2026-05-30 { #v1-15-6 }

- Évolution (UI/Analyse) : le sélecteur de plage temporelle de la page Analyse est remplacé par le même bandeau calendaire que la page Énergie — onglets de période (Jour / Sem / Mois / Année) + flèches précédent/suivant + bouton « Aujourd'hui ». Permet de naviguer sur n'importe quelle fenêtre absolue (un mardi précis, août dernier, 2025 en entier) au lieu de juste « les N dernières heures/jours ». Indispensable pour visualiser des données historisées rétroactivement. Les 4 onglets sont en largeur égale et le layout copie celui d'Énergie (titre à gauche, navigateur à droite).
- Évolution (UI/Analyse) : burger mobile + drawer des charts sauvegardés (`AnalyseMobileNav`) — copie du pattern mobile d'Énergie. Sur `/analyse/*`, le burger de la topbar ouvre un drawer listant les charts enregistrés + une entrée « Nouveau graphique ». Le titre `h1` est caché sur mobile (déjà présent dans la topbar), récupérant de l'espace vertical pour le graphe.
- Évolution (UI/Analyse) : libellés humains partout où une chip ou une légende de binding apparaît, y compris sur les charts sauvegardés. Les pills, le tooltip et la légende affichent désormais « Température extérieure » / « Batterie Module Extérieur » / etc., au lieu de l'alias brut (`temperature_2`, `battery_3`). Les charts sauvegardés re-fetchent les bindings de l'équipement à l'ouverture pour enrichir les labels.
- Changement (UX mobile) : suppression du bouton `⋮` MoreVertical redondant dans la topbar mobile — il ouvrait exactement le même drawer (Réglages / Plugins / Compte / Déconnexion) que le bouton « Plus » de la bottom-nav. Un seul point d'entrée, plus de doublon.
- Correctif (UI/Analyse) : arithmétique de date TZ-correcte dans le navigateur de période. L'ancien shift utilisait `toISOString().slice(0, 10)` (= date UTC), ce qui perdait silencieusement un jour quand l'heure locale est en avance sur UTC — la flèche « suivant » paraissait bloquée et « précédent » sautait des jours. Remplacé par un formatter de date locale.

### v1.15.5 — 2026-05-30 { #v1-15-5 }

- Correctif (history) : les bindings de température et d'humidité extérieures (catégories `temperature_outdoor` / `humidity_outdoor` — typiquement le module extérieur Netatmo) sont désormais historisés par défaut. La liste blanche `CATEGORY_DEFAULTS_ON` de `history-writer.ts` ne connaissait que les variantes intérieures, donc on-par-défaut tombait sur OFF et aucun point n'était jamais écrit dans InfluxDB. Les équipements existants reprennent automatiquement au prochain rafraîchissement du cache du history-writer (event `equipment.updated` ou démarrage). Premier fichier de tests unitaires sur `resolveHistorize` pour verrouiller le contrat.
- Évolution (UI/historique) : remplace les aliases bruts (`temperature_2`, `humidity_2`, `battery_3`…) par des libellés humains équipement-level partout où une chip ou une légende de binding apparaît — sélecteur Analyse, pilules de séries, Tooltip et Légende du graphe, et fiche historique de la page équipement. La distinction intérieur / extérieur vient directement de la catégorie (`Température intérieure` vs `Température extérieure`) ; seules les catégories multi-instances sans frère sémantique (typiquement plusieurs batteries sur une station multi-modules) remontent un nom de device en discriminant (`Batterie Module Extérieur` / `Anémomètre` / `Pluviomètre`). Survol d'une chip = affichage de l'alias brut en tooltip pour les power users.

### v1.15.4 — 2026-05-29 { #v1-15-4 }

- Correctif (UI/météo) : le module extérieur Netatmo (NAModule1) est désormais sélectionnable lors de la création d'un équipement `weather`. Le filtre du sélecteur ne listait que `temperature` / `humidity` (variantes intérieur), donc le module extérieur — celui qui porte précisément la température extérieure, ironiquement — était masqué de la liste des devices compatibles et silencieusement ignoré par la boucle d'auto-binding. Ajout de `temperature_outdoor` et `humidity_outdoor` dans le filtre, ainsi que dans `SENSOR_DATA_CATEGORIES` pour que la vue détail (bottom sheet) les voie aussi. Verrouillé par des tests unitaires.
- Évolution (UI/météo) : le widget météo du dashboard affiche désormais **température extérieure et intérieure côte à côte** quand les deux modules sont liés. L'humidité disparaît de la vue compacte (la deuxième température est plus utile à comparer). Si un seul des deux modules est lié, la température affichée porte explicitement son label `Extérieur` / `Intérieur` (jamais implicite : lire `20,5°` seul laissait l'utilisateur deviner). Le lookup se fait par catégorie et non par alias, pour gérer la collision de clés Netatmo (les deux modules envoient `key: "temperature"`).
- Évolution (UI/météo) : la fiche détail (clic sur le widget) est réorganisée par module physique : une section compacte par device (Module Extérieur, Station Intérieure, Pluviomètre, Anémomètre) avec le nom du device et la batterie dans l'en-tête. Même modèle mental que la page détail de l'équipement (`WeatherPanel`), rendu en sections empilées au lieu d'une grille de cartes. Les suffixes `(Intérieur)/(Extérieur)` sur chaque ligne sont retirés : le titre de section fait la disambiguïté.

### v1.15.3 — 2026-05-29 { #v1-15-3 }

- Changement (déploiement) : l'auto-update depuis l'UI est désormais **activé par défaut**. Le `docker-compose.yml` officiel monte `/var/run/docker.sock` dans le conteneur Sowel, donc le bouton "Mettre à jour maintenant" de l'UI Admin fonctionne dès la première installation. Le modèle opt-in `docker-compose.override.example.yml` est supprimé. **Compromis sécurité** : monter le socket Docker donne au conteneur Sowel le contrôle effectif du démon Docker hôte, donc une RCE réussie contre Sowel escaladerait en root sur l'hôte. Pour les déploiements hardening ou multi-tenants, retirer la ligne `docker.sock` du compose pour revenir au comportement précédent : le reste de Sowel continue à fonctionner, seul l'updater intégré est désactivé. Ce changement inverse la décision v1.7.0 (spec 105) après retour terrain : la quasi-totalité des installs tombait sur le message "mise à jour indisponible" sans deviner qu'il fallait copier un fichier override. Les installs existantes ne sont PAS touchées ; le nouveau défaut ne s'applique qu'aux compose fraîchement récupérés du repo.

### v1.15.2 — 2026-05-28 { #v1-15-2 }

- Correctif (core) : le `docker-compose.yml` officiel déclare désormais `extra_hosts: ["host.docker.internal:host-gateway"]` sur le service `sowel`. Les plugins MQTT (Zigbee2MQTT, LoRa2MQTT, Tasmota, Shelly, pont Somfy RTS...) peuvent enfin joindre un broker hébergé sur la même machine via `host.docker.internal:1883`, sans coder en dur l'IP LAN de l'hôte (fragile sous DHCP). Les installations existantes prennent le changement en rafraîchissant leur compose ou en ajoutant le bloc manuellement (voir `docs/user/host-setup.md`).
- Correctif (UI/PWA) : suppression d'une boucle qui désinscrivait tous les service workers à chaque chargement de page et tuait la PWA aussitôt après son enregistrement par `vite-plugin-pwa`. Chrome Android refusait de proposer l'installation parce qu'aucun SW actif n'existait au moment de l'évaluation. La bannière d'installation réapparaît sur les déploiements HTTPS ; les utilisateurs existants doivent vider une fois les données du site pour que l'ancienne purge ne se rejoue pas.
- Correctif (UI/Prévision météo) : la création d'un équipement `weather_forecast` depuis l'UI auto-bind à nouveau les 25 points de donnée émis par le plugin Open-Meteo. La table d'auto-binding du front n'avait pas d'entrée `weather_forecast`, donc chaque clé `j1_*`..`j5_*` était filtrée silencieusement et l'équipement résultant affichait un panneau de prévision vide. Les catégories Sowel concernées (`weather_condition`, `temperature_outdoor`, `rain`, `wind`) sont maintenant déclarées et verrouillées par un test unitaire.

### v1.15.1 — 2026-05-27 { #v1-15-1 }

- Feature (API) : nouveau paramètre optionnel `?type=<EquipmentType>` sur `GET /api/v1/equipments`. Renvoie uniquement les équipements du type demandé (par ex. `?type=energy_meter`). Les valeurs inconnues retournent une liste vide plutôt qu'une 400, pour qu'un appelant puisse forwarder une saisie utilisateur sans validation préalable. Permet aux clients à mémoire contrainte (comme le firmware ESP32 sowel-energy-display) de passer d'un payload de 100 Ko à quelques Ko en ne demandant que les entrées utiles.

### v1.15.0 — 2026-05-27 { #v1-15-0 }

- Feature (UI Énergie) : un donut "Décomposition consommation" apparaît désormais sous le diagramme Maison/Réseau/Solaire de la page Live (spec 117). Un segment par sous-compteur `energy_meter` et un segment "Autre" pour la part non instrumentée, dimensionnés par la puissance instantanée (W). Mise à jour réactive via le flux WebSocket des équipements, aucun nouvel endpoint ni changement de base. Les couleurs reprennent celles du graphique By-usage historique pour qu'un même clamp ait la même couleur dans les deux vues. Les sous-compteurs hors-ligne disparaissent du donut mais restent grisés dans la légende.

## 1.14.x — Disponibilité des équipements

### v1.14.1 — 2026-05-26 { #v1-14-1 }

- Fix (UI) : le libellé "Total" sous le graphique Production solaire correspond désormais à la somme des barres empilées (autoconsommation + injection réseau). Avant, ce libellé venait de la série brute `energy` de l'onduleur alors que les barres cumulaient les séries `autoconso` et `injection` calculées par minute, et les deux pouvaient diverger d'environ 1 kWh par jour à cause du décalage entre les compteurs solaire et réseau. Cosmétique uniquement, aucune donnée perdue.

### v1.14.0 — 2026-05-26 { #v1-14-0 }

- Équipements : chaque équipement expose désormais un champ `status` dérivé (`online` / `degraded` / `offline`), calculé en mémoire à partir du `status` des devices sous-jacents et de la fraîcheur des bindings streaming (spec 116). L'UI affiche des pastilles ambre "Dégradé" et rouge "Déconnecté" sur toutes les surfaces où l'utilisateur voit des valeurs d'équipement : lignes compactes de zone (la pastille remplace les contrôles quand l'équipement est offline), header de la page détail, panneau de cumuls énergie (avec caption de fraîcheur), pastilles d'agrégation de zone (hint `(N indispo.)` quand un équipement offline a été exclu d'une métrique). La page Live Energy gagne une bannière en haut qui flag explicitement les compteurs périmés ou déconnectés. Déclenché par un vrai bug : un Shelly Pro 3EM coupé au tableau gardait le graphe d'énergie live affichant sa dernière valeur comme si c'était live, sans aucune indication.
- Contrat plugin : une nouvelle section obligatoire de `plugin-development.md` documente que chaque plugin DOIT maintenir `device.status` à jour via `updateDeviceStatus()`. Un audit prod a trouvé 24 devices coincés à "online" avec un `lastSeen` entre 1 heure et 49 jours ; ce sont des bugs plugin upstream à corriger (topic `availability` Z2M, déconnexion Socket.IO MCZ, etc.), pas des gaps du core Sowel. Sowel n'ajoute volontairement pas de watchdog générique `device.lastSeen > timeout` car les capteurs Zigbee sur pile peuvent rester silencieux pendant des jours sans être offline.
- API : nouvel endpoint `GET /api/v1/system/sunlight` qui expose sunrise / sunset / isDaylight (#218). Aussi : les payloads `GET /equipments` et `GET /equipments/:id` gagnent `status` + `statusReason` optionnel ; le payload `GET /zones/:id/aggregated` gagne `unavailableEquipmentsByCategory` ; le WebSocket gagne un nouvel event `equipment.status.changed` diffusé à chaque transition.

## 1.13.x — Équipement store banne

### v1.13.2 — 2026-05-24 { #v1-13-2 }

- Correctif (zones) : exclusion des `pool_cover` des agrégats shutter de zone (`shuttersOpen` / `shuttersTotal` / `averageShutterPosition`). Les volets de piscine partagent la catégorie de donnée `shutter_position` avec les volets standards et étaient comptés, ce qui faisait apparaître des pastilles et commandes globales "Volets" fantômes sur les zones Piscine (et leurs zones parentes — par exemple un sous-arbre Extérieur → Piscine en héritait par récursivité). Les commandes de zone `allShuttersOpen/Stop/Close` ciblaient déjà `type=shutter` uniquement donc exécuter la commande fantôme était un no-op — seule l'UI mentait. Le correctif uniformise les exclusions awning et pool_cover (check positif `type === "shutter"`).

### v1.13.1 — 2026-05-24 { #v1-13-1 }

- Correctif (zones) : suppression des agrégats `awningsDeployed` / `awningsTotal` livrés par erreur en v1.13.0. Les stores bannes réutilisent la catégorie `shutter_position` mais ne sont volontairement pas agrégés au niveau zone — les widgets dashboard awning calculent leurs comptes localement. La pastille "Stores bannes X/Y" disparaît de la vue zone, et un test de régression garantit que les stores ne polluent plus les agrégats des volets. Les commandes de zone (`allAwningsExtend/Stop/Retract`) ne sont pas touchées.

### v1.13.0 — 2026-05-23 { #v1-13-0 }

- Équipements : nouveau type `awning` (store banne, spec 115), frère du `shutter`. Même surface de contrôle (position 0–100 + OPEN/STOP/CLOSE) avec un vocabulaire dédié partout dans l'UI : boutons "Déployer / Rétracter", pastilles d'état "Déployé / Rétracté", et un groupe "Stores bannes" dédié dans la vue zone. Mapping RF-up = rétracter (position 0), RF-down = déployer (position 100).
- UI : illustration V3 du store déployée sur tout le dashboard (widget équipement, widget famille, widget zone-famille, carte mobile, drawer détail) et la vue maison (compact card, hero card, pastilles d'agrégation, en-tête de groupe). État ouvert = fenêtre + cassette + 10 bandes trapézoïdales festonnées en bleu primaire Sowel / primary-light. État fermé = fenêtre + cassette + petite frise rétractée. Deux composants : `AwningIcon` (viewBox 24, state-aware) pour les contextes icône, `AwningWidgetIcon` (viewBox 56, 120 px, finition gradient) pour les widgets dashboard.
- Correctif : la card détail d'un store apparaissait vide — les contrôles étaient gatés sur `isShutter` seulement, donc Déployer/Stop/Rétracter ne s'affichait jamais. Le même gate manquait sur le widget équipement du dashboard (n'affichait que le pourcentage, sans icône). Les deux sont corrigés.
- Plugin : nouvelle intégration `somfy-rts` dans le registry ([repo](https://github.com/mchacher/sowel-plugin-somfy-rts), v1.0.3). Fait le pont entre la passerelle open source [somfyrts2mqtt](https://github.com/mchacher/somfyrts2mqtt) (ESP32 + CC1101, v0.2.0+) et Sowel : auto-découverte des volets/stores Somfy RTS via les topics SENSOR Tasmota retained, parsing position/direction/target, et envoi OPEN/STOP/CLOSE + pourcentage vers `cmnd/<root>/<remote>/...`.

## 1.12.x — UX station météo

### v1.12.1 — 2026-05-20 { #v1-12-1 }

- Build : remontée de la limite de pré-cache PWA workbox à 5 MiB. Le bundle UI principal a dépassé les 2 MiB par défaut après la refonte spec 114, ce qui a cassé le build Docker de la v1.12.0. Aucun changement runtime. Un follow-up découpera le bundle via `manualChunks` pour pouvoir redescendre la limite.

### v1.12.0 — 2026-05-20 { #v1-12-0 }

- UI : refonte de la station météo (spec 114). La vignette "Station Météo" affiche désormais une tuile 1×1 épurée sur PC comme sur mobile — température extérieure en gros mono + humidité en dessous, rien d'autre — et un tap (ou clic sur desktop) ouvre un drawer avec le détail complet. Le drawer surface en plus les valeurs calculées par Sowel `rain_24h` / `rain_1h`, donc les utilisateurs dont le plugin Netatmo n'auto-binde que la pluie instantanée (`rain` mm/h) voient quand même le vrai cumul 24 h. La ligne compacte de zone passe à 4 valeurs (temp / humidité / pluie `mm/24h` / vent) avec le même fallback. Le `WeatherPanel` de la page détail injecte aussi les valeurs calculées dans la carte du module pluviomètre, et le module vent reçoit une petite flèche directionnelle + abréviation boussole dérivées de `wind_angle`.
- UI : lisibilité de l'histogramme historique. En 7 j / 30 j, les échantillons horaires bruts sont désormais agrégés en totaux journaliers (un seul après-midi pluvieux donne une seule barre du jeudi au lieu de deux pics détachés étiquetés deux fois "jeu. 14"). Plafond de ticks par plage (7 j → 7 labels, 30 j → 10), libellés X sur deux lignes en 7 j (jour de la semaine + numéro), format compact `JJ/MM` en 30 j, taille de police adaptative sur largeur mobile. Le tooltip passe à "Jeudi 14 mai" sur les buckets journaliers.
- UI : PWA. Ajout de la balise standard `mobile-web-app-capable` à côté de la variante Apple pour faire taire l'avertissement de dépréciation de Chrome dans DevTools.

## 1.11.x — Isolation soft des plugins

### v1.11.1 — 2026-05-19 { #v1-11-1 }

- Fiabilité : Sowel installe désormais des handlers globaux pour `uncaughtException` et `unhandledRejection` (spec 112). Quand un throw échappe à toutes les autres protections (un callback `setInterval` dans le core, une promesse non awaited dans un publish MQTT, une surprise d'un module natif), les nouveaux handlers loggent une entrée `fatal` avec la stack complète vers stdout et vers `data/logs/sowel.N.log`, puis exit proprement pour que la politique de restart de Docker relance le conteneur. Avant, un crash non rattrapé ne laissait aucune trace et Docker bouclait silencieusement. Désormais, toute investigation post-incident a au minimum une ligne de log par où commencer. Pas de changement de comportement sur le chemin nominal ; les handlers sont du pur filet de sécurité.
- Sécurité : un nouveau journal d'audit persiste toute action sensible dans la nouvelle table SQLite `audit_log` (spec 113). Les évènements capturés couvrent l'authentification (login success/failure, logout, création/suppression d'API tokens), la gestion utilisateur (création/modification/suppression/changement de mot de passe), les modifications de settings, l'activation/désactivation de modes, l'export/restauration de backups, et l'installation/désinstallation/mise à jour/activation/désactivation de plugins. Chaque entrée enregistre l'acteur (id user + username + type de token), l'IP source, l'action, la cible et un blob JSON `meta` avec redaction automatique des valeurs sur les clés sensibles (`password`, `token`, `secret`, `apiKey`). Un nouvel endpoint admin-only `GET /api/v1/audit` expose le journal avec filtres par acteur, préfixe d'action et plage de dates. La rétention est de 365 jours, purgée au boot.

### v1.11.0 — 2026-05-19 { #v1-11-0 }

- Durcissement sécurité : chaque plugin d'intégration tourne désormais avec des Proxies scopés autour de son `PluginDeps` (spec 111). Quatre invariants sont enforces au niveau JavaScript : un plugin ne peut lire ou écrire que les settings sous son propre préfixe `integration.<own-id>.` (plus une petite allowlist de globaux comme `home.latitude`), ne peut émettre que des events d'une whitelist `system.*` (pas d'usurpation d'events de domaine), ne peut muter que les devices appartenant à sa propre intégration, et les erreurs des méthodes lifecycle (`refresh`, `getStatus`, etc.) sont confinées avec des valeurs de repli typées au lieu de faire tomber le core. Validé en local contre les 13 plugins de la registry avec zéro faux positif. Pas de breaking change pour les auteurs de plugins : la forme de `PluginDeps` et les signatures sont bit-pour-bit identiques, donc les plugins existants continuent de tourner sans modification. L'isolation est inconditionnelle dans cette release ; pas de mécanisme d'opt-out. Le rollback se fait par downgrade de l'image Docker.
- Audit : la spec 089 (SHA256 supply-chain des plugins) plus la spec 111 ferment ensemble les vecteurs de menace dominants côté plugins. Les vecteurs résiduels (accès direct à `better-sqlite3` depuis un plugin, `fetch` arbitraire, boucles infinies, `process.exit`) nécessiteraient une hard isolation via worker threads et restent documentés comme hors scope tant que la registry n'accueille que des owners de confiance.
- Docs : nouvelle section "Scoping des plugins" dans `plugin-development.md` (EN+FR) qui explique les quatre invariants pour les auteurs de plugins, les allowlists explicites dans `scoped-deps.ts`, et ce contre quoi le Proxy ne protège pas.

## 1.10.x — Le changelog à portée de clic

### v1.10.3 — 2026-05-17 { #v1-10-3 }

- Refactor : toutes les résolutions de bindings côté UI et moteur de recettes passent désormais par un résolveur partagé catégorie-d'abord. Les équipements re-bindés manuellement (avec l'alias = clé device) fonctionnent partout : vue zone, détail équipement, feuille mobile, toggle mobile direct, fermer-toutes-vannes, et dispatch piloté par recette (motion-light, switch-light, presence-heater, state-trigger-light). Ferme la classe de bug latent qui avait causé l'incident pool-cover de v1.10.2. Spec 110.

### v1.10.2 — 2026-05-17 { #v1-10-2 }

- Correctif : le bouton ON/OFF de la pompe piscine ne passe plus à la ligne sous l'icône dans la vue compacte de zone.
- Correctif : les boutons OUVRIR/STOP/FERMER du volet piscine (et de tout volet) réapparaissent dans la vue compacte de zone, dans la feuille mobile du tableau de bord, et dans la page de détail équipement quand le binding a été créé avec la clé du device comme alias (ex : après un re-binding manuel via l'UI). Les contrôles résolvent désormais les bindings move/position par catégorie, comme le widget du tableau de bord le faisait déjà.

### v1.10.1 — 2026-05-17 { #v1-10-1 }

- Correctif : une annonce de découverte partielle envoyée par un plugin d'intégration ne détruit plus silencieusement les bindings d'équipement. Avant ce correctif, si un device Tasmota / Zigbee2MQTT / etc. omettait temporairement une de ses clés lors d'une reconnexion, la ligne `device_data` / `device_orders` était supprimée et le CASCADE FK effaçait le binding d'équipement correspondant. C'est ce qui avait fait disparaître la commande du volet piscine après le restart de v1.10.0. Les lignes bound sont désormais préservées à travers les re-découvertes partielles ; seules les vraies lignes orphelines continuent d'être nettoyées (spec 109).

### v1.10.0 — 2026-05-17 { #v1-10-0 }

- Chaque ligne de la feuille des mises à jour expose désormais une icône changelog discrète à côté du bouton Mettre à jour. Cliquez pour ouvrir les notes de version correspondantes (cette page pour le cœur Sowel, la page GitHub release pour les plugins) dans un nouvel onglet. Fini les mises à jour à l'aveugle (spec 107).
- Les notes de version sont désormais dans la table des matières du Guide utilisateur.
- La CI refuse maintenant de publier une release sans entrée correspondante sur cette page, en EN et FR (spec 108). Conséquence : chaque lien « Voir les changements » de l'application tombe sur une section remplie.

---

## 1.9.x — Pastille de mise à jour actionnable

### v1.9.0 — 2026-05-17 { #v1-9-0 }

- La pastille de mise à jour de la barre supérieure ouvre désormais une feuille `UpdatesSheet` listant le cœur Sowel et les plugins obsolètes, avec un bouton `Mettre à jour` par ligne (spec 106). Remplace l'ancienne redirection aveugle vers `/plugins`, qui laissait les mises à jour du cœur invisibles.

---

## 1.8.x — Graphiques et flux d'activité

### v1.8.1 — 2026-05-17 { #v1-8-1 }

- Les graphiques temporels utilisent désormais une échelle de temps linéaire sur l'axe X. Les données détection / contact / météo éparse ne sont plus comprimées visuellement quand les événements sont groupés dans le temps.

### v1.8.0 — 2026-05-16 { #v1-8-0 }

- Nouveau flux d'activité dans la vue zone (spec 101). Affiche les événements des dernières 24 h avec un plafond adaptatif (10 sur mobile, 100 sur desktop), filtré par catégorie de liaison et limité à la zone courante.

---

## 1.7.x — Durcissement WAN

### v1.7.0 — 2026-05-15 { #v1-7-0 }

- Durcissement WAN (spec 105) : CSP et vérification d'origine WebSocket renforcés pour une exposition publique sûre via tunnel Cloudflare. Google Fonts autorisé pour la police Nunito. Socket Docker accessible à l'utilisateur non-root `sowel`.
- CI : runner GitHub ARM64 natif avec builds parallèles — le temps de release multi-arch passe d'environ 15 min à 3 min.

---

## 1.6.x — Design system et chaîne d'approvisionnement plugins

### v1.6.6 — 2026-05-15 { #v1-6-6 }

- L'assistant de configuration déclenche automatiquement le redémarrage après validation ; séparateur décimal unifié pour les champs latitude/longitude.
- CI : politique de rétention GHCR — les anciennes versions de conteneurs sont automatiquement purgées à chaque release.

### v1.6.5 — 2026-05-15 { #v1-6-5 }

- Assistant de configuration Maison au premier login. Le helper de redémarrage passe désormais `--force-recreate` pour réellement redémarrer.

### v1.6.4 — 2026-05-15 { #v1-6-4 }

- L'installation de plugin ne refuse plus que les liens symboliques _qui sortent du paquet_ ; les liens internes sont autorisés (spec 089 C1).

### v1.6.3 — 2026-05-14 { #v1-6-3 }

- L'auto-mise à jour normalise le fichier compose vers `:latest`, force la recréation du conteneur et vérifie la nouvelle version (spec 104).
- CI : création de la release GitHub conditionnée à la réussite du build ARM64.

### v1.6.2 — 2026-05-14 { #v1-6-2 }

- Durcissement de la chaîne d'approvisionnement plugins (spec 089 C1+C2) : hashes SHA256 figés dans le registre, confirmation d'installation pour le namespace communautaire, confinement du chemin de restauration, liste blanche d'extensions, refus des liens symboliques, plafond de taille.

### v1.6.1 — 2026-05-14 { #v1-6-1 }

- Correction du build Docker — le répertoire `design-system/` est désormais copié dans l'étape de build UI.

### v1.6.0 — 2026-05-14 { #v1-6-0 }

- Refonte UI majeure pour parité avec le design system (specs 094–100) :
  - Nouvelle palette et nouveaux tokens du design system
  - Sidebar refactorisée en composants réutilisables
  - Vue zone en 2 colonnes sur desktop avec bande d'agrégation et pills variantes
  - Toolbar de commandes zone icon-only
  - Chrome unifié pour les widgets du tableau de bord
  - Typographie polie (letter-spacing, standardisation H1, tabular nums par défaut)
  - Refactor du chrome des lignes d'équipement avec halo lumineux
  - Alignement strict avec la maquette sur les panneaux de zone, parité mobile
- Installateur en une commande (`install.sh`) ajouté.

---

## 1.5.x — Extension énergie et recettes

### v1.5.10 — 2026-05-10 { #v1-5-10 }

- Revert interne sur la documentation.

### v1.5.9 — 2026-05-09 { #v1-5-9 }

- Sélecteur de recettes réécrit en popover compacte (latéral sur desktop, bottom-sheet sur mobile). Palette pastel et coins arrondis sur le graphique énergie par usage.

### v1.5.8 — 2026-05-08 { #v1-5-8 }

- Nouvelle recette `state-trigger-light` (spec 092). Les slots de recette gagnent les contraintes `crossZone` et `includeDescendants`, ainsi qu'un sélecteur "zone d'abord" pour les slots équipement unique.

### v1.5.7 — 2026-05-08 { #v1-5-7 }

- Sous-compteurs en puissance uniquement et graphique de répartition énergie par usage (spec 091). Cumul Wh des sous-compteurs exposé comme donnée calculée sur l'équipement.

### v1.5.6 — 2026-05-03 { #v1-5-6 }

- Toggle activer/désactiver par mapping sur les publications MQTT (spec 090).

### v1.5.5 — 2026-05-03 { #v1-5-5 }

- Hot-load plugin : invalidation du cache pour les imports transitifs.

### v1.5.4 — 2026-05-03 { #v1-5-4 }

- API plugin : getter `getDeviceDataLastUpdated` exposé ; bump du registre `shelly_mqtt`.

### v1.5.3 — 2026-05-03 { #v1-5-3 }

- La requête de production énergie retombe sur le bucket horaire quand le bucket raw manque. Le tooltip de consommation sépare HP/HC entre réseau pur et autoconsommation.

### v1.5.2 — 2026-05-03 { #v1-5-2 }

- Pastilles compactes en barre supérieure remplacent la bannière d'alarme et le warning d'intégration. Le statut énergie live se sépare selon la source dominante. Le dechargement plugin appelle toujours `stop()`.

### v1.5.1 — 2026-05-03 { #v1-5-1 }

- Writer d'autoconsommation (spec 086 étapes E+F), plus corrections de bugs sur l'agrégateur et l'historique. Nouveau getter `getDeviceDataValue` pour l'hydratation des plugins.

### v1.5.0 — 2026-05-02 { #v1-5-0 }

- Page de flux de puissance en direct (`/energy/live`) avec auto-détection des sources. Plugin Shelly MQTT ajouté au registre. Outil de migration de l'historique pour les équipements orphelins.

---

## 1.4.x — Pompe à chaleur piscine

### v1.4.2 — 2026-05-01 { #v1-4-2 }

- Le tableau de bord mobile affiche la pompe à chaleur piscine comme un thermostat. Les intégrations désactivées restent visibles sur la page Intégrations. Toggle activer/désactiver directement sur la ligne.

### v1.4.1 — 2026-05-01 { #v1-4-1 }

- Toggle persistant Activer/Désactiver sur le drawer d'intégration. Les anciennes images `ghcr.io/mchacher/sowel` sont purgées automatiquement après auto-mise à jour.

### v1.4.0 — 2026-05-01 { #v1-4-0 }

- Nouveau type d'équipement `pool_heat_pump` et scaffolding du plugin Modbus associé.

---

## 1.3.x — Équipements piscine

### v1.3.2 — 2026-04-19 { #v1-3-2 }

- La logique de rappel d'alarme passe dans le publisher de notification Telegram (spec 083). Remplissages adaptatifs au thème pour l'icône de pompe piscine (dark mode). Pill Ouvert/Fermé sur les cartes compactes de volets et de couverture piscine.

### v1.3.1 — 2026-04-19 { #v1-3-1 }

- Mise en page des slots de recette : colonnes de largeur égale pour les paires homogènes.

### v1.3.0 — 2026-04-19 { #v1-3-0 }

- Nouveaux types d'équipement `pool_pump` et `pool_cover` (spec 081), avec contrôles inline dans la vue zone compacte et un sélecteur de canal dédié côté device. Les appareils multi-canaux peuvent désormais alimenter plusieurs équipements. Le registre plugins peut être rechargé à la demande depuis l'UI.

---

## 1.2.x — Dispatch équipement v2 et catégories de domaine

### v1.2.15 — 2026-04-19 { #v1-2-15 }

- Plugin Tasmota enregistré en v1.0.0 (spec 080). Le `install()` plugin redirige vers `update()` en cas de réinstallation.

### v1.2.14 — 2026-04-18 { #v1-2-14 }

- Les devices stockent les valeurs enum ; l'UI surface les valeurs d'action dynamiquement (spec 079). Nouveau type d'effet bouton `zone_order` avec sélection équipement "zone d'abord" (spec 078).

### v1.2.13 — 2026-04-18 { #v1-2-13 }

- Refactor : `dispatchConfig`, `apiVersion`, fallback brute-force supprimés (spec 074). Le dispatch v2 est désormais l'unique chemin.

### v1.2.12 — 2026-04-18 { #v1-2-12 }

- Catégories de commande pour la résolution des ordres de zone (spec 077). Nouvelles catégories température/humidité extérieures et mise à jour du plugin `netatmo-weather` (spec 076).

### v1.2.11 — 2026-04-18 { #v1-2-11 }

- Nouvelles catégories de domaine pour `media_player`, `appliance` et `thermostat` (spec 073).

### v1.2.10 — 2026-04-18 { #v1-2-10 }

- L'ordre de zone sur thermostat passe par la catégorie de consigne (spec 070).

### v1.2.9 — 2026-04-18 { #v1-2-9 }

- Les ordres de zone résolvent les alias par catégorie au lieu de noms en dur (spec 069).

### v1.2.8 — 2026-04-18 { #v1-2-8 }

- Dispatch d'ordres v2 — les plugins reçoivent directement `orderKey` au lieu d'un blob `dispatchConfig` (spec 067).

### v1.2.7 — 2026-04-15 { #v1-2-7 }

- Les ordres de zone volet utilisent l'état OPEN/CLOSE au lieu d'une position.

### v1.2.6 — 2026-04-12 { #v1-2-6 }

- Nouvelle option `onChangeOnly` sur les publications MQTT.

### v1.2.5 — 2026-04-12 { #v1-2-5 }

- Restauration du snapshot à chaque reconnexion — revert du changement de v1.2.4 après effets de bord.

### v1.2.4 — 2026-04-12 { #v1-2-4 }

- Les publications MQTT ne bouclent plus sur snapshot à la reconnexion du broker ; republication au changement de mapping.

### v1.2.3 — 2026-04-12 { #v1-2-3 }

- Suppression du verrou par fichier PID — il causait une boucle de crash Docker au redémarrage du conteneur.

### v1.2.2 — 2026-04-12 { #v1-2-2 }

- Nettoyage interne.

### v1.2.1 — 2026-04-12 { #v1-2-1 }

- Le helper d'auto-mise à jour préserve le `working_dir` compose de l'hôte.

### v1.2.0 — 2026-04-12 { #v1-2-0 }

- Registre plugins découplé de la cadence de release de Sowel + champ de compatibilité `sowelVersion` (spec 066).

---

## 1.1.x — Eau et freecooling

### v1.1.7 — 2026-04-12 { #v1-1-7 }

- Les badges et boutons de mise à jour utilisent désormais le rouge au lieu de l'ambre.

### v1.1.6 — 2026-04-12 { #v1-1-6 }

- Nettoyage interne.

### v1.1.5 — 2026-04-12 { #v1-1-5 }

- Le helper d'auto-mise à jour conserve `AutoRemove` désactivé temporairement pour le debug.

### v1.1.4 — 2026-04-12 { #v1-1-4 }

- Nettoyage interne.

### v1.1.3 — 2026-04-12 { #v1-1-3 }

- L'auto-mise à jour pull par tag de version au lieu de `:latest` (évite la course avec des releases concurrentes).

### v1.1.2 — 2026-04-12 { #v1-1-2 }

- Nouvelle recette freecooling — ferme les volets avant le lever du soleil (spec 065).

### v1.1.1 — 2026-04-12 { #v1-1-1 }

- Les paquets recette peuvent s'installer et se mettre à jour à chaud sans redémarrage du moteur.

### v1.1.0 — 2026-04-12 { #v1-1-0 }

- Nouveau type d'équipement `water_valve` (spec 062) et recette d'arrosage automatique (spec 063).
- Données météo calculées : pluie-1h / pluie-24h plus graphiques à barres cumulatifs (spec 064).
- Le fuseau horaire est désormais auto-dérivé de la localisation du domicile (spec 061), avec un fallback sûr quand la table settings manque sur une installation fraîche.
- Polish UX recettes, secondes sur l'horloge, auto-démarrage des plugins après install/update.

---

## 1.0.x — Premières versions

### v1.0.8 — 2026-04-11 { #v1-0-8 }

- Nettoyage interne.

### v1.0.7 — 2026-04-11 { #v1-0-7 }

- Pattern de conteneur helper pour l'auto-mise à jour + améliorations de détection (spec 060).

### v1.0.6 — 2026-04-11 { #v1-0-6 }

- Nettoyage interne.

### v1.0.5 — 2026-04-06 { #v1-0-5 }

- Registre plugins distant, récupéré au runtime avec fallback local (spec 059).
- Image Docker passée à Debian Trixie pour Python 3.13+ (compatibilité bridge Panasonic Comfort Cloud).
- CI : build `amd64` uniquement à ce stade (~5 min vs ~15 min) ; l'ARM64 reviendra plus tard.
- Comparaison semver-aware pour les mises à jour de plugins.

### v1.0.4 — 2026-04-06 { #v1-0-4 }

- Nettoyage interne.

### v1.0.3 — 2026-04-06 { #v1-0-3 }

- L'export line-protocol du backup gère les valeurs non-string d'InfluxDB. La restauration vide `recipe_log` pour éviter les FK orphelines. L'image Docker runtime conserve `python3` pour le bridge Panasonic Comfort Cloud.

### v1.0.2 — 2026-04-06 { #v1-0-2 }

- Le backup inclut désormais `refresh_tokens` pour qu'une instance restaurée garde les utilisateurs connectés.

### v1.0.1 — 2026-04-06 { #v1-0-1 }

- Le `PRAGMA foreign_keys` du backup est déplacé hors de la transaction SQLite (il n'avait aucun effet à l'intérieur).

### v1.0.0 — 2026-04-06 { #v1-0-0 }

- Première version versionnée. Ajoute le versioning `package.json`, le Dockerfile, le pipeline GitHub Actions de release et le `docker-compose.yml` de référence (spec 055). Tout ce qui précède ne vit que dans l'historique git pré-release.
