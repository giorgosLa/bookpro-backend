import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@/database/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: any) => req?.query?.token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret') ?? 'change-me',
    });
  }

  async validate(payload: JwtPayload & { iat?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { is_suspended: true, sessions_invalidated_at: true },
    });
    if (!user || user.is_suspended) throw new UnauthorizedException('Account suspended');
    if (
      user.sessions_invalidated_at &&
      payload.iat !== undefined &&
      payload.iat * 1000 < user.sessions_invalidated_at.getTime()
    ) {
      throw new UnauthorizedException('Session invalidated');
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
