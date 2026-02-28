-- Migrate existing motion-light instances to motion-light-dimmable
-- when their lights are actually dimmable or color type.
UPDATE recipe_instances
SET recipe_id = 'motion-light-dimmable'
WHERE recipe_id = 'motion-light'
  AND id IN (
    SELECT ri.id
    FROM recipe_instances ri, json_each(json_extract(ri.params, '$.lights')) AS light
    JOIN equipments e ON e.id = light.value
    WHERE ri.recipe_id = 'motion-light'
      AND e.type IN ('light_dimmable', 'light_color')
  );

-- Strip brightness params from instances that stay on motion-light
-- (light_onoff equipment doesn't support brightness)
UPDATE recipe_instances
SET params = json_remove(
  json_remove(
    json_remove(
      json_remove(params, '$.morningEnd'),
      '$.morningStart'
    ),
    '$.morningBrightness'
  ),
  '$.brightness'
)
WHERE recipe_id = 'motion-light'
  AND (
    json_extract(params, '$.brightness') IS NOT NULL
    OR json_extract(params, '$.morningBrightness') IS NOT NULL
  );
