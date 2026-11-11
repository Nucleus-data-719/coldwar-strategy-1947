-- Map rebuild (1947 borders, 2,351 provinces, 40 playable countries, new resource: wood).
-- Run once in the Neon SQL editor, then restart the server. (npm run db:push does the first line too.)
-- It deletes ALL campaigns and everything in them (armies, research, generals, alliances...) because
-- the old province keys no longer exist. Accounts (users) are kept. A fresh campaign is created on the next start.
ALTER TABLE countries ADD COLUMN IF NOT EXISTS wood double precision NOT NULL DEFAULT 0;
DELETE FROM campaigns;
