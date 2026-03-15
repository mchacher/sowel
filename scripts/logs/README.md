# Scripts Logs

Scripts d'analyse et récupération des logs Sowel via l'API REST.

## `fetch-logs.py`

Récupère les logs depuis le ring buffer en mémoire (même source que le log viewer UI).

```bash
python3 scripts/logs/fetch-logs.py [module] [level] [limit]
```

Exemples :

```bash
python3 scripts/logs/fetch-logs.py netatmo-poller debug 50
python3 scripts/logs/fetch-logs.py energy-api info 20
python3 scripts/logs/fetch-logs.py history-writer warn 100
```

### Modules courants

| Module            | Description                       |
| ----------------- | --------------------------------- |
| `netatmo-poller`  | Polling Netatmo (energy, devices) |
| `energy-api`      | Route API energy                  |
| `history-writer`  | Écritures InfluxDB                |
| `device-manager`  | Gestion des devices               |
| `equipment-mgr`   | Gestion des equipments            |
| `scenario-engine` | Moteur de scénarios               |
