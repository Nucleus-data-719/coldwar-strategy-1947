-- Week 4: run in the Neon SQL editor if `npm run db:push` fails.
CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at);

-- The new world map replaces the placeholder grid, so old campaigns cannot be played.
-- This deletes all campaigns (accounts are kept). The server creates a fresh default campaign on start.
DELETE FROM campaigns;

-- Read what testers reported:
-- SELECT f.created_at, u.username, f.message, f.context FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC;
