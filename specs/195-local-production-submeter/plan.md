# Spec 195 — Plan

1. Migration `041_local_production.sql`: `equipments.local_production`,
   `submeter_integrator_state.pending_production_wh`.
2. `Equipment.localProduction` (types, manager row/update, PUT schema and
   `LocalProductionNotApplicable` validation on the resulting state).
3. `PowerSubmeterIntegrator`: `splitTrapezoidWh`, production pending, `production`
   delta written and emitted at flush.
4. `SelfConsumptionWriter`: role `solar` for `production` from a flagged meter.
5. `/energy/history`: production query reads flagged meters' `production`.
6. Zone aggregator: unchanged, the signed sum already shows the export.
7. UI: metering panel toggle + i18n, `readSubmeterReading` clamp,
   `localProductionW`, Live diagram solar.
8. Tests on every step; user doc (energy EN/FR), API reference EN/FR, specs
   indexes.
