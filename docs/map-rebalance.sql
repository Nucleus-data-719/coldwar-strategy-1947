-- Map rebalance: the world map changed (166 provinces, fair country sizes), so campaigns made
-- on the old map cannot be played any more. Run this once in the Neon SQL editor, then restart.
-- It deletes ALL campaigns and everything in them (armies, research, generals, alliances...).
-- Accounts (users) are kept. A fresh campaign is created automatically on the next start.
DELETE FROM campaigns;
