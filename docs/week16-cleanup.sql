-- Removes the accounts and campaigns made by scripts/load-test.mjs.
DELETE FROM campaigns WHERE name LIKE 'Load test %';
DELETE FROM users WHERE username LIKE 'lt\_%' ESCAPE '\';
