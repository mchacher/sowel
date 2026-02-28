-- Rename gate order alias from "toggle" to "command" (abstraction cleanup)
UPDATE order_bindings SET alias = 'command'
WHERE alias = 'toggle'
  AND equipment_id IN (SELECT id FROM equipments WHERE type = 'gate');
