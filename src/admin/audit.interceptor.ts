import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '@/database/prisma.service';

/**
 * Records every state-changing call on the AdminController.
 *
 * Keyed on the controller **method name** rather than the URL: handler names are
 * stable across route refactors, and any new admin endpoint is captured by the
 * fallback even if nobody remembers to register it here.
 *
 * Only successful calls are logged — a rejected action changed nothing.
 */

type ActionMeta = { action: string; targetType: string };

const ACTIONS: Record<string, ActionMeta> = {
  updateAppointmentStatus:  { action: 'appointment.status',        targetType: 'appointment' },
  verifyDoctor:             { action: 'doctor.verify',             targetType: 'doctor' },
  bulkVerifyDoctors:        { action: 'doctor.bulk_verify',        targetType: 'doctor' },
  updateDoctorVerification: { action: 'doctor.verification_notes', targetType: 'doctor' },
  updateDoctorProfile:      { action: 'doctor.profile_update',     targetType: 'doctor' },
  updateDoctorSchedule:     { action: 'doctor.schedule_replace',   targetType: 'doctor' },
  toggleReviewVisibility:   { action: 'review.visibility',         targetType: 'review' },
  suspendUser:              { action: 'user.suspend',              targetType: 'user' },
  deleteUser:               { action: 'user.delete',               targetType: 'user' },
  createDoctorService:         { action: 'service.create',            targetType: 'doctor' },
  updateDoctorService:         { action: 'service.update',            targetType: 'doctor' },
  deleteDoctorService:         { action: 'service.delete',            targetType: 'doctor' },
  createDoctorServiceCategory: { action: 'service_category.create',   targetType: 'doctor' },
  deleteDoctorServiceCategory: { action: 'service_category.delete',   targetType: 'doctor' },
  createDoctorLocation:        { action: 'location.create',           targetType: 'doctor' },
  updateDoctorLocation:        { action: 'location.update',           targetType: 'doctor' },
  deleteDoctorLocation:        { action: 'location.delete',           targetType: 'doctor' },
  addLocationService:          { action: 'location_service.add',      targetType: 'doctor' },
  updateLocationService:       { action: 'location_service.update',   targetType: 'doctor' },
  removeLocationService:       { action: 'location_service.remove',   targetType: 'doctor' },
  updateDoctorLocationSchedule:{ action: 'location.schedule_replace', targetType: 'doctor' },
  open:                        { action: 'verification.open',          targetType: 'doctor' },
  saveProgress:                { action: 'verification.progress',      targetType: 'doctor' },
  recordCheck:                 { action: 'verification.check',         targetType: 'doctor' },
  decide:                      { action: 'verification.decision',      targetType: 'doctor' },
};

/** Never persist these, whatever endpoint they arrive on. */
const REDACT = new Set(['password', 'token', 'refreshToken', 'accessToken', 'secret', 'otp']);

function sanitize(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body ?? null;
  if (Array.isArray(body)) return body.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = REDACT.has(k) ? '[redacted]' : (v && typeof v === 'object' ? sanitize(v) : v);
  }
  return out;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method ?? 'GET';

    // Reads change nothing.
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();

    const handler = context.getHandler().name;
    const meta = ACTIONS[handler] ?? { action: handler, targetType: 'unknown' };
    const params: Record<string, string> = req.params ?? {};
    const actor = req.user;

    // Everything below is resolved BEFORE the handler runs: once a delete goes
    // through, neither the name nor the related counts can be recovered.
    const snapshot = meta.action === 'user.delete'
      ? await this.captureUser(params.id)
      : meta.action === 'doctor.bulk_verify'
      ? await this.captureBulkTargets(req.body?.ids)
      : null;

    const targetLabel = await this.resolveLabel(meta, params.id, snapshot);

    return next.handle().pipe(
      tap({
        next: () => {
          // Fire-and-forget: an audit write must never fail the admin action itself,
          // but it must be visible when it breaks rather than silently swallowed.
          this.prisma.adminAuditLog.create({
            data: {
              actor_id: actor?.id ?? '00000000-0000-0000-0000-000000000000',
              actor_email: actor?.email ?? 'unknown',
              action: meta.action,
              target_type: meta.targetType,
              target_id: params.id ?? null,
              target_label: targetLabel,
              summary: this.summarize(meta.action, req.body, snapshot),
              payload: sanitize(req.body) as any,
              snapshot: snapshot as any,
              ip: req.ip ?? null,
              user_agent: req.headers?.['user-agent'] ?? null,
            },
          }).catch((err: unknown) => console.error('[audit] failed to record', meta.action, err));
        },
      }),
    );
  }

  /**
   * Turns the target UUID into something a human can read a year from now.
   * Resolved before the handler runs so it survives deletions.
   */
  private async resolveLabel(meta: ActionMeta, id: string | undefined, snapshot: any): Promise<string | null> {
    // Bulk actions carry their targets in the body, not the route params.
    if (Array.isArray(snapshot)) {
      const names = snapshot.map((s: any) => s.name);
      if (names.length === 0) return null;
      return names.length <= 3
        ? names.join(', ')
        : `${names.slice(0, 3).join(', ')} +${names.length - 3} ακόμη`;
    }
    if (snapshot?.email) return snapshot.business_name || snapshot.full_name || snapshot.email;
    if (!id) return null;

    try {
      switch (meta.targetType) {
        case 'doctor':
        case 'user': {
          const u = await this.prisma.user.findUnique({
            where: { id },
            select: { email: true, full_name: true, business_name: true },
          });
          return u ? (u.business_name || u.full_name || u.email) : null;
        }
        case 'appointment': {
          const a = await this.prisma.appointments.findUnique({
            where: { id },
            select: {
              client_name: true,
              start_time: true,
              profiles: { select: { full_name: true, business_name: true, email: true } },
            },
          });
          if (!a) return null;
          const doctor = a.profiles?.business_name || a.profiles?.full_name || a.profiles?.email || '—';
          return `${a.client_name} → ${doctor} (${a.start_time.toISOString().slice(0, 16).replace('T', ' ')})`;
        }
        case 'review': {
          const r = await this.prisma.review.findUnique({
            where: { id },
            select: {
              client_name: true,
              rating: true,
              doctor: { select: { full_name: true, business_name: true, email: true } },
            },
          });
          if (!r) return null;
          const doctor = r.doctor?.business_name || r.doctor?.full_name || r.doctor?.email || '—';
          return `${r.client_name} → ${doctor} (${r.rating}★)`;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /** Names of the doctors a bulk verify is about to touch. */
  private async captureBulkTargets(ids?: unknown) {
    if (!Array.isArray(ids) || ids.length === 0) return null;
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids as string[] } },
        select: { id: true, email: true, full_name: true, business_name: true },
      });
      return users.map((u) => ({
        id: u.id,
        name: u.business_name || u.full_name || u.email,
      }));
    } catch {
      return null;
    }
  }

  /** Compact record of a user about to be hard-deleted, with what goes down with them. */
  private async captureUser(userId?: string) {
    if (!userId) return null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, full_name: true, business_name: true,
          role: true, created_at: true, booking_url_slug: true,
          _count: { select: { appointments: true, services: true, locations: true } },
        },
      });
      return user ? JSON.parse(JSON.stringify(user)) : null;
    } catch {
      return null;
    }
  }

  /**
   * The detail that target_label does NOT already carry — reason, new status,
   * what was lost. Never repeats the target name: the UI renders it separately.
   */
  private summarize(action: string, body: any, snapshot: any): string | null {
    switch (action) {
      case 'user.delete':
        return snapshot
          ? `Διαγράφηκαν μαζί: ${snapshot._count?.appointments ?? 0} ραντεβού, ${snapshot._count?.services ?? 0} υπηρεσίες, ${snapshot._count?.locations ?? 0} τοποθεσίες`
          : null;
      case 'user.suspend':
        return body?.suspend ? 'Αναστολή πρόσβασης' : 'Άρση αναστολής';
      case 'doctor.verify':
        return body?.status === 'APPROVED' ? 'Εγκρίθηκε'
          : body?.status === 'REJECTED' ? `Απορρίφθηκε${body?.reason ? ` — ${body.reason}` : ' (χωρίς λόγο)'}`
          : 'Επαναφορά σε εκκρεμότητα';
      case 'doctor.bulk_verify':
        return `${body?.status === 'APPROVED' ? 'Μαζική έγκριση' : 'Μαζική απόρριψη'} ${body?.ids?.length ?? 0} γιατρών${body?.reason ? ` — ${body.reason}` : ''}`;
      case 'appointment.status':
        return `Νέα κατάσταση: "${body?.status ?? '—'}"`;
      case 'verification.decision': {
        const labels: Record<string, string> = {
          APPROVED: 'Εγκρίθηκε',
          REJECTED: 'Απορρίφθηκε',
          NEEDS_MORE_INFO: 'Ζητήθηκαν συμπληρωματικά',
          REVOKED: 'Ανακλήθηκε',
        };
        const label = labels[body?.status] ?? body?.status ?? '—';
        return body?.reason ? `${label} — ${body.reason}` : label;
      }
      case 'verification.check':
        return body?.kind === 'PHONE'
          ? `Τηλεφωνική επιβεβαίωση${body?.number ? ` στο ${body.number}` : ''}`
          : `Έλεγχος μητρώου${body?.source ? ` — ${body.source}` : ''}`;
      case 'service.create':
      case 'location.create':
        return body?.name ? `"${body.name}"` : null;
      case 'service.update':
        return body?.name ? `"${body.name}"` : null;
      default:
        return null;
    }
  }
}
