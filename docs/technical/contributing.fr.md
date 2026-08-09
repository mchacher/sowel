# Contribuer à Sowel

Ce guide couvre tout ce qu'un contributeur doit savoir pour mettre en place l'environnement de développement, suivre les conventions du projet et soumettre des changements.

---

## Mise en place du dev

### Prérequis

- **Node.js 20+**
- **npm** (livré avec Node.js)
- **Docker + docker-compose** (pour InfluxDB)
- **Git**

### Backend

```bash
git clone <repo-url>
cd sowel
npm install
npm run dev          # Development with hot reload (ts-node + nodemon)
```

### Frontend

```bash
cd ui
npm install
npm run dev          # Vite dev server (hot module replacement)
```

### Docker (InfluxDB)

```bash
docker compose up -d     # Starts InfluxDB 2.x
```

InfluxDB est obligatoire : Sowel se connecte au démarrage et auto-crée les buckets, les tâches de downsampling et les tâches d'agrégation énergétique. Aucune configuration manuelle n'est nécessaire.

### Build

```bash
# Backend: TypeScript compilation
npm run build

# Frontend: production build
cd ui && npm run build

# Start production
npm start
```

### Tests

```bash
npm test                          # Run all tests
npm test -- --grep "pattern"      # Run specific tests
```

Les tests utilisent Vitest avec des bases SQLite en mémoire et de faux timers.

---

## Workflow Git

### Stratégie de branches

- **Feature branches obligatoires** : tout développement non trivial (nouvelle fonctionnalité, refactoring, changements multi-fichiers) doit se faire sur une branche dédiée, pas directement sur `main`.
- Utilisez des noms de branche descriptifs : `feat/gate-abstraction`, `fix/rate-limit`, `refactor/influxdb-mandatory-core`.
- Les petits correctifs isolés (typo, changement de config sur une ligne) peuvent aller directement sur `main`.

### Pull Requests

- **Le merge d'une PR exige une approbation explicite de l'utilisateur** : ne mergez jamais une pull request sans validation explicite du mainteneur.
- Créez la PR, présentez-la, et attendez l'approbation avant de merger.
- Gardez les PRs ciblées : une fonctionnalité ou un correctif par PR.

### Messages de commit

Suivez le style conventional commits :

```
feat(devices): add auto-discovery for Netatmo HC
fix(energy): correct HP/HC timestamp offset
refactor(core): make InfluxDB mandatory
docs(api): update endpoint documentation
```

---

## Conventions de code

### TypeScript

- Le **strict mode** est activé sur tout le projet.
- Tous les types sont définis dans `src/shared/types.ts` et partagés entre les modules backend.
- Utilisez les unions discriminées TypeScript pour l'Event Bus typé (type `EngineEvent`).
- Exécutez toujours `npx tsc --noEmit` avant de committer pour attraper les erreurs de type.

### IDs et données

- UUID v4 pour tous les IDs d'entité : `crypto.randomUUID()`.
- Toutes les dates en format ISO 8601.
- Toutes les interfaces vivent dans `src/shared/types.ts`.

### Base de données

- SQLite via l'API synchrone de `better-sqlite3`, volontairement synchrone, très rapide.
- Mode WAL : `PRAGMA journal_mode=WAL`.
- Migrations dans le répertoire `migrations/`, exécutées automatiquement au démarrage.
- Utilisez les transactions pour les opérations en lot.
- Les fichiers de migration suivent le pattern de nommage `NNN_description.sql` (par ex. `033_plugins.sql`).

### Event Bus

- `EventEmitter` typé avec union discriminée TypeScript (type `EngineEvent`).
- Tous les handlers doivent être **non bloquants** et **ne jamais lever d'exception**.
- Wrappez toute la logique de handler dans try/catch avec logging.

### Intégrations

- Chaque source de device implémente l'interface `IntegrationPlugin`.
- Les plugins s'enregistrent dans `IntegrationRegistry` qui gère le cycle de vie (start/stop/reconnect).
- Les intégrations basées sur MQTT utilisent `mqtt.js` avec `connectAsync` pour async/await.
- Les intégrations cloud utilisent du polling avec des intervalles configurables.
- Tous les handlers de message/événement ne doivent jamais lever d'exception, wrappez en try/catch avec logging.
- Les réglages stockés en SQLite dans la table `settings` sous `integration.<id>.<key>`, configurables depuis l'UI.

### Authentification

- bcrypt (cost 12) pour les mots de passe, `jsonwebtoken` (HS256) pour les JWT.
- Tokens d'API : préfixe `swl_`, hash SHA-256 stocké, généré via `crypto.randomBytes(32)`.
- Middleware d'auth : essaie d'abord le décodage JWT, puis le lookup de token d'API.
- Rôles : `admin` > `standard` > `viewer` (permissions hiérarchiques).

### Moteur d'expressions

- Parser d'expressions sûr (PAS `eval`), à envisager `expr-eval` ou un parseur maison.
- Références : `binding.<alias>`, `equipment.<id>.<key>`, `zone.<zoneId>.<key>`.
- Opérateurs : `OR`, `AND`, `NOT`, `AVG`, `MIN`, `MAX`, `SUM`, `IF`, `THRESHOLD`.

### Frontend

- Stores **Zustand** mis à jour par les événements WebSocket.
- WebSocket auto-reconnect avec récupération d'état (incrémental ou complet).
- **Tailwind CSS utility classes uniquement**, pas de fichiers CSS personnalisés.
- Design responsive **mobile-first** (breakpoints : 640 px, 1024 px).
- **Dark mode** via la stratégie `class` de Tailwind.
- **Icônes** : Lucide React, stroke 1.5px.

---

## Règles de logging

Logs JSON structurés via pino (par défaut Fastify) avec multistream : ring buffer (UI), pino-pretty (dev), JSON stdout + fichiers pino-roll (prod).

### Niveaux de log

| Niveau    | Usage                                                         | Visible en prod   | Exemples                                                                                     |
| --------- | ------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| **fatal** | Le processus est sur le point de crasher, irrécupérable       | Oui               | Exception non capturée, corruption de base                                                   |
| **error** | Opération échouée, le moteur continue. Demande attention      | Oui               | Poll d'intégration échoué, erreur de dispatch d'ordre, erreur d'exécution de recette         |
| **warn**  | Situation inattendue, gérée proprement                        | Oui               | MQTT en reconnexion, device offline, retry de refresh de token, nettoyage de device obsolète |
| **info**  | Événements métier significatifs, un par opération             | Oui               | Démarrage/arrêt moteur, device découvert/supprimé, CRUD d'équipement, mode activé            |
| **debug** | Détail opérationnel pour le dépannage                         | Non (dev/UI seul) | Évaluation de binding, étapes d'agrégation, migration appliquée, config chargée              |
| **trace** | Données de chemin chaud à haut volume, debugging profond seul | Non (dev/UI seul) | Chaque émission d'event bus, chaque message MQTT, chaque mise à jour de point de donnée      |

### Règles d'attribution de niveau

- **info = tableau de bord admin** : un opérateur qui lit les logs info doit comprendre _ce qui s'est passé_ sans se noyer. Un log par opération métier, pas par item traité.
- **debug = session développeur** : assez détaillé pour tracer un problème spécifique. Un humain peut lire ces logs sur un module pendant une session de debug.
- **trace = mode replay** : permet de reproduire les transitions d'état exactes. Volume élevé, jamais activé en production.
- **error inclut toujours `{ err }`** : passez l'objet Error en contexte structuré, par ex. `logger.error({ err }, "Poll failed")`.
- **warn = auto-réparation** : le système a géré, mais des warnings répétés signalent une dégradation.
- **N'utilisez jamais `console.log/error/warn`** : utilisez toujours le logger pino structuré. Les appels console contournent le ring buffer, la rotation des fichiers et la redaction.

### Que mettre où (par domaine)

| Domaine          | info                                               | debug                                            | trace                           |
| ---------------- | -------------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| **MQTT**         | Connecté, déconnecté, en reconnexion               | Souscrit à un topic, résultat de publication     | Chaque message reçu             |
| **Devices**      | Découvert, supprimé, statut changé                 | Donnée auto-créée, catégorie inférée             | Chaque mise à jour de donnée    |
| **Equipments**   | CRUD, ordre dispatché                              | Évaluation de binding, résultat de computed data | Chaque réévaluation de binding  |
| **Zones**        | CRUD, résumé d'agrégation                          | Champs d'agrégation calculés individuellement    | Chaque déclencheur d'agrégation |
| **Modes**        | Activé, désactivé, CRUD                            | Chaque action d'impact exécutée                  | --                              |
| **Recipes**      | Instance créée/supprimée, activée/désactivée       | Étapes d'exécution, évaluation de trigger        | --                              |
| **Integrations** | Démarré, stoppé, connecté, poll terminé            | Détails de cycle de poll, résultats d'appel API  | Réponses API brutes             |
| **Auth**         | Login utilisateur, token créé, mot de passe changé | Validation JWT, décisions du middleware          | --                              |
| **API**          | Serveur en écoute, route enregistrée               | Détails de traitement de requête                 | Chaque requête/réponse          |
| **WebSocket**    | Client connecté/déconnecté                         | Souscription topic, message envoyé               | Chaque frame                    |
| **Event Bus**    | --                                                 | --                                               | Chaque événement émis           |
| **Database**     | DB ouverte, migration appliquée                    | Exécution de requête, changements de schéma      | --                              |

### Conventions du logger

- **Nom de propriété** : utilisez `this.logger` dans les classes, `logger` dans les fonctions standalone. Jamais `this.log`, `log`, ou `console`.
- **Child loggers** : chaque module crée un child logger avec `{ module: "module-name" }` pour le filtrage.
- **Contexte structuré** : passez les données comme premier argument objet, le message comme second : `logger.info({ deviceId, status }, "Device status changed")`.
- **Données sensibles** : auto-redactées par la config pino (mots de passe, tokens, secrets, clés d'API). Ne loggez jamais des credentials manuellement.
- **Pas d'interpolation de chaîne dans les messages** : utilisez `logger.info({ count }, "Devices discovered")` plutôt que ``logger.info(`Discovered ${count} devices`)``.

---

## Référence du design system

Quand vous ajoutez ou modifiez des composants UI, suivez ces design tokens :

| Propriété                 | Valeur                                                       |
| ------------------------- | ------------------------------------------------------------ |
| **Police body**           | Inter                                                        |
| **Police mono**           | JetBrains Mono (valeurs, logs)                               |
| **Couleur primaire**      | `#1A4F6E` (ocean blue), hover : `#13405A`, light : `#E6F0F6` |
| **Couleur accent**        | `#D4963F` (amber), hover : `#BB8232`                         |
| **Espacement de base**    | 4px                                                          |
| **Border radius**         | 6px (boutons), 10px (cartes), 14px (modales)                 |
| **Taille de police body** | 14px (tableau de bord dense)                                 |
| **Valeurs de données**    | 28px (lisibles d'un coup d'œil)                              |
| **Icônes**                | Lucide React, stroke 1.5px                                   |

---

## Variables d'environnement

Tous les réglages sont optionnels avec des valeurs par défaut raisonnables, Sowel tourne sans configuration. Surchargez via `.env` au besoin :

| Variable          | Défaut                  | Notes                                                   |
| ----------------- | ----------------------- | ------------------------------------------------------- |
| `SQLITE_PATH`     | `./data/sowel.db`       | Chemin de la base SQLite                                |
| `API_PORT`        | `3000`                  | Port du serveur HTTP                                    |
| `API_HOST`        | `0.0.0.0`               | Adresse de bind                                         |
| `JWT_SECRET`      | auto-généré             | Persisté dans `data/.jwt-secret` au premier lancement   |
| `JWT_ACCESS_TTL`  | `900`                   | TTL de l'access token en secondes (15 min)              |
| `JWT_REFRESH_TTL` | `2592000`               | TTL du refresh token en secondes (30 jours)             |
| `LOG_LEVEL`       | `info`                  | Niveau de log pino                                      |
| `CORS_ORIGINS`    | `*`                     | Origines autorisées séparées par des virgules           |
| `INFLUX_URL`      | `http://localhost:8086` | URL InfluxDB 2.x                                        |
| `INFLUX_TOKEN`    | auto-généré             | Persisté dans `data/.influx-token` au premier lancement |
| `INFLUX_ORG`      | `sowel`                 | Organisation InfluxDB                                   |
| `INFLUX_BUCKET`   | `sowel`                 | Bucket principal InfluxDB                               |

Les réglages d'intégration (MQTT, identifiants cloud, intervalles de polling) sont configurés depuis l'UI (Administration > Intégrations), pas depuis `.env`.

---

## Repo privé compagnon d'exploitation

Le dépôt public `sowel` ne contient rien de spécifique à une installation donnée : pas d'hôtes, pas d'IP, pas de cibles SSH, pas d'identifiants. Gardez cette règle dans vos contributions.

Si vous exploitez votre propre déploiement Sowel et voulez y brancher l'outillage développeur (swap dev/prod, instance shadow, screenshots de docs, contexte pour agents IA), créez votre propre dépôt compagnon **privé**, nommé par convention `sowel-ops`, et clonez-le à côté de votre checkout `sowel` :

```
workspace/
├── sowel/          # dépôt public (le nom du clone importe peu)
└── sowel-ops/      # votre dépôt privé : hôtes, cibles SSH, contexte agent
```

Il suffit d'au plus deux fichiers :

| Fichier         | Rôle                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ops.env`       | Vos hôtes et cibles SSH. Partez de [`scripts/ops.env.example`](https://github.com/mchacher/sowel/blob/main/scripts/ops.env.example). Sourcé automatiquement par `scripts/run-swap.sh` et `scripts/shadow-deploy.sh`. |
| `CLAUDE.ops.md` | Optionnel. Contexte privé pour les agents IA (topologie de production, accès aux logs, règles de sécurité). Importé par `CLAUDE.md` via `@../sowel-ops/CLAUDE.ops.md`.                                               |

Les deux points d'intégration se dégradent proprement : sans `sowel-ops`, les scripts d'exploitation refusent les opérations distantes avec une erreur claire et l'import de `CLAUDE.md` est simplement ignoré. Le développement local n'a besoin de rien de tout cela.

Bénéfices : les détails de votre installation sont versionnés et sauvegardés sur GitHub (en privé), tandis que le dépôt public reste réutilisable par tous.

---

## Structure du projet

Pour un schéma complet de la structure du projet et des détails d'architecture, voir [Vue d'ensemble de l'architecture](architecture.md).

---

## Roadmap de développement

V0.1 Devices -> V0.2 Zones -> V0.3 Equipments+Bindings -> V0.4 UI Home -> V0.5 Sensors -> V0.6 Zone Aggregation -> V0.7 Shutters -> V0.8 Recipes -> V0.9 Modes+Calendar -> V0.10 Integration Plugins (Z2M, Panasonic CC, MCZ Maestro, Netatmo HC) -> V0.11 Logging -> V0.12 Computed Data -> V0.13 History (InfluxDB) -> V1.0+ AI Assistant

---

## Checklist avant soumission

- [ ] `npx tsc --noEmit` passe (backend)
- [ ] `cd ui && npx tsc --noEmit` passe (frontend, si modifié)
- [ ] `npm test` passe
- [ ] Aucun appel `console.log`, utilisez le logger pino
- [ ] Logging structuré avec les bons niveaux (voir règles ci-dessus)
- [ ] Migrations ajoutées si changement de schéma
- [ ] Branche feature avec un nom descriptif
- [ ] La description de PR explique le "pourquoi"
