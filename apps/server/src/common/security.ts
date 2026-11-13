import { gzip } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

/** Security headers (the useful subset of what helmet sets; this is a JSON API, so the policy is strict). */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.removeHeader('X-Powered-By');
  if (env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  if (env.NOINDEX) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.path.startsWith('/api')) {
    // API answers: strict policy, never cached. (The web app's own pages and scripts get normal caching from the static handler.)
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

/**
 * Gzips large JSON answers. The state payload is hundreds of kilobytes of repetitive JSON and shrinks about
 * ten times, which is most of the first-load wait on a slow connection.
 */
export function gzipJson(req: Request, res: Response, next: NextFunction) {
  const accepts = String(req.headers['accept-encoding'] ?? '');
  if (!/\bgzip\b/.test(accepts)) return next();
  const send = res.send.bind(res);
  res.send = ((body?: unknown) => {
    const isText = typeof body === 'string' || Buffer.isBuffer(body);
    const type = String(res.getHeader('Content-Type') ?? '');
    if (!isText || res.headersSent || res.getHeader('Content-Encoding') || !type.includes('json') || (body as string | Buffer).length < 2048) {
      return send(body as never);
    }
    gzip(body as string | Buffer, (err, out) => {
      if (err) return send(body as never);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      send(out as never);
    });
    return res;
  }) as Response['send'];
  next();
}
