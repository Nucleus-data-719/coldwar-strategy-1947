import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const COOKIE_NAME = 'cw_token';
export const COOKIE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export interface TokenPayload {
  sub: string;
  u: string;
}

@Injectable()
export class TokenService {
  sign(user: { id: string; username: string }): string {
    return jwt.sign({ sub: user.id, u: user.username } satisfies TokenPayload, env.JWT_SECRET, {
      expiresIn: '7d',
    });
  }

  verify(token: string): TokenPayload | null {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      return typeof payload.sub === 'string' ? payload : null;
    } catch {
      return null;
    }
  }
}
