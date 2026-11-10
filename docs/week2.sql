-- Week 2: run in the Neon SQL editor if `npm run db:push` fails.
ALTER TABLE provinces ADD COLUMN IF NOT EXISTS disrupted_until timestamptz;

CREATE TABLE IF NOT EXISTS wars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  aggressor_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  defender_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  declared_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS wars_aggressor_idx ON wars (aggressor_id);
CREATE INDEX IF NOT EXISTS wars_defender_idx ON wars (defender_id);

CREATE TABLE IF NOT EXISTS battle_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  attacker_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  defender_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS battle_reports_attacker_idx ON battle_reports (attacker_id, created_at);
CREATE INDEX IF NOT EXISTS battle_reports_defender_idx ON battle_reports (defender_id, created_at);
