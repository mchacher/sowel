# Scripts utilitaires

## `logs/`

Scripts d'analyse et récupération des logs Sowel.
Voir [logs/README.md](logs/README.md).

## `energy/`

Scripts de maintenance pour l'infrastructure energy InfluxDB + Netatmo.
Voir [energy/README.md](energy/README.md).

## Shadow instance

- `shadow-deploy.sh` — lifecycle d'une instance shadow (build, seed depuis prod, destroy).
- `run-swap.sh shadow` — toggle on/off au quotidien.
- Doc : [howto-shadow.md](howto-shadow.md).
