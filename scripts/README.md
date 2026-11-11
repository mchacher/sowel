# Scripts utilitaires

## `logs/`

Scripts d'analyse et récupération des logs Sowel.
Voir [logs/README.md](logs/README.md).

## `energy/`

Scripts de maintenance pour l'infrastructure energy InfluxDB + Netatmo.
Voir [energy/README.md](energy/README.md).

## `tariffs/`

Fichier de prix de l'électricité (spec 203), à lancer avec `npx tsx` :

- `update-edf-tarif-bleu.ts` — reconstruit les lignes EDF Tarif Bleu de `tariffs/electricity-prices.json` à partir de l'open data CRE (lancé chaque nuit par le workflow `Tariffs`).
- `check.ts` — vérifie le fichier commité (format, tri, unicité, bornes), lancé en CI.

## Shadow instance

- `shadow-deploy.sh` — lifecycle d'une instance shadow (build, seed depuis prod, destroy).
- `run-swap.sh shadow` — toggle on/off au quotidien.
- Doc : [howto-shadow.md](howto-shadow.md).
