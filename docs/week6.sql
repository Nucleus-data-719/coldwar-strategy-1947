-- Week 6: generals. Run once in the Neon SQL editor BEFORE restarting the server.
CREATE TABLE IF NOT EXISTS generals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  general_id text NOT NULL,
  unlocked boolean NOT NULL DEFAULT false,
  fragments integer NOT NULL DEFAULT 0,
  xp integer NOT NULL DEFAULT 0,
  deployed_formation_id uuid REFERENCES formations(id) ON DELETE SET NULL,
  locked_until timestamptz,
  ability_active_until timestamptz,
  ability_ready_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS generals_country_general_idx ON generals (country_id, general_id);
CREATE UNIQUE INDEX IF NOT EXISTS generals_deployed_idx ON generals (deployed_formation_id);

CREATE TABLE IF NOT EXISTS general_claims (
  country_id uuid PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
  last_claim_at timestamptz NOT NULL
);
