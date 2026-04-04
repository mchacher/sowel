# 056 — Docker InfluxDB Auto-Configuration

## Summary

Make InfluxDB a first-class, auto-configured part of the Sowel Docker stack. The user runs `docker-compose up -d` and both Sowel + InfluxDB are running with the token shared automatically — zero manual configuration.

## Acceptance Criteria

- [ ] docker-compose.yml includes InfluxDB service (not optional)
- [ ] Shared token between Sowel and InfluxDB via environment variable
- [ ] Sowel connects to InfluxDB via Docker service name (`http://influxdb:8086`)
- [ ] User never has to copy/paste a token
- [ ] Buckets + downsampling tasks auto-created on startup (already works)
- [ ] Energy buckets + aggregation tasks auto-created (already works)
- [ ] Health endpoint reports InfluxDB connection status

## docker-compose.yml

```yaml
services:
  sowel:
    image: ghcr.io/mchacher/sowel:latest
    environment:
      - INFLUX_URL=http://influxdb:8086
      - INFLUX_TOKEN=sowel-auto-token
      - INFLUX_ORG=sowel
      - INFLUX_BUCKET=sowel

  influxdb:
    image: influxdb:2.7
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=sowel
      - DOCKER_INFLUXDB_INIT_PASSWORD=sowel-auto-password
      - DOCKER_INFLUXDB_INIT_ORG=sowel
      - DOCKER_INFLUXDB_INIT_BUCKET=sowel
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=sowel-auto-token
```

Both services share the same token value. InfluxDB uses it as admin token on init; Sowel uses it to connect.
