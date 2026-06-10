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

  /** Validates email/password and returns a new access + refresh token pair. */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, password: true, role: true, is_suspended: true },
    });
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.is_suspended) throw new UnauthorizedException('Account suspended');

    return this.issueTokens(user.id, user.email, user.role);
  }

  /**
   * Creates a new user account.
   * Generates a unique booking_url_slug from the business name,
   * appending a random 4-digit suffix if the slug is already taken.
   * Email check, slug check, and password hashing run in parallel.
   */
  async signup(dto: SignupDto) {
    const baseSlug = dto.businessName.toLowerCase().trim().replace(/\s+/g, '-');

    const [existing, slugExists, hashed] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { booking_url_slug: baseSlug }, select: { id: true } }),
      bcrypt.hash(dto.password, 10),
    ]);

    if (existing) throw new ConflictException('Email already in use');

    const slug = slugExists ? `${baseSlug}-${Math.floor(Math.random() * 9000) + 1000}` : baseSlug;

    const role = dto.role ?? 'DOCTOR';
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        business_name: dto.businessName,
        booking_url_slug: slug,
        role,
        ...(role === 'DOCTOR'
          ? { doctor_profile: { create: {} } }
          : { patient_profile: { create: {} } }),
      },
      select: { id: true, email: true, role: true },
    });

    return this.issueTokens(user.id, user.email, user.role);
  }

  /** Issues a fresh token pair for an existing user (called after refresh token validation). */
  async refresh(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, is_suspended: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.is_suspended) throw new UnauthorizedException('Account suspended');
    return this.issueTokens(user.id, user.email, user.role);
  }

  /**
   * Sends a password reset email.
   * Deletes any existing token for the email before creating a new one (1-hour expiry).
   * Returns silently if the email doesn't exist — avoids user enumeration.
   */
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

  /**
   * Resets a user's password using a single-use token.
   * Validates token existence and expiry, then deletes it after use to prevent reuse.
   */
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

  /** Signs and returns an access token (15m) and a refresh token (7d). */
  private issueTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.config.get<string>('jwt.accessExpiresIn') ?? '15m',
    });
    const refreshToken = this.jwt.sign(payload, {
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn') ?? '7d',
    });
    return { accessToken, refreshToken };
  }

  /** Verifies the refresh token signature, checks it wasn't issued before a session invalidation, and returns the user ID. */
  async validateRefreshToken(token: string): Promise<string> {
    let payload: { sub: string; iat?: number };
    try {
      payload = this.jwt.verify<{ sub: string; iat?: number }>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
    } catch {
      throw new BadRequestException('Invalid refresh token');
    }

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

    return payload.sub;
  }
}
