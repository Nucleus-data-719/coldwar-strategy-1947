# Week 16: performance, security, closed beta

## What changed

**Speed**
- `GET /campaigns/:id/state` ran about a dozen database reads one after another. They now run together, so the call costs one round trip instead of twelve.
- Large JSON answers (the state is about 350 KB) are gzip-compressed, roughly ten times smaller on the wire.
- Sea routes use a priority queue instead of scanning every dot per step.
- AI countries decide four at a time (`AI_CONCURRENCY`), at most 40 per tick (`AI_MAX_PER_TICK`), and a slow batch is logged.
- The browser refreshes the map at most once every 1.5 seconds on server pushes (it used to refetch on every message).

**Timing**
- Every request is timed. Anything slower than `SLOW_REQUEST_MS` (500) is written to the log as `slow GET /api/campaigns/:id/state 200 812 ms`.
- `GET /api/metrics` with header `x-admin-token: <ADMIN_TOKEN>` lists every route with count, errors, average, p50, p95 and max. Empty `ADMIN_TOKEN` turns it off.
- `GET /api/health` checks the database, for your host's uptime monitor.

**Security review**

| Area | State |
|---|---|
| Input validation | Every request body goes through a zod schema; every id in a path is a checked UUID. Bodies over 64 KB are refused. |
| Rate limits | 240 requests per minute per address overall, 10 per minute for sign-in and register (`RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN`). Behind a proxy set `TRUST_PROXY=1`, or every player shares one address. |
| Sessions | httpOnly cookie, `secure` and `sameSite=none` in production, 7-day token, signature algorithm pinned to HS256. Passwords are bcrypt (cost 12). |
| Headers | nosniff, no framing, no referrer, strict CSP for the API, HSTS in production, no `X-Powered-By`. |
| Closed beta | Set `BETA_INVITE_CODES=code1,code2` and registering needs one. Leave empty to open registration. |
| Secrets | Only in `.env`; `ADMIN_TOKEN` and `JWT_SECRET` should be long random strings. |

**Not done, on purpose:** two-factor login, email verification and password reset need an email service; they belong with the payments week. Cross-site request forgery is covered by `sameSite` plus the CORS allow-list.

## Backups (do this before inviting testers)

Neon keeps point-in-time history (the free plan keeps a short window; paid plans keep longer).
1. In the Neon console, open your project, then **Branches**. Create a branch named `backup-before-beta` now; a branch is an instant copy.
2. Before every deploy that changes the database, create another branch.
3. Weekly, export a plain dump too (needs `pg_dump`): `pg_dump "$DATABASE_URL_DIRECT" -Fc -f cw-$(date +%F).dump`
4. To restore, create a new branch from the point in time you want and put its connection string in `.env`.

## Load test

1. In `.env` raise the limits for the test only: `RATE_LIMIT_PER_MIN=100000` and `AUTH_RATE_LIMIT_PER_MIN=1000`, plus `ADMIN_TOKEN=somesecret`. Restart the server.
2. Run: `node scripts/load-test.mjs --url http://localhost:3000 --players 50 --minutes 2`
   (add `--invite CODE` if beta codes are on). Fifty players are spread over two campaigns because one campaign has 40 playable countries.
3. The script prints calls, p50, p95, max, errors and average size per route, and says PASS when there are no server errors and every route's p95 is under one second.
4. Look at `GET /api/metrics` and the server log for `slow` lines. Put the limits back afterwards.
5. Test accounts are named `lt_<run>_<n>`. Remove them with `docs/week16-cleanup.sql`.

Run it against the hosted server too, not only your computer; the database round trip is what dominates.

## Inviting testers

1. Choose 10 to 20 people; give each their own code, or one shared code: `BETA_INVITE_CODES=cold1947,cold1947b`.
2. Send them the web address, the code, and `docs/PLAYTEST.md`.
3. Tell them the **Feedback** button in the game goes straight to you. Read it daily.
4. Watch `/api/metrics` the first evening for slow routes.
