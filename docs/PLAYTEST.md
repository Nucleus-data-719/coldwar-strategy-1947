# First shared test (Week 4)

Goal: three people play the same campaign for an evening, and every desync or confusing screen is logged.

## Before the evening
1. Apply `docs/week4.sql` in the Neon SQL editor (adds the feedback table and clears old placeholder-map campaigns), then restart `npm run dev`. A fresh campaign "Classic Cold War 1947" is created on start.
2. In `.env` set `GAME_SPEED=60` so an hour of game time takes a minute. Buildings, marches, recruiting and production all follow it. Use `GAME_SPEED=1` to feel the real pace.
3. Make the game reachable for your friends. Easiest: a tunnel.
   - `npx cloudflared tunnel --url http://localhost:5173` (or `ngrok http 5173`) prints a public address. Send it to your friends.
   - Same Wi-Fi instead: open `http://<your-computer-IP>:5173`.
   Only port 5173 needs to be shared: it forwards `/api` and live updates to the server, so logins work without any CORS settings.
4. Everyone registers, joins the same campaign and picks a different country.

## What to try (in this order)
1. Everyone builds something, then recruits (Recruitment Center) and watches resources change.
2. Open the three map modes (Political, Resources, Terrain) and find the nearest oil.
3. Send an army to a neighbouring AI country's province: declare war, attack, read the battle report.
4. Two players declare war on each other and fight while the third watches the notifications.
5. Build a Military Factory and queue tanks; run out of oil on purpose.
6. Everyone closes the browser for 5 minutes. When you return, marches and queues must have finished.

## Logging problems
Use **Report a problem** (top bar) the moment something is confusing, wrong or slow. The screen, selected province, browser and recent errors are attached. Read them afterwards in the Neon SQL editor:

```sql
SELECT f.created_at, u.username, f.message, f.context
FROM feedback f LEFT JOIN users u ON u.id = f.user_id
ORDER BY f.created_at DESC;
```

Also write down: anything that looked different on two screens at the same time (a desync), anything you could not find, and anything that took more than three clicks.
