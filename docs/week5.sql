-- Week 5: research. Run once in the Neon SQL editor BEFORE restarting the server.
CREATE TABLE IF NOT EXISTS research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  tech_id text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completes_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS research_country_tech_idx ON research (country_id, tech_id);
CREATE INDEX IF NOT EXISTS research_due_idx ON research (status, completes_at);
