-- ============================================================
-- V0.8e: Standardize thermostat binding aliases
-- ============================================================
-- Equipment model provides a strict, integration-agnostic contract.
-- Device keys like "targetTemperature" must map to standard aliases
-- ("setpoint") so recipes can depend on them reliably.
-- ============================================================

-- Order bindings: targetTemperature → setpoint
UPDATE order_bindings SET alias = 'setpoint'
WHERE alias = 'targetTemperature'
  AND equipment_id IN (SELECT id FROM equipments WHERE type = 'thermostat');

-- Data bindings: targetTemperature → setpoint
UPDATE data_bindings SET alias = 'setpoint'
WHERE alias = 'targetTemperature'
  AND equipment_id IN (SELECT id FROM equipments WHERE type = 'thermostat');

-- Data bindings: insideTemperature → temperature
UPDATE data_bindings SET alias = 'temperature'
WHERE alias = 'insideTemperature'
  AND equipment_id IN (SELECT id FROM equipments WHERE type = 'thermostat');
