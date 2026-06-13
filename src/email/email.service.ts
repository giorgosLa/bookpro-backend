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
    locationName?: string;
    locationAddress?: string;
    mapsUrl?: string;
  }) {
    const manageUrl = `${opts.appUrl}/manage/${opts.managementToken}`;

    const locationBlock = opts.locationName
      ? `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #f1f5f9">
            <p style="margin:0;color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Τοποθεσία</p>
            <p style="margin:4px 0 0;color:#1e293b;font-size:15px;font-weight:600">${opts.locationName}</p>
            ${opts.locationAddress ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${opts.locationAddress}</p>` : ''}
            ${opts.mapsUrl ? `<a href="${opts.mapsUrl}" style="display:inline-block;margin-top:8px;color:#2563eb;font-size:13px;font-weight:600;text-decoration:none">📍 Άνοιγμα στο Google Maps →</a>` : ''}
          </td>
        </tr>`
      : '';

    return this.send({
      to: opts.to,
      subject: `Επιβεβαίωση ραντεβού – ${opts.businessName}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#ffffff">
          <div style="background:#2563eb;padding:28px 32px;border-radius:12px 12px 0 0">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:800">Το ραντεβού σας επιβεβαιώθηκε!</h1>
          </div>
          <div style="padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
            <p style="color:#475569;font-size:15px;margin:0 0 20px">Γεια σας <strong>${opts.clientName}</strong>,</p>
            <p style="color:#475569;font-size:15px;margin:0 0 20px">Το ραντεβού σας με <strong>${opts.businessName}</strong> έχει καταχωρηθεί επιτυχώς.</p>

            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f1f5f9">
                  <p style="margin:0;color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Υπηρεσία</p>
                  <p style="margin:4px 0 0;color:#1e293b;font-size:15px;font-weight:600">${opts.serviceName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f1f5f9">
                  <p style="margin:0;color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Ημερομηνία & Ώρα</p>
                  <p style="margin:4px 0 0;color:#1e293b;font-size:15px;font-weight:600">${opts.date} στις ${opts.time}</p>
                </td>
              </tr>
              ${locationBlock}
            </table>

            <a href="${manageUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
              Διαχείριση ραντεβού
            </a>

            <p style="color:#94a3b8;font-size:12px;margin:24px 0 0">BookPro – Professional Booking Platform</p>
          </div>
        </div>
      `,
    });
  }

  async sendAppointmentConfirmedToPatient(opts: {
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
      subject: `Επιβεβαίωση ραντεβού – ${opts.businessName}`,
      html: `
        <h2>Το ραντεβού σας επιβεβαιώθηκε!</h2>
        <p>Γεια σας ${opts.clientName},</p>
        <p>Ο/Η <strong>${opts.businessName}</strong> επιβεβαίωσε το ραντεβού σας για <strong>${opts.serviceName}</strong>.</p>
        <p><strong>Ημερομηνία:</strong> ${opts.date}<br/>
           <strong>Ώρα:</strong> ${opts.time}</p>
        <p><a href="${manageUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">Διαχείριση ραντεβού</a></p>
        <p style="color:#64748b;font-size:13px">BookPro – Professional Booking Platform</p>
      `,
    });
  }

  async sendCancellationNotificationToDoctor(opts: {
    to: string;
    doctorName: string;
    clientName: string;
    serviceName: string;
    date: string;
    time: string;
  }) {
    return this.send({
      to: opts.to,
      subject: `Ακύρωση ραντεβού – ${opts.clientName}`,
      html: `
        <h2>Ακύρωση ραντεβού</h2>
        <p>Γεια σας ${opts.doctorName},</p>
        <p>Ο/Η ασθενής <strong>${opts.clientName}</strong> ακύρωσε το ραντεβού του/της.</p>
        <p><strong>Υπηρεσία:</strong> ${opts.serviceName}<br/>
           <strong>Ημερομηνία:</strong> ${opts.date}<br/>
           <strong>Ώρα:</strong> ${opts.time}</p>
        <p style="color:#64748b;font-size:13px">BookPro – Professional Booking Platform</p>
      `,
    });
  }

  async sendDoctorApproved(opts: { to: string; name: string; appUrl: string }) {
    return this.send({
      to: opts.to,
      subject: 'Ο λογαριασμός σας εγκρίθηκε – BookPro',
      html: `
        <h2>Συγχαρητήρια, ${opts.name}!</h2>
        <p>Ο λογαριασμός σας ως γιατρός έχει <strong>εγκριθεί</strong> από την ομάδα του BookPro.</p>
        <p>Μπορείτε τώρα να δεχτείτε ραντεβού μέσω της πλατφόρμας.</p>
        <p><a href="${opts.appUrl}/dashboard" style="background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">Μεταβείτε στο Dashboard</a></p>
        <p style="color:#64748b;font-size:13px">BookPro – Professional Booking Platform</p>
      `,
    });
  }

  async sendDoctorRejected(opts: { to: string; name: string; reason?: string; appUrl: string }) {
    return this.send({
      to: opts.to,
      subject: 'Ενημέρωση για τον λογαριασμό σας – BookPro',
      html: `
        <h2>Ενημέρωση λογαριασμού</h2>
        <p>Γεια σας ${opts.name},</p>
        <p>Μετά από έλεγχο, ο λογαριασμός σας ως γιατρός <strong>δεν εγκρίθηκε</strong> αυτή τη φορά.</p>
        ${opts.reason ? `<p><strong>Λόγος:</strong> ${opts.reason}</p>` : ''}
        <p>Εάν πιστεύετε ότι πρόκειται για λάθος ή θέλετε να επικοινωνήσετε μαζί μας, απαντήστε σε αυτό το email.</p>
        <p style="color:#64748b;font-size:13px">BookPro – Professional Booking Platform</p>
      `,
    });
  }

  async sendEmailOtp(opts: { to: string; name: string; otp: string }) {
    return this.send({
      to: opts.to,
      subject: `${opts.otp} – Κωδικός επαλήθευσης BookPro`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1e293b;margin-bottom:8px">Επαλήθευση Email</h2>
          <p style="color:#475569">Γεια σας ${opts.name},</p>
          <p style="color:#475569">Χρησιμοποιήστε τον παρακάτω κωδικό για να επαληθεύσετε το email σας:</p>
          <div style="background:#f1f5f9;border-radius:12px;padding:28px;text-align:center;margin:24px 0">
            <span style="font-size:40px;font-weight:900;letter-spacing:14px;color:#1e293b;font-family:monospace">${opts.otp}</span>
          </div>
          <p style="color:#64748b;font-size:13px">Ο κωδικός λήγει σε <strong>10 λεπτά</strong>.</p>
          <p style="color:#94a3b8;font-size:12px">Αν δεν δημιουργήσατε λογαριασμό στο BookPro, αγνοήστε αυτό το email.</p>
          <p style="color:#94a3b8;font-size:12px">BookPro – Professional Booking Platform</p>
        </div>
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
