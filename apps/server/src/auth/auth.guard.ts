import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { COOKIE_NAME, TokenService } from './token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly activity: ActivityService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.[COOKIE_NAME];
    if (!token) throw new UnauthorizedException('Not signed in');
    const payload = this.tokens.verify(token);
    if (!payload) throw new UnauthorizedException('Session expired, please sign in again');
    req.user = { id: payload.sub, username: payload.u };
    void this.activity.touch(payload.sub);
    return true;
  }
}
