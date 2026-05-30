import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly logger = new Logger(EmailService.name);

  constructor(private config: ConfigService) {
    this.resend = new Resend(config.get<string>('resend.apiKey'));
    this.from = config.get<string>('resend.fromEmail') ?? 'noreply@bookpro.gr';
  }

  async sendBookingConfirmation(opts: {
    to: string;
    clientName: string;
    businessName: string;
    serviceName: string;
    date: string;
    time: string;
    managementToken: string;
    appUrl: string;
  }) {
    const manageUrl = `${opts.appUrl}/manage/${opts.managementToken}`;
    return this.send({
      to: opts.to,
      subject: `Booking Confirmed – ${opts.businessName}`,
      html: `
        <h2>Your booking is confirmed!</h2>
        <p>Hi ${opts.clientName},</p>
        <p>Your appointment for <strong>${opts.serviceName}</strong> has been confirmed.</p>
        <p><strong>Date:</strong> ${opts.date}<br/>
           <strong>Time:</strong> ${opts.time}</p>
        <p><a href="${manageUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">Manage your booking</a></p>
        <p style="color:#64748b;font-size:13px">BookPro – Professional Booking Platform</p>
      `,
    });
  }

  async sendPasswordReset(opts: { to: string; name: string; resetLink: string }) {
    return this.send({
      to: opts.to,
      subject: 'Reset your BookPro password',
      html: `
        <h2>Password Reset Request</h2>
        <p>Hi ${opts.name},</p>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <p><a href="${opts.resetLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">Reset Password</a></p>
        <p style="color:#64748b;font-size:13px">If you did not request this, please ignore this email.</p>
      `,
    });
  }

  async sendWelcome(opts: { to: string; name: string }) {
    return this.send({
      to: opts.to,
      subject: 'Welcome to BookPro!',
      html: `
        <h2>Welcome to BookPro, ${opts.name}!</h2>
        <p>Your account is ready. Start by setting up your services and availability.</p>
      `,
    });
  }

  private async send(opts: { to: string; subject: string; html: string }) {
    const { error } = await this.resend.emails.send({ from: this.from, ...opts });
    if (error) {
      this.logger.warn(`Email failed to ${opts.to}: ${error.message}`);
    }
  }
}
