# Guide de développement de recettes

Comment créer une nouvelle recette pour Sowel.

## Architecture

Une recette est un modèle d'automatisation réutilisable. Les utilisateurs instancient les recettes avec des paramètres (slots) pour créer des instances d'automatisation en cours d'exécution.

Depuis les specs 053/054, **les recettes sont des packages externes dans leurs propres dépôts GitHub** (par ex. `mchacher/sowel-recipe-schedule-on-off`) ; rien de spécifique à une recette ne vit dans le repo Sowel. Un package de recette embarque un `manifest.json` (`type: "recipe"`) et un `dist/index.js` compilé exportant une factory `createRecipe()`. Le `RecipeLoader` l'importe au démarrage et enregistre la définition retournée.

```
Package de recette (repo GitHub, release sowel-recipe-<id>-<version>.tar.gz)
  -> PackageManager installe -> RecipeLoader importe dist/index.js
    -> createRecipe(): RecipeDefinition -> RecipeManager.registerExternal()
      -> GET /api/v1/recipes -> l'UI liste les recettes disponibles
        -> L'utilisateur crée une instance avec des params
          -> validate() -> createInstance() retourne { stop }
            -> La recette s'abonne aux événements de l'EventBus et réagit
```

La distribution suit les mêmes conventions que les plugins d'intégration (tarball de release, entrée de registre ou source personnelle) ; voir [plugin-development.md](plugin-development.fr.md). Pour votre propre instance, la boucle la plus rapide est une **source personnelle** (spec 136) : ajoutez votre dépôt sur la page Plugins, installez via la confirmation TOFU, publiez une release par itération. Le repo Sowel fournit aussi un skill Claude Code, `sowel-recipe-dev`, qui déroule tout ce guide.

## Créer une recette

### 1. Créer le dépôt du package

Nommage : `sowel-recipe-<id>`. Structure :

```
sowel-recipe-<id>/
  manifest.json        # id, type: "recipe", name, version, icon, repo, i18n, sowelVersion
  package.json         # "type": "module", scripts build / test
  tsconfig.json        # module + moduleResolution: "NodeNext", outDir dist
  src/index.ts         # exporte createRecipe()
  src/index.test.ts    # vitest
```

Le champ `repo` du manifest doit être égal au dépôt GitHub qui sert le package, et l'`id` ne doit pas entrer en collision avec une entrée du registre (les deux sont vérifiés à l'installation depuis la spec 136).

### 2. Exporter la factory

Les packages de recettes n'importent jamais le cœur de Sowel : ils recopient les quelques types nécessaires (depuis `src/shared/types.ts` : `RecipeDefinition`, `RecipeSlotDef`, `RecipeInstanceHandle`) et exportent une factory :

```typescript
export function createRecipe(): RecipeDefinition {
  return {
    id: "my-recipe",
    name: "My Recipe", // anglais (fallback)
    description: "What it does",
    slots: [
      // ...voir la section Slots
    ],
    i18n: {
      // ...voir la section Traductions
    },
    validate(params, ctx) {
      // Throw avec un message clair si les params sont invalides
    },
    createInstance(params, ctx) {
      // S'abonner aux événements, armer les timers...
      return {
        stop() {
          // Annuler chaque timer, tout désabonner (doit être idempotent)
        },
      };
    },
  };
}
```

`RecipeManager` appelle `createInstance()` par instance en cours ; le `stop()` du handle retourné est invoqué à la désactivation, à la modification des params (stop -> validate -> createInstance), à la mise à jour de la recette, et à l'arrêt du moteur.

### 3. Écrire des tests

Créez `src/index.test.ts` dans le dépôt de la recette (vitest). Suivez le pattern de `sowel-recipe-schedule-on-off` :

- Un faux `ctx` (log, state, eventBus avec capture, accès aux équipements)
- Faux timers (`vi.useFakeTimers()`)
- Test de la validation, du traitement des événements, du comportement des timers, et du nettoyage complet par `stop()`

## Slots

Les slots définissent les paramètres que les utilisateurs configurent à la création d'une instance.

```typescript
interface RecipeSlotDef {
  id: string; // Unique within recipe (e.g. "lights", "timeout")
  name: string; // English label (fallback)
  description: string; // English description (fallback)
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean";
  required: boolean;
  list?: boolean; // Allow multiple values (equipment lists)
  defaultValue?: unknown;
  constraints?: {
    equipmentType?: EquipmentType | EquipmentType[]; // Filter equipment selector
    min?: number;
    max?: number;
    crossZone?: boolean; // Allow picking equipments from any zone
    includeDescendants?: boolean; // Widen candidates to descendant zones
  };
}
```

### Portée d'un slot equipment : `crossZone` et `includeDescendants`

Par défaut, le picker d'un slot `equipment` est filtré sur les équipements qui vivent dans la `zone` de la recette. Deux contraintes élargissent cet ensemble :

| Contrainte           | Effet                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crossZone`          | Permet à l'utilisateur de choisir un équipement depuis **n'importe quelle** zone du système. Utile pour des triggers comme "le portail" qui appartient sémantiquement à une zone différente de l'action.      |
| `includeDescendants` | Élargit l'ensemble candidat à la zone de la recette **plus toutes les zones descendantes**. Utile quand les actionneurs (par ex. les lumières) vivent dans des sous-zones plutôt que directement dans `zone`. |

Les deux flags sont indépendants : `crossZone` ignore complètement la portée de zone, alors que `includeDescendants` conserve la portée enracinée à la zone mais inclut récursivement les enfants. Un picker avec les deux activés se comporte comme `crossZone` seul.

```typescript
slots: RecipeSlotDef[] = [
  { id: "zone", name: "Zone", description: "...", type: "zone", required: true },
  {
    id: "trigger",
    name: "Trigger equipment",
    description: "Equipment whose state change fires the recipe",
    type: "equipment",
    required: true,
    constraints: { crossZone: true }, // can be in another zone
  },
  {
    id: "lights",
    name: "Lights",
    description: "Lights to turn on",
    type: "equipment",
    required: true,
    list: true,
    constraints: {
      equipmentType: ["light_onoff", "light_dimmable"],
      includeDescendants: true, // lights may live in subzones of `zone`
    },
  },
];
```

**Patterns courants de slot :**

| Slot type   | Contrôle UI       | Format de valeur                      |
| ----------- | ----------------- | ------------------------------------- |
| `zone`      | Auto-rempli       | UUID de zone                          |
| `equipment` | Liste/cases       | UUID d'équipement (ou UUID[] si list) |
| `duration`  | Numérique + min   | `"10m"`, `"30s"`, `"1h"`              |
| `number`    | Saisie numérique  | Valeur numérique                      |
| `time`      | Sélecteur d'heure | Chaîne `"HH:MM"` (24 h)               |
| `boolean`   | Bascule           | `true` / `false`                      |

## Traductions (i18n)

Les traductions voyagent avec la recette, pas dans les fichiers de locale de la plateforme. Cela permet de hot-loader des recettes sans modifier `fr.json`/`en.json`.

### Comment ça marche

Chaque recette définit un record `i18n` qui mappe les codes de langue à des noms, descriptions et libellés de slot traduits :

```typescript
override readonly i18n: Record<string, RecipeLangPack> = {
  fr: {
    name: "Ma recette",
    description: "Ce qu'elle fait",
    slots: {
      lights: { name: "Lumieres", description: "Lumieres a controler" },
      timeout: { name: "Delai", description: "Delai avant extinction" },
    },
  },
  // Add more languages as needed
};
```

### Définitions de types

```typescript
interface RecipeLangPack {
  name: string;
  description: string;
  slots?: Record<string, RecipeSlotI18n>; // Keyed by slot id
}

interface RecipeSlotI18n {
  name: string;
  description: string;
}
```

### Résolution dans l'UI

Le frontend utilise des helpers depuis `ui/src/lib/recipe-i18n.ts` :

```typescript
recipeName(recipe, lang); // Recipe name with fallback
recipeDescription(recipe, lang); // Recipe description with fallback
recipeSlotName(recipe, slot, lang); // Slot name with fallback
recipeSlotDescription(recipe, slot, lang); // Slot description with fallback
```

Chaîne de fallback : `i18n[lang].name -> recipe.name` (anglais embarqué dans la classe).

### Ajouter une nouvelle langue

Ajoutez une nouvelle clé au record `i18n` dans la classe de votre recette. Aucun fichier de plateforme à modifier.

## RecipeContext

L'objet `ctx` injecté dans `validate()` et `createInstance()` fournit :

| Propriété          | Type               | Usage                                                                                 |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------- |
| `eventBus`         | `EventBus`         | S'abonner aux événements typés                                                        |
| `equipmentManager` | `EquipmentManager` | Interroger l'état d'un équipement, exécuter des ordres                                |
| `zoneManager`      | `ZoneManager`      | Interroger les définitions de zones                                                   |
| `zoneAggregator`   | `ZoneAggregator`   | Interroger les données agrégées de zone                                               |
| `state`            | `RecipeStateStore` | Persister un état clé-valeur (survit au redémarrage, auto-notifie l'UI sur mutations) |
| `log(msg, level?)` | fonction           | Écrire dans le journal d'exécution de la recette                                      |

## Helpers partagés

Les packages de recettes accèdent aux utilitaires partagés via `ctx.helpers` (interface `RecipeHelpers` dans `src/shared/types.ts`) :

| Helper                                                                         | Rôle                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `parseDuration(value)`, `formatDuration(ms)`                                   | Durées au format `"10m"` / `"30s"`                |
| `isAnyLightOn()`, `turnOnLights()`, `turnOffLights()`, `setLightsBrightness()` | Orchestration de lumières par ids d'équipements   |
| `getSunlight()`                                                                | Programmation solaire (spec 126), voir ci-dessous |

`getSunlight(): { sunrise, sunset, isDaylight }` retourne les heures de soleil courantes (`"HH:MM"`, offsets spec 023 appliqués). À coupler avec l'événement `sunlight.changed` pour se resynchroniser d'un jour à l'autre ; les champs sont `null` tant que les heures ne sont pas calculées ou sans coordonnées maison.

## Événements de l'Event Bus

Événements clés auxquels les recettes s'abonnent typiquement :

| Event                    | Payload                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `zone.data.changed`      | `{ zoneId, aggregatedData: { motion, luminosity, ... } }`                                                        |
| `equipment.data.changed` | `{ equipmentId, alias, value, category }`                                                                        |
| `sunlight.changed`       | (sans payload) : heures de soleil recalculées (nouveau jour / transition) ; lire via `ctx.helpers.getSunlight()` |

## Cycle de vie

1. **Chargement** : `RecipeLoader.loadAll()` importe chaque package installé et activé (`dist/index.js`) et enregistre la définition de `createRecipe()` via `RecipeManager.registerExternal()`
2. **Instanciation** : l'utilisateur crée via l'API → `validate()` → persisté en SQLite → `createInstance()`
3. **Restauration** : au redémarrage moteur, les instances activées sont chargées depuis la DB et `createInstance()` est appelé
4. **Mise à jour des params** : `stop()` → mise à jour des params en DB → `validate()` → `createInstance()` avec les nouveaux params
5. **Mise à jour de la recette** : nouvelle version du package installée → définition ré-enregistrée → les instances en cours sont redémarrées pour exécuter la nouvelle version (issue #349)
6. **Suppression** : `stop()` → retiré de la DB (cascade sur state + logs)

## Recettes existantes

Le catalogue vivant est `plugins/registry.json` dans le repo Sowel (chaque entrée `"type": "recipe"`, un dépôt GitHub par recette). Bons exemples à copier :

| Dépôt                          | Illustre                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| `sowel-recipe-schedule-on-off` | Timers, bornes solaires (`getSunlight`), slots select, i18n, tests |
| `sowel-recipe-state-watch`     | Surveillance générique d'une clé de donnée avec alarme             |
| `sowel-recipe-motion-light`    | Pattern classique capteur vers actionneur avec délai               |

## Checklist

- [ ] Dépôt externe `sowel-recipe-<id>` avec `manifest.json` (`type: "recipe"`, `repo` égal au dépôt GitHub) et `dist/index.js` exportant `createRecipe()`
- [ ] La définition porte id, name, description, slots, i18n (FR + EN)
- [ ] `validate()` vérifie tous les params, lève une erreur si invalide
- [ ] `createInstance()` s'abonne aux événements, stocke les unsubs ; déclencheurs protégés contre les re-déclenchements (`equipment.data.changed` peut re-émettre une valeur inchangée : mémoriser la dernière valeur vue et ne réagir qu'aux vraies transitions)
- [ ] `stop()` annule tous les timers et désabonne (idempotent)
- [ ] Tests écrits et passants dans le dépôt de la recette (`npm test`), `npm run build` propre
- [ ] Tarball `sowel-recipe-<id>-<version>.tar.gz` attaché à la release GitHub `v<version>`, version du manifest égale au tag
- [ ] Installée et testée sur une instance réelle via une source personnelle (spec 136) ou une entrée de registre
