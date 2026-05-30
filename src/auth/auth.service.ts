import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
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

  async forgotPassword(email: string): Promise<void> {
    this.logger.log(`[forgot-password] Looking up user: ${email}`);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      this.logger.warn(`[forgot-password] User not found: ${email}`);
      return;
    }

    this.logger.log(`[forgot-password] User found, creating token`);
    await this.prisma.verificationToken.deleteMany({ where: { identifier: email } });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.verificationToken.create({
      data: { identifier: email, token, expires },
    });

    const appUrl = this.config.get<string>('appUrl');
    const resetLink = `${appUrl}/auth/reset-password?token=${token}`;
    this.logger.log(`[forgot-password] Sending email to ${email}, link: ${resetLink}`);

    await this.email.sendPasswordReset({
      to: email,
      name: user.business_name ?? email,
      resetLink,
    });
    this.logger.log(`[forgot-password] Done`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.verificationToken.findFirst({ where: { token } });

    if (!record || record.expires < new Date()) {
      throw new BadRequestException('Ο σύνδεσμος επαναφοράς είναι άκυρος ή έχει λήξει');
    }

    const user = await this.prisma.user.findUnique({ where: { email: record.identifier } });
    if (!user) throw new BadRequestException('Ο σύνδεσμος επαναφοράς είναι άκυρος ή έχει λήξει');

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    await this.prisma.verificationToken.delete({
      where: { identifier_token: { identifier: record.identifier, token } },
    });
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
