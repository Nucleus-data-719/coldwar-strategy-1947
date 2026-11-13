# Private test site on Railway (coldwar1950.com)

One Railway project holds two things: the **game** (this repo, built from the `Dockerfile`; it serves the web app and the API from one address) and a **PostgreSQL database** next to it. A shared password and invite codes keep everyone else out. Menu names on Railway change from time to time; look for the same words.

## 0. Check the build on your computer first (10 minutes)

The server image builds with the same commands, so any error shows here first.

```
npm install
npm run build
npm test
```

`npm run build` type-checks the web app and server. If it prints errors, send them to me before you deploy. A successful run also creates `package-lock.json` (keep it).

## 1. Put the project on GitHub (private)

1. Create a **private** repository on github.com (for example `cold-war-1950`).
2. In the project folder:
   ```
   git init
   git add .
   git commit -m "first deploy"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/cold-war-1950.git
   git push -u origin main
   ```
   `.env` is in `.gitignore`, so your secrets are not uploaded. Check that `.env` does not appear on GitHub.

## 2. Create the Railway project

1. railway.com, **New Project**, **Deploy from GitHub repo**, choose the repository. Railway finds `railway.json` and the `Dockerfile` by itself. The first build takes a few minutes.
2. In the same project press **New**, **Database**, **Add PostgreSQL**.
3. Region: in each service's **Settings** pick the **same region** for the game and the database, the one closest to you and your testers (for Pakistan, a Europe region is usually the closest). The database must be in the same region as the game: that is what removes the slowness.

## 3. Variables (game service, **Variables** tab)

| Name | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (use the reference button and pick the Postgres service) |
| `JWT_SECRET` | a long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SITE_PASSWORD` | the password you will give testers |
| `BETA_INVITE_CODES` | codes for accounts, comma separated, for example `ALPHA-7QK2,ALPHA-M4TX` |
| `ADMIN_TOKEN` | another long random string (for `/api/metrics`) |
| `TRUST_PROXY` | `1` |
| `CORS_ORIGIN` | `https://test.coldwar1950.com` |
| `NOINDEX` | `true` |
| `GAME_SPEED` | `1` for real time, `60` to test quickly (one real minute = one game hour) |
| `ALLOW_CAMPAIGN_CREATION` | `true` |

Leave `PORT` alone: Railway sets it. After saving, Railway redeploys.

The database tables are created automatically at every start (`drizzle-kit push`). This is fine for a test site. Before the public launch we will switch to proper migrations.

## 4. First check

1. In the game service, **Settings**, **Networking**, **Generate Domain**. Open `https://<that-address>/api/health`. You should see `{"ok":true,...}`. This URL works without the password.
2. Open the address itself: you get the password page. After the password, the game loads. Register with one of your invite codes.

If the deploy fails, open the build or deploy log. The last red lines say why; send them to me.

## 5. Your domain

Use a **sub-domain** for the test: `test.coldwar1950.com`. The bare `coldwar1950.com` stays empty (or a "coming soon" page) until release.

1. Game service, **Settings**, **Networking**, **Custom Domain**, add `test.coldwar1950.com`. Railway shows a **CNAME** value (and sometimes a TXT record).
2. At your domain registrar (or Cloudflare), DNS settings, add exactly what Railway shows: type `CNAME`, name `test`, target the value Railway gave.
3. Wait a few minutes up to an hour. Railway issues the HTTPS certificate by itself. Then `https://test.coldwar1950.com` works. If you use Cloudflare, set the record to **DNS only** (grey cloud) while it verifies.

## 6. Giving testers access

Send each tester: the address, the site password, and an invite code. Anyone without the password sees only the password page. Search engines are told not to list it (`robots.txt` and headers).

## 7. Everyday use

- **Updating:** push to GitHub; Railway rebuilds and redeploys. The game clock runs on the server, so keep the service always on (do not enable sleeping/serverless for the game service).
- **Speed check:** Railway logs show `slow ...` lines for requests over 500 ms. `GET /api/metrics` with the header `x-admin-token: <ADMIN_TOKEN>` lists timings per route.
- **Start fresh:** in the Postgres service, **Data**, run `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` and redeploy (all test data is deleted).
- **Cost:** Railway bills by use. A small game server plus a small database is typically a few dollars a month while the game is quiet. Check the **Usage** page after the first days.
- **Neon:** you no longer need it for the test site, and its transfer limit stops being a problem.
