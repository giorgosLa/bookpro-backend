import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import * as Sentry from '@sentry/nestjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) throw err ?? new UnauthorizedException('Invalid or expired token');

    // Tag the current Sentry scope with the authenticated user so every error
    // and transaction in this request is attributed to them. Id only — no PII
    // beyond what's needed to find the user (sendDefaultPii stays off).
    if (user?.id || user?.sub) {
      Sentry.setUser({
        id: String(user.id ?? user.sub),
        email: user.email,
        role: user.role,
      });
    }

    return user;
  }
}
