# Notes de version

Sowel est versionné et déployé via CI/CD depuis `v1.0.0` (avril 2026, spec 055). Chaque version est publiée sous forme de :

- Release GitHub avec un changelog généré — [github.com/mchacher/sowel/releases](https://github.com/mchacher/sowel/releases)
- Image Docker multi-arch taggée `ghcr.io/mchacher/sowel:<version>` et `:latest`

Cette page résume toutes les versions publiées, de la plus récente à la plus ancienne. Pour le diff complet entre deux versions : `https://github.com/mchacher/sowel/compare/v<a>...v<b>`.

**Mettre à jour une instance en cours.** Sowel interroge GitHub toutes les heures et fait apparaître la mise à jour disponible dans la barre supérieure. Un clic sur la pastille ouvre la feuille des mises à jour et applique la nouvelle version en un clic (ajouté en v1.9.0). En ligne de commande : `cd /opt/sowel && docker compose pull && docker compose up -d`.

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
