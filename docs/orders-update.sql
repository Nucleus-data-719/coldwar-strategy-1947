-- Army orders update: spot inside a province, and Assign Front Line.
ALTER TABLE formations ADD COLUMN IF NOT EXISTS rest_x double precision;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS rest_y double precision;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS front_country_id uuid;
