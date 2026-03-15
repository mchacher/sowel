# Scripts utilitaires

Scripts de maintenance pour l'infrastructure energy (InfluxDB + Netatmo).

## Energy — Backfill & Reconstruction

### `energy-backfill-range.ts`

Backfill des données energy depuis l'API Netatmo pour une plage de dates.
Écrit dans les buckets `energy-hourly` et `energy-daily` (pas le raw — rétention 7j).

```bash
npx tsx scripts/energy-backfill-range.ts 2025-06-01 2025-09-13
```

- Requête Netatmo `getMeasure` par jour (scale=30min)
- Rate limit : pause 3s tous les 10 jours
- Idempotent : supprime les données existantes avant réécriture

### `energy-aggregate-today.ts`

Re-agrège les données raw (bucket `sowel`) vers hourly + daily pour un jour donné.
Utile quand la task InfluxDB n'a pas encore rattrapé ou après une corruption.

```bash
npx tsx scripts/energy-aggregate-today.ts [YYYY-MM-DD]  # défaut: aujourd'hui
```

- Lit les points raw 30-min
- Supprime les données existantes dans hourly + daily pour ce jour
- Réécrit les agrégations propres

### `energy-rebuild-daily.ts`

Reconstruit le bucket `energy-daily` entièrement à partir du bucket `energy-hourly`.
Regroupe par date locale (CET/CEST).

```bash
npx tsx scripts/energy-rebuild-daily.ts
```

## Energy — Diagnostic

### `energy-scan-gaps.ts`

Parcourt le bucket `energy-daily` pour l'année 2025 et liste les jours manquants.
Vérifie aussi la cohérence hourly vs daily sur un échantillon.

```bash
npx tsx scripts/energy-scan-gaps.ts
```

### `energy-compare.ts`

Compare heure par heure les données du raw bucket (via `aggregateWindow`) et du hourly bucket.
Vérifie que les deux sources produisent les mêmes valeurs.

```bash
npx tsx scripts/energy-compare.ts
```

### `energy-raw-inspect.ts`

Affiche tous les points raw bruts pour un jour et les définitions Flux des tasks InfluxDB.

```bash
npx tsx scripts/energy-raw-inspect.ts
```

## Energy — Administration InfluxDB

### `energy-fix-task.ts`

Met à jour les tasks InfluxDB (`sowel-energy-sum-hourly`, `sowel-energy-sum-daily`).
Applique les corrections de flux (timeSrc, lookback, etc.).

```bash
npx tsx scripts/energy-fix-task.ts
```

## Général

### `fetch-logs.py`

Récupère les logs Sowel via l'API REST (ring buffer en mémoire).

```bash
python3 scripts/fetch-logs.py [module] [level] [limit]
python3 scripts/fetch-logs.py netatmo-poller debug 50
python3 scripts/fetch-logs.py energy-api info 20
```

## Architecture InfluxDB Energy

```
sowel (raw)              — rétention 7 jours — points 30-min du poller Netatmo
  ↓ task: sowel-energy-sum-hourly (every: 1h, lookback: -7h)
sowel-energy-hourly      — rétention 2 ans   — somme par heure
  ↓ task: sowel-energy-sum-daily (every: 1d, lookback: -2d)
sowel-energy-daily       — rétention 10 ans  — somme par jour
```

Les tasks utilisent `timeSrc: "_start"` pour éviter le décalage +1h sur les timestamps.
