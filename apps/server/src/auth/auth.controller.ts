import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { parse } from '../common/zod';
import { AuthService } from './auth.service';
import { COOKIE_MAX_AGE_MS, COOKIE_NAME, TokenService } from './token.service';

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and underscores only'),
  password: z.string().min(8).max(72),
});
const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  private setCookie(res: Response, token: string) {
    const prod = env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: prod,
      sameSite: prod ? 'none' : 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { username, password } = parse(registerSchema, body);
    const user = await this.auth.register(username, password);
    this.setCookie(res, this.tokens.sign(user));
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { username, password } = parse(loginSchema, body);
    const user = await this.auth.login(username, password);
    this.setCookie(res, this.tokens.sign(user));
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    const prod = env.NODE_ENV === 'production';
    res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: prod, sameSite: prod ? 'none' : 'lax', path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const token: string | undefined = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
    const payload = token ? this.tokens.verify(token) : null;
    if (!payload) throw new UnauthorizedException('Not signed in');
    const user = await this.auth.getUser(payload.sub);
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return { user };
  }
}
