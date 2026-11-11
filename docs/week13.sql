-- Week 13: air patrols. Run once in the Neon SQL editor BEFORE restarting the server.
ALTER TABLE formations ADD COLUMN IF NOT EXISTS move_patrol boolean NOT NULL DEFAULT false;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS patrol_active boolean NOT NULL DEFAULT false;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS patrol_since timestamptz;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS patrol_settled_at timestamptz;
CREATE INDEX IF NOT EXISTS formations_patrol_idx ON formations (patrol_active);

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS damage integer NOT NULL DEFAULT 0;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS damage_updated_at timestamptz;
