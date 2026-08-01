import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly logger = new Logger(EmailService.name);

  constructor(config: ConfigService) {
    this.resend = new Resend(config.get<string>('resend.apiKey'));
    this.from = config.get<string>('resend.fromEmail') ?? 'noreply@bookpro.gr';
  }

  // ── Shared layout wrapper ─────────────────────────────────────────────────

  private layout(body: string): string {
    return `
<!DOCTYPE html>
<html lang="el">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">

        <!-- Logo -->
        <tr><td style="padding-bottom:24px">
          <p style="margin:0;font-size:13px;font-weight:800;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase">BookPro</p>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:24px">
          <p style="margin:0;font-size:12px;color:#cbd5e1;text-align:center">
            © BookPro · Δεν χρειάζεται απάντηση σε αυτό το email
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
  }

  private row(label: string, value: string): string {
    return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f1f5f9">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase">${label}</p>
          <p style="margin:5px 0 0;font-size:15px;font-weight:600;color:#0f172a">${value}</p>
        </td>
      </tr>`;
  }

  private btn(text: string, href: string): string {
    return `<a href="${href}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:13px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.01em">${text}</a>`;
  }

  // ── Emails ────────────────────────────────────────────────────────────────

  async sendBookingConfirmation(opts: {
    to: string;
    clientName: string;
    businessName: string;
    serviceName: string;
    date: string;
    time: string;
    managementToken: string;
    appUrl: string;
    refNumber?: number | null;
    locationName?: string;
    locationAddress?: string;
    mapsUrl?: string;
  }) {
    const manageUrl = `${opts.appUrl}/manage/${opts.managementToken}`;

    const locationRow = opts.locationName
      ? this.row(
          'Τοποθεσία',
          opts.locationName +
            (opts.locationAddress ? `<br><span style="font-size:13px;font-weight:400;color:#64748b">${opts.locationAddress}</span>` : '') +
            (opts.mapsUrl ? `<br><a href="${opts.mapsUrl}" style="font-size:13px;color:#2563eb;font-weight:600;text-decoration:none;display:inline-block;margin-top:4px">Άνοιγμα στο χάρτη →</a>` : ''),
        )
      : '';

    return this.send({
      to: opts.to,
      subject: `Αίτημα ραντεβού – ${opts.businessName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Αίτημα ραντεβού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Το αίτημά σας<br>ελήφθη
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.clientName}</strong>, το αίτημά σας με <strong style="color:#0f172a">${opts.businessName}</strong>
            αναμένει επιβεβαίωση. Θα λάβετε νέο email μόλις επιβεβαιωθεί.
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Υπηρεσία', opts.serviceName)}
            ${this.row('Ημερομηνία & Ώρα', `${opts.date} στις ${opts.time}`)}
            ${this.row('Κατάσταση', '<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#d97706"></span>Αναμένει επιβεβαίωση</span>')}
            ${locationRow}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          ${this.btn('Διαχείριση ραντεβού', manageUrl)}
        </div>
      `),
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
    refNumber?: number | null;
    locationName?: string;
    locationAddress?: string;
    mapsUrl?: string;
  }) {
    const manageUrl = `${opts.appUrl}/manage/${opts.managementToken}`;

    const locationRow = opts.locationName
      ? this.row(
          'Τοποθεσία',
          opts.locationName +
            (opts.locationAddress ? `<br><span style="font-size:13px;font-weight:400;color:#64748b">${opts.locationAddress}</span>` : '') +
            (opts.mapsUrl ? `<br><a href="${opts.mapsUrl}" style="font-size:13px;color:#2563eb;font-weight:600;text-decoration:none;display:inline-block;margin-top:4px">Άνοιγμα στο χάρτη →</a>` : ''),
        )
      : '';

    return this.send({
      to: opts.to,
      subject: `Επιβεβαίωση ραντεβού – ${opts.businessName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Επιβεβαίωση ραντεβού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Το ραντεβού σας<br>επιβεβαιώθηκε
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.clientName}</strong>,
            ο/η <strong style="color:#0f172a">${opts.businessName}</strong> επιβεβαίωσε το ραντεβού σας. Σας περιμένουμε!
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Υπηρεσία', opts.serviceName)}
            ${this.row('Ημερομηνία & Ώρα', `${opts.date} στις ${opts.time}`)}
            ${this.row('Κατάσταση', '<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#059669"></span>Επιβεβαιωμένο</span>')}
            ${locationRow}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          ${this.btn('Διαχείριση ραντεβού', manageUrl)}
        </div>
      `),
    });
  }

  async sendRescheduleConfirmationToPatient(opts: {
    to: string;
    clientName: string;
    businessName: string;
    serviceName: string;
    newDate: string;
    newTime: string;
    managementToken: string;
    appUrl: string;
    refNumber?: number | null;
  }) {
    const manageUrl = `${opts.appUrl}/manage/${opts.managementToken}`;
    return this.send({
      to: opts.to,
      subject: `Αλλαγή ραντεβού – ${opts.businessName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Αλλαγή ραντεβού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Η αλλαγή σας<br>καταγράφηκε
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.clientName}</strong>,
            η νέα ώρα του ραντεβού σας με <strong style="color:#0f172a">${opts.businessName}</strong> καταγράφηκε και αναμένει επιβεβαίωση.
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Υπηρεσία', opts.serviceName)}
            ${this.row('Νέα ημερομηνία & ώρα', `${opts.newDate} στις ${opts.newTime}`)}
            ${this.row('Κατάσταση', '<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#d97706"></span>Αναμένει επιβεβαίωση</span>')}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          ${this.btn('Διαχείριση ραντεβού', manageUrl)}
        </div>
      `),
    });
  }

  async sendNewAppointmentToDoctor(opts: {
    to: string;
    doctorName: string;
    clientName: string;
    clientPhone?: string | null;
    serviceName: string;
    date: string;
    time: string;
    notes?: string | null;
    appUrl: string;
    refNumber?: number | null;
  }) {
    return this.send({
      to: opts.to,
      subject: `Νέο ραντεβού – ${opts.clientName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Νέο ραντεβού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Νέο αίτημα κράτησης
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.doctorName}</strong>,
            ο/η <strong style="color:#0f172a">${opts.clientName}</strong> έκανε κράτηση για <strong style="color:#0f172a">${opts.serviceName}</strong>.
            Συνδεθείτε στο dashboard για να εγκρίνετε ή να απορρίψετε.
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Ασθενής', opts.clientName)}
            ${opts.clientPhone ? this.row('Τηλέφωνο', opts.clientPhone) : ''}
            ${this.row('Υπηρεσία', opts.serviceName)}
            ${this.row('Ημερομηνία & ώρα', `${opts.date} στις ${opts.time}`)}
            ${opts.notes ? this.row('Σημειώσεις', opts.notes) : ''}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          ${this.btn('Άνοιγμα dashboard', `${opts.appUrl}/dashboard`)}
        </div>
      `),
    });
  }

  async sendRescheduleNotificationToDoctor(opts: {
    to: string;
    doctorName: string;
    clientName: string;
    serviceName: string;
    oldDate: string;
    oldTime: string;
    newDate: string;
    newTime: string;
    refNumber?: number | null;
  }) {
    return this.send({
      to: opts.to,
      subject: `Αλλαγή ραντεβού – ${opts.clientName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Ενημέρωση ραντεβού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Αλλαγή ώρας
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.doctorName}</strong>,
            ο/η <strong style="color:#0f172a">${opts.clientName}</strong> άλλαξε την ώρα ραντεβού για <strong style="color:#0f172a">${opts.serviceName}</strong>.
            Το ραντεβού αναμένει την έγκρισή σας.
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Ασθενής', opts.clientName)}
            <tr>
              <td style="padding:14px 0;border-bottom:1px solid #f1f5f9">
                <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase">Παλιά ώρα</p>
                <p style="margin:5px 0 0;font-size:15px;font-weight:600;color:#94a3b8;text-decoration:line-through">${opts.oldDate} στις ${opts.oldTime}</p>
              </td>
            </tr>
            ${this.row('Νέα ώρα', `${opts.newDate} στις ${opts.newTime}`)}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          <p style="margin:0;font-size:13px;color:#94a3b8">Συνδεθείτε στο dashboard για να εγκρίνετε ή να απορρίψετε.</p>
        </div>
      `),
    });
  }

  async sendCancellationNotificationToPatient(opts: {
    to: string;
    clientName: string;
    businessName: string;
    serviceName: string;
    date: string;
    time: string;
    refNumber?: number | null;
  }) {
    return this.send({
      to: opts.to,
      subject: `Ακύρωση ραντεβού – ${opts.businessName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Ενημέρωση ραντεβού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Ακύρωση<br>ραντεβού
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.clientName}</strong>,
            ο/η <strong style="color:#0f172a">${opts.businessName}</strong> ακύρωσε το ραντεβού σας.
            Μπορείτε να κλείσετε νέο ραντεβού όποτε θέλετε.
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Υπηρεσία', opts.serviceName)}
            ${this.row('Ημερομηνία & Ώρα', `${opts.date} στις ${opts.time}`)}
            ${this.row('Κατάσταση', '<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#94a3b8"></span>Ακυρώθηκε</span>')}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          <p style="margin:0;font-size:13px;color:#94a3b8">Για οποιαδήποτε απορία, επικοινωνήστε απευθείας με τον γιατρό.</p>
        </div>
      `),
    });
  }

  async sendCancellationNotificationToDoctor(opts: {
    to: string;
    doctorName: string;
    clientName: string;
    serviceName: string;
    date: string;
    time: string;
    refNumber?: number | null;
  }) {
    return this.send({
      to: opts.to,
      subject: `Ακύρωση ραντεβού – ${opts.clientName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Ενημέρωση ραντεβού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Ακύρωση ραντεβού
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.doctorName}</strong>,
            ο/η <strong style="color:#0f172a">${opts.clientName}</strong> ακύρωσε το ραντεβού του/της.
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Ασθενής', opts.clientName)}
            ${this.row('Υπηρεσία', opts.serviceName)}
            ${this.row('Ημερομηνία & Ώρα', `${opts.date} στις ${opts.time}`)}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          <p style="margin:0;font-size:13px;color:#94a3b8">Η ώρα είναι πλέον διαθέσιμη για νέα κράτηση.</p>
        </div>
      `),
    });
  }

  async sendPatientCancellationConfirmation(opts: {
    to: string;
    clientName: string;
    businessName: string;
    serviceName: string;
    date: string;
    time: string;
    refNumber?: number | null;
    bookingUrl?: string;
  }) {
    return this.send({
      to: opts.to,
      subject: `Ακύρωση ραντεβού επιβεβαιώθηκε – ${opts.businessName}`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Επιβεβαίωση ακύρωσης</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Ακυρώσατε<br>το ραντεβού σας
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.clientName}</strong>,
            η ακύρωση του ραντεβού σας με
            <strong style="color:#0f172a">${opts.businessName}</strong>
            ολοκληρώθηκε επιτυχώς.
          </p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding:0 32px">
          <tbody>
            ${opts.refNumber != null ? this.row('Αριθμός ραντεβού', `<span style="font-family:monospace;font-weight:800">#${opts.refNumber}</span>`) : ''}
            ${this.row('Υπηρεσία', opts.serviceName)}
            ${this.row('Ημερομηνία & Ώρα', `${opts.date} στις ${opts.time}`)}
            ${this.row('Κατάσταση', '<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#f87171"></span>Ακυρώθηκε</span>')}
          </tbody>
        </table>

        <div style="padding:28px 32px 32px">
          ${opts.bookingUrl ? `
          <p style="margin:0 0 20px;font-size:14px;color:#64748b">
            Θέλετε να κλείσετε νέο ραντεβού;
          </p>
          ${this.btn('Κλείστε νέο ραντεβού', opts.bookingUrl)}
          ` : `
          <p style="margin:0;font-size:13px;color:#94a3b8">Μπορείτε να κλείσετε νέο ραντεβού όποτε θέλετε.</p>
          `}
        </div>
      `),
    });
  }

  async sendDoctorApproved(opts: { to: string; name: string; appUrl: string }) {
    return this.send({
      to: opts.to,
      subject: 'Ο λογαριασμός σας εγκρίθηκε – BookPro',
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">BookPro</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Ο λογαριασμός σας<br>εγκρίθηκε
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.name}</strong>,
            η ομάδα του BookPro επαλήθευσε τα στοιχεία σας. Μπορείτε πλέον να δέχεστε ραντεβού.
          </p>
        </div>
        <div style="padding:0 32px 32px">
          ${this.btn('Μετάβαση στο Dashboard', `${opts.appUrl}/dashboard`)}
        </div>
      `),
    });
  }

  async sendDoctorRejected(opts: { to: string; name: string; reason?: string; appUrl: string }) {
    return this.send({
      to: opts.to,
      subject: 'Ενημέρωση για τον λογαριασμό σας – BookPro',
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">BookPro</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Ενημέρωση<br>λογαριασμού
          </h1>
          <p style="margin:0 0 20px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.name}</strong>,
            μετά από έλεγχο ο λογαριασμός σας δεν εγκρίθηκε αυτή τη φορά.
          </p>
          ${opts.reason ? `
          <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0;font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em">Λόγος</p>
            <p style="margin:6px 0 0;font-size:14px;color:#475569">${opts.reason}</p>
          </div>` : ''}
          <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6">
            Εάν θέλετε να επικοινωνήσετε μαζί μας, απαντήστε σε αυτό το email.
          </p>
        </div>
        <div style="padding:0 32px 32px">
          ${this.btn('Υποβολή εκ νέου', `${opts.appUrl}/dashboard`)}
        </div>
      `),
    });
  }

  async sendDoctorNeedsInfo(opts: { to: string; name: string; reason: string; appUrl: string }) {
    return this.send({
      to: opts.to,
      subject: 'Χρειαζόμαστε κάτι ακόμη – BookPro',
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">BookPro</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Χρειαζόμαστε<br>κάτι ακόμη
          </h1>
          <p style="margin:0 0 20px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.name}</strong>,
            η αίτησή σας είναι σχεδόν έτοιμη. Λείπει μόνο ένα πράγμα για να ολοκληρωθεί ο έλεγχος.
          </p>
          <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0;font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em">Τι χρειαζόμαστε</p>
            <p style="margin:6px 0 0;font-size:14px;color:#475569">${opts.reason}</p>
          </div>
          <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6">
            Τα υπόλοιπα στοιχεία σας παραμένουν αποθηκευμένα — δεν χρειάζεται να τα ανεβάσετε ξανά.
          </p>
        </div>
        <div style="padding:0 32px 32px">
          ${this.btn('Ολοκλήρωση αίτησης', `${opts.appUrl}/dashboard?view=verification`)}
        </div>
      `),
    });
  }

  async sendEmailOtp(opts: { to: string; name: string; otp: string }) {
    return this.send({
      to: opts.to,
      subject: `${opts.otp} – Κωδικός επαλήθευσης`,
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Επαλήθευση email</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Ο κωδικός σας
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.name}</strong>,
            χρησιμοποιήστε τον παρακάτω κωδικό για να επαληθεύσετε το email σας.
          </p>
        </div>

        <div style="margin:0 32px 28px;background:#f8fafc;border-radius:10px;padding:28px;text-align:center;border:1px solid #e2e8f0">
          <p style="margin:0;font-size:36px;font-weight:900;letter-spacing:16px;color:#0f172a;font-family:'Courier New',monospace">${opts.otp}</p>
        </div>

        <div style="padding:0 32px 32px">
          <p style="margin:0;font-size:13px;color:#94a3b8">Λήγει σε <strong style="color:#64748b">10 λεπτά</strong>. Αν δεν ζητήσατε αυτό τον κωδικό, αγνοήστε το email.</p>
        </div>
      `),
    });
  }

  async sendPasswordReset(opts: { to: string; name: string; resetLink: string }) {
    return this.send({
      to: opts.to,
      subject: 'Επαναφορά κωδικού – BookPro',
      html: this.layout(`
        <div style="padding:32px 32px 0">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">Ασφάλεια λογαριασμού</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Επαναφορά<br>κωδικού
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            Γεια σας <strong style="color:#0f172a">${opts.name}</strong>,
            λάβαμε αίτημα επαναφοράς κωδικού. Ο σύνδεσμος λήγει σε <strong style="color:#0f172a">1 ώρα</strong>.
          </p>
        </div>
        <div style="padding:0 32px 28px">
          ${this.btn('Επαναφορά κωδικού', opts.resetLink)}
        </div>
        <div style="padding:0 32px 32px;border-top:1px solid #f1f5f9">
          <p style="margin:16px 0 0;font-size:13px;color:#94a3b8">Αν δεν ζητήσατε επαναφορά κωδικού, αγνοήστε αυτό το email.</p>
        </div>
      `),
    });
  }

  async sendWelcome(opts: { to: string; name: string }) {
    return this.send({
      to: opts.to,
      subject: 'Καλώς ήρθατε στο BookPro',
      html: this.layout(`
        <div style="padding:32px 32px 32px">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#94a3b8">BookPro</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">
            Καλώς ήρθατε,<br>${opts.name}
          </h1>
          <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6">
            Ο λογαριασμός σας είναι έτοιμος. Ξεκινήστε ρυθμίζοντας τις υπηρεσίες και τα ωράρια σας.
          </p>
        </div>
      `),
    });
  }

  private async send(opts: { to: string; subject: string; html: string }) {
    // Email is fire-and-forget at every call site (`.catch(() => null)`), so a
    // silent failure here means a patient/doctor never gets notified and nobody
    // finds out. Report to Sentry so delivery problems are visible.
    try {
      const { error } = await this.resend.emails.send({ from: this.from, ...opts });
      if (error) {
        this.logger.warn(`Email failed to ${opts.to}: ${error.message}`);
        Sentry.captureException(new Error(`Resend rejected email: ${error.message}`), {
          level: 'warning',
          tags: { area: 'email', email_subject: opts.subject },
          extra: { to: opts.to, resendError: error },
        });
      } else {
        Sentry.addBreadcrumb({
          category: 'email',
          message: `Sent "${opts.subject}" to ${opts.to}`,
          level: 'info',
        });
      }
    } catch (err) {
      // Network / SDK throw (not a returned `error`) — also swallowed by callers.
      this.logger.error(`Email threw for ${opts.to}: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { area: 'email', email_subject: opts.subject },
        extra: { to: opts.to },
      });
    }
  }
}
