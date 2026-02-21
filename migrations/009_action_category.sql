-- Reclassify action properties from generic to action category
UPDATE device_data SET category = 'action' WHERE key = 'action' AND category = 'generic';
