import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { UserRole } from '@prisma/client';
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
      select: { id: true, email: true, password: true, role: true, is_suspended: true, emailVerified: true },
    });
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.is_suspended) throw new UnauthorizedException('Account suspended');

    if (!user.emailVerified) throw new UnauthorizedException('EMAIL_NOT_VERIFIED');

    return this.issueTokens(user.id, user.email, user.role);
  }

  /**
   * Signs in an EXISTING user via a Google ID token — no account is created here.
   * Verifies the token's signature and audience against our client ID, requires a
   * Google-verified email, then matches it (case-insensitively) to a registered user.
   * A matching but never-OTP-verified user is auto-verified, since Google already
   * proved ownership of the email.
   *
   * Status codes are chosen so the frontend surfaces the error instead of the
   * api-client's global 401 → refresh → redirect interceptor kicking in:
   *   404 NO_ACCOUNT   — email has no BookPro account (prompt to sign up)
   *   403 suspended    — account exists but is suspended
   *   400 bad token    — token invalid or email unverified by Google
   */
  async googleLogin(idToken: string) {
    const payload = await this.verifyGoogleIdToken(idToken);

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: payload.email, mode: 'insensitive' } },
      select: { id: true, email: true, role: true, is_suspended: true, emailVerified: true },
    });

    if (!user) throw new NotFoundException('NO_ACCOUNT');
    if (user.is_suspended) throw new ForbiddenException('Account suspended');

    if (!user.emailVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    }

    return this.issueTokens(user.id, user.email, user.role);
  }

  /**
   * Signs up (or, if the email is already registered, signs in) via a Google ID token.
   *
   * Google has already proven ownership of the email, so the account is created
   * pre-verified — no OTP step. Name and avatar come from the Google profile.
   * An existing account with the same email is simply signed into, which links
   * password accounts to Google without creating a duplicate user.
   *
   *   403 suspended    — account exists but is suspended
   *   400 bad token    — token invalid or email unverified by Google
   */
  async googleSignup(idToken: string, role: UserRole = 'DOCTOR') {
    const payload = await this.verifyGoogleIdToken(idToken);

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: payload.email, mode: 'insensitive' } },
      select: { id: true, email: true, role: true, is_suspended: true, emailVerified: true },
    });

    if (existing) {
      if (existing.is_suspended) throw new ForbiddenException('Account suspended');
      if (!existing.emailVerified) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { emailVerified: new Date() },
        });
      }
      return {
        ...this.issueTokens(existing.id, existing.email, existing.role),
        role: existing.role,
        created: false,
      };
    }

    const fullName = payload.name?.trim() || payload.email.split('@')[0];

    const user = await this.prisma.user.create({
      data: {
        email: payload.email.toLowerCase(),
        full_name: fullName,
        avatar_url: payload.picture ?? null,
        booking_url_slug: await this.uniqueSlug(fullName),
        emailVerified: new Date(),
        role,
        ...(role === 'DOCTOR'
          ? { doctor_profile: { create: {} } }
          : { patient_profile: { create: {} } }),
      },
      select: { id: true, email: true, role: true },
    });

    return { ...this.issueTokens(user.id, user.email, user.role), role: user.role, created: true };
  }

  /**
   * Verifies a Google ID token's signature and audience against our client ID and
   * requires a Google-verified email. Shared by Google login and Google signup.
   */
  private async verifyGoogleIdToken(idToken: string) {
    if (!idToken) throw new BadRequestException('Missing Google token');

    const clientId = this.config.get<string>('google.clientId');
    if (!clientId) {
      this.logger.error('[google-auth] GOOGLE_CLIENT_ID not configured');
      throw new BadRequestException('Google login not configured');
    }

    let payload: { email?: string; email_verified?: boolean; name?: string; picture?: string } | undefined;
    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new BadRequestException('Invalid Google token');
    }

    if (!payload?.email || payload.email_verified !== true) {
      throw new BadRequestException('Google email not verified');
    }

    return payload as { email: string; name?: string; picture?: string };
  }

  /** Slugifies a name and appends a random 4-digit suffix if the slug is taken. */
  private async uniqueSlug(name: string): Promise<string> {
    const baseSlug = name.toLowerCase().trim().replace(/\s+/g, '-');
    const taken = await this.prisma.user.findUnique({
      where: { booking_url_slug: baseSlug },
      select: { id: true },
    });
    return taken ? `${baseSlug}-${Math.floor(Math.random() * 9000) + 1000}` : baseSlug;
  }

  /**
   * Creates a new user account.
   * Generates a unique booking_url_slug from the business name,
   * appending a random 4-digit suffix if the slug is already taken.
   * Email check, slug check, and password hashing run in parallel.
   */
  async signup(dto: SignupDto) {
    const baseSlug = dto.fullName.toLowerCase().trim().replace(/\s+/g, '-');

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
        full_name: dto.fullName,
        booking_url_slug: slug,
        role,
        ...(role === 'DOCTOR'
          ? { doctor_profile: { create: {} } }
          : { patient_profile: { create: {} } }),
      },
      select: { id: true, email: true, role: true },
    });

    await this.sendOtp(user.email, dto.fullName);

    return { email: user.email, otpSent: true };
  }

  async verifyOtp(email: string, otp: string) {
    const record = await this.prisma.verificationToken.findFirst({
      where: { identifier: `otp:${email}`, token: otp },
    });

    if (!record || record.expires < new Date()) {
      throw new BadRequestException('Ο κωδικός είναι λανθασμένος ή έχει λήξει');
    }

    const user = await this.prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
      select: { id: true, email: true, role: true },
    });

    await this.prisma.verificationToken.delete({
      where: { identifier_token: { identifier: `otp:${email}`, token: otp } },
    });

    return this.issueTokens(user.id, user.email, user.role);
  }

  async resendOtp(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { business_name: true },
    });
    if (!user) return;
    await this.sendOtp(email, user.business_name ?? email);
  }

  private async sendOtp(email: string, name: string): Promise<void> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.verificationToken.deleteMany({ where: { identifier: `otp:${email}` } });
    await this.prisma.verificationToken.create({
      data: { identifier: `otp:${email}`, token: otp, expires },
    });

    await this.email.sendEmailOtp({ to: email, name, otp });
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
