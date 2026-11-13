import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

const COOKIE = 'cw_gate';
const DAY = 86_400_000;

const token = () => createHmac('sha256', env.JWT_SECRET).update(`gate:${env.SITE_PASSWORD}`).digest('hex');
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const PAGE = (msg: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Cold War 1950</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1520;color:#e8edf2;font:16px/1.5 system-ui,sans-serif}
form{width:min(340px,86vw);padding:28px;border:1px solid #2a3a4c;border-radius:10px;background:#101e2c}
h1{margin:0 0 4px;font-size:20px;letter-spacing:.04em}p{margin:0 0 16px;color:#9fb0c0;font-size:14px}
input,button{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:6px;border:1px solid #2a3a4c;font:inherit}
input{background:#0b1520;color:#e8edf2;margin-bottom:10px}button{background:#e0b341;color:#1a1405;border:0;font-weight:600;cursor:pointer}
.e{color:#ff8a7a;font-size:14px;margin:0 0 10px}
</style></head><body><form method="post" action="/__gate"><h1>COLD WAR 1950</h1><p>Private test. Enter the access password.</p>
${msg ? `<p class="e">${msg}</p>` : ''}<input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password"><button type="submit">Enter</button></form></body></html>`;

const attempts = new Map<string, { n: number; reset: number }>();

/**
 * One shared password in front of the whole site while it is a private test. Nothing (page, scripts, API) is served
 * without the cookie it sets, except the health check the host uses. Off when SITE_PASSWORD is empty.
 */
export function siteGate() {
  const form = express.urlencoded({ extended: false, limit: '2kb' });
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.SITE_PASSWORD) return next();
    if (req.path === '/api/health') return next();
    if (req.path === '/robots.txt') return next();

    if (req.method === 'POST' && req.path === '/__gate') {
      return form(req, res, () => {
        const ip = req.ip ?? 'x';
        const now = Date.now();
        const a = attempts.get(ip);
        if (!a || a.reset < now) attempts.set(ip, { n: 1, reset: now + 60_000 });
        else a.n++;
        if ((attempts.get(ip)?.n ?? 0) > 8) return res.status(429).type('html').send(PAGE('Too many tries. Wait a minute.'));
        const given = String((req.body as { password?: string } | undefined)?.password ?? '');
        if (same(createHmac('sha256', 'p').update(given).digest('hex'), createHmac('sha256', 'p').update(env.SITE_PASSWORD).digest('hex'))) {
          res.cookie(COOKIE, token(), { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * DAY, path: '/' });
          return res.redirect(303, '/');
        }
        return res.status(401).type('html').send(PAGE('Wrong password.'));
      });
    }

    const cookie = (req.cookies as Record<string, string> | undefined)?.[COOKIE];
    if (cookie && same(cookie, token())) return next();
    if (req.method === 'GET' && !req.path.startsWith('/api')) return res.status(401).type('html').send(PAGE(''));
    return res.status(401).json({ message: 'Private test site' });
  };
}
