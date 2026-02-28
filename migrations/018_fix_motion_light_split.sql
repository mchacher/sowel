-- Corrective migration: move instances back to motion-light
-- if none of their lights are dimmable/color.
-- This fixes instances wrongly migrated by the original 017 migration
-- which used brightness params presence instead of equipment type.
UPDATE recipe_instances
SET recipe_id = 'motion-light',
    params = json_remove(
      json_remove(
        json_remove(
          json_remove(params, '$.morningEnd'),
          '$.morningStart'
        ),
        '$.morningBrightness'
      ),
      '$.brightness'
    )
WHERE recipe_id = 'motion-light-dimmable'
  AND id NOT IN (
    SELECT ri.id
    FROM recipe_instances ri, json_each(json_extract(ri.params, '$.lights')) AS light
    JOIN equipments e ON e.id = light.value
    WHERE ri.recipe_id = 'motion-light-dimmable'
      AND e.type IN ('light_dimmable', 'light_color')
  );
