import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '@/database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.email);
  }

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 12);
    const baseSlug = dto.businessName.toLowerCase().trim().replace(/\s+/g, '-');
    const slugExists = await this.prisma.user.findUnique({ where: { booking_url_slug: baseSlug } });
    const slug = slugExists ? `${baseSlug}-${Math.floor(Math.random() * 9000) + 1000}` : baseSlug;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        business_name: dto.businessName,
        booking_url_slug: slug,
      },
    });

    return this.issueTokens(user.id, user.email);
  }

  async refresh(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.issueTokens(user.id, user.email);
  }

  private issueTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.config.get<string>('jwt.accessExpiresIn') ?? '15m',
    });
    const refreshToken = this.jwt.sign(payload, {
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn') ?? '7d',
    });
    return { accessToken, refreshToken };
  }

  async validateRefreshToken(token: string): Promise<string> {
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      return payload.sub;
    } catch {
      throw new BadRequestException('Invalid refresh token');
    }
  }
}
