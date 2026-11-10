-- Week 7: diplomacy and alliances. Run once in the Neon SQL editor BEFORE restarting the server.
CREATE TABLE IF NOT EXISTS relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_a uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  country_b uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  opinion integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS relations_pair_idx ON relations (country_a, country_b);

CREATE TABLE IF NOT EXISTS alliances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_a uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  country_b uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  proposed_by uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS alliances_pair_idx ON alliances (country_a, country_b);

CREATE TABLE IF NOT EXISTS war_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  ally_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  defender_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  aggressor_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  joins_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS war_calls_ally_target_idx ON war_calls (ally_id, defender_id, aggressor_id);
CREATE INDEX IF NOT EXISTS war_calls_due_idx ON war_calls (status, joins_at);
