-- Week 14: naval orders, ranges and mines. Run once in the Neon SQL editor BEFORE restarting the server.
ALTER TABLE formations ADD COLUMN IF NOT EXISTS sea_node integer;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS sea_path jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS sea_started_at timestamptz;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS sea_arrives_at timestamptz;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS sea_dest_province_id uuid REFERENCES provinces(id) ON DELETE SET NULL;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS attack_target_id uuid;
CREATE INDEX IF NOT EXISTS formations_sea_idx ON formations (sea_arrives_at);

CREATE TABLE IF NOT EXISTS sea_mines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  node integer NOT NULL,
  strength integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sea_mines_campaign_idx ON sea_mines (campaign_id, node);

-- Week 14 follow-up: delayed movement
ALTER TABLE formations ADD COLUMN IF NOT EXISTS move_hold_until timestamptz;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS move_hold_fraction double precision;
