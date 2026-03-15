# Scripts utilitaires

## `fetch-logs.py`

Récupère les logs Sowel via l'API REST (ring buffer en mémoire).

```bash
python3 scripts/fetch-logs.py [module] [level] [limit]
python3 scripts/fetch-logs.py netatmo-poller debug 50
python3 scripts/fetch-logs.py energy-api info 20
```

## `energy/`

Scripts de maintenance pour l'infrastructure energy InfluxDB + Netatmo.
Voir [energy/README.md](energy/README.md).
