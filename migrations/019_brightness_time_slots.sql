-- Migrate morningStart/morningEnd/morningBrightness to slot1Start/slot1End/slot1Brightness
UPDATE recipe_instances
SET params = json_remove(
  json_remove(
    json_remove(
      json_set(
        json_set(
          json_set(params,
            '$.slot1Start', json_extract(params, '$.morningStart')),
          '$.slot1End', json_extract(params, '$.morningEnd')),
        '$.slot1Brightness', json_extract(params, '$.morningBrightness')),
      '$.morningStart'),
    '$.morningEnd'),
  '$.morningBrightness')
WHERE recipe_id = 'motion-light-dimmable'
  AND json_extract(params, '$.morningStart') IS NOT NULL;
