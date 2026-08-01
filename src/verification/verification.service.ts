import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VerificationStatus } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
import { SecureDocumentsService } from '@/common/storage/secure-documents.service';
import { invalidateDoctorCaches } from '@/public/cache';
import {
  DOCUMENT_LABELS,
  EDITABLE_STATUSES,
  REQUIRED_DOCUMENTS,
  REVIEW_CHECKLIST,
  VERIFICATION_VALID_MONTHS,
} from './verification.constants';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DecideVerificationDto } from './dto/decide-verification.dto';
import { RecordCheckDto } from './dto/record-check.dto';

const SUBMISSION_INCLUDE = {
  documents: { orderBy: { uploaded_at: 'asc' } },
} satisfies Prisma.VerificationSubmissionInclude;

type SubmissionWithDocs = Prisma.VerificationSubmissionGetPayload<{
  include: typeof SUBMISSION_INCLUDE;
}>;

@Injectable()
export class VerificationService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private email: EmailService,
    private storage: SecureDocumentsService,
  ) {}

  async getMyDossier(userId: string) {
    const profile = await this.requireDoctorProfile(userId);
    const submission = await this.getOrCreateOpenSubmission(profile.id, profile.verification_status);
    return this.presentDossier(profile, submission, false);
  }

  async uploadDocument(userId: string, dto: UploadDocumentDto) {
    const profile = await this.requireDoctorProfile(userId);
    const submission = await this.getOrCreateOpenSubmission(profile.id, profile.verification_status);
    this.assertEditable(submission.status);

    const existing = submission.documents.find((d) => d.type === dto.type);

    const uploaded = await this.storage.upload(
      `bookpro/verification/${userId}/${submission.id}/${dto.type.toLowerCase()}`,
      dto.fileData,
    );

    if (existing && existing.storage_key !== uploaded.storageKey) {
      await this.storage.destroy(existing.storage_key, existing.resource_type).catch(() => {});
    }

    const data = {
      submission_id: submission.id,
      type: dto.type,
      status: 'PENDING' as const,
      storage_key: uploaded.storageKey,
      resource_type: uploaded.resourceType,
      format: uploaded.format,
      original_filename: dto.filename?.slice(0, 255) ?? null,
      bytes: uploaded.bytes,
      sha256: uploaded.sha256,
      reviewer_note: null,
      expires_at: dto.expiresAt ? new Date(dto.expiresAt) : null,
      uploaded_at: new Date(),
      purged_at: null,
    };

    if (existing) {
      await this.prisma.verificationDocument.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.verificationDocument.create({ data });
    }

    await this.touch(submission.id);
    return this.getMyDossier(userId);
  }

  async deleteDocument(userId: string, documentId: string) {
    const profile = await this.requireDoctorProfile(userId);
    const submission = await this.getOrCreateOpenSubmission(profile.id, profile.verification_status);
    this.assertEditable(submission.status);

    const doc = submission.documents.find((d) => d.id === documentId);
    if (!doc) throw new NotFoundException('Το έγγραφο δεν βρέθηκε.');

    await this.storage.destroy(doc.storage_key, doc.resource_type).catch(() => {});
    await this.prisma.verificationDocument.delete({ where: { id: doc.id } });

    await this.touch(submission.id);
    return this.getMyDossier(userId);
  }

  async submit(userId: string) {
    const profile = await this.requireDoctorProfile(userId);
    const submission = await this.getOrCreateOpenSubmission(profile.id, profile.verification_status);
    this.assertEditable(submission.status);

    const blockers = this.getBlockers(await this.loadProfileFields(userId), submission);
    if (blockers.length > 0) {
      throw new BadRequestException(`Λείπουν: ${blockers.join(', ')}`);
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.verificationSubmission.update({
        where: { id: submission.id },
        data: { status: 'PENDING', submitted_at: now, updated_at: now },
      }),
      this.prisma.doctorProfile.update({
        where: { id: profile.id },
        data: {
          verification_status: 'PENDING',
          terms_accepted: true,
          rejection_reason: null,
          updated_at: now,
        },
      }),
    ]);

    return this.getMyDossier(userId);
  }

  async getDossierForAdmin(doctorUserId: string) {
    const profile = await this.requireDoctorProfile(doctorUserId);
    const submission = await this.prisma.verificationSubmission.findFirst({
      where: { doctor_profile_id: profile.id },
      include: SUBMISSION_INCLUDE,
      orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }],
    });
    if (!submission) return null;

    const history = await this.prisma.verificationSubmission.findMany({
      where: { doctor_profile_id: profile.id, id: { not: submission.id } },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        submitted_at: true,
        reviewed_at: true,
        reviewed_by_email: true,
        decision_reason: true,
      },
    });

    return {
      ...(await this.presentDossier(profile, submission, true)),
      history,
      checklistTemplate: REVIEW_CHECKLIST,
    };
  }

  async openForReview(adminId: string, adminEmail: string, doctorUserId: string) {
    const submission = await this.requireLatestSubmission(doctorUserId);
    if (submission.status !== 'PENDING') return this.getDossierForAdmin(doctorUserId);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.verificationSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'IN_REVIEW',
          reviewed_by_id: adminId,
          reviewed_by_email: adminEmail,
          updated_at: now,
        },
      }),
      this.prisma.doctorProfile.update({
        where: { id: submission.doctor_profile_id },
        data: { verification_status: 'IN_REVIEW', updated_at: now },
      }),
    ]);

    return this.getDossierForAdmin(doctorUserId);
  }

  async recordCheck(doctorUserId: string, dto: RecordCheckDto) {
    const submission = await this.requireLatestSubmission(doctorUserId);
    const now = new Date();

    const data: Prisma.VerificationSubmissionUpdateInput = { updated_at: now };
    if (dto.kind === 'PHONE') {
      data.phone_verified_at = dto.cleared === false ? null : now;
      data.phone_verified_number = dto.number ?? null;
      data.phone_verified_note = dto.note ?? null;
    } else {
      data.registry_checked_at = dto.cleared === false ? null : now;
      data.registry_source = dto.source ?? null;
      data.registry_note = dto.note ?? null;
    }

    await this.prisma.verificationSubmission.update({ where: { id: submission.id }, data });
    return this.getDossierForAdmin(doctorUserId);
  }

  async saveReviewProgress(
    doctorUserId: string,
    dto: { checklist?: unknown; adminNotes?: string; documents?: { id: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; note?: string }[] },
  ) {
    const submission = await this.requireLatestSubmission(doctorUserId);

    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.verificationSubmission.update({
        where: { id: submission.id },
        data: {
          ...(dto.checklist !== undefined ? { checklist: dto.checklist as Prisma.InputJsonValue } : {}),
          ...(dto.adminNotes !== undefined ? { admin_notes: dto.adminNotes } : {}),
          updated_at: new Date(),
        },
      }),
    ];

    for (const d of dto.documents ?? []) {
      if (!submission.documents.some((doc) => doc.id === d.id)) continue;
      writes.push(
        this.prisma.verificationDocument.update({
          where: { id: d.id },
          data: { status: d.status, reviewer_note: d.note ?? null },
        }),
      );
    }

    await this.prisma.$transaction(writes);
    return this.getDossierForAdmin(doctorUserId);
  }

  async decide(
    adminId: string,
    adminEmail: string,
    doctorUserId: string,
    dto: DecideVerificationDto,
  ) {
    const submission = await this.requireLatestSubmission(doctorUserId);
    const doctor = await this.prisma.user.findUnique({
      where: { id: doctorUserId },
      select: { id: true, email: true, full_name: true, business_name: true },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');

    if (dto.status !== 'APPROVED' && !dto.reason?.trim()) {
      throw new BadRequestException('Απαιτείται αιτιολογία.');
    }

    const now = new Date();
    const expiresAt =
      dto.status === 'APPROVED'
        ? new Date(new Date(now).setMonth(now.getMonth() + VERIFICATION_VALID_MONTHS))
        : null;

    await this.prisma.$transaction([
      this.prisma.verificationSubmission.update({
        where: { id: submission.id },
        data: {
          status: dto.status,
          reviewed_at: now,
          reviewed_by_id: adminId,
          reviewed_by_email: adminEmail,
          decision_reason: dto.reason?.trim() || null,
          ...(dto.checklist !== undefined ? { checklist: dto.checklist as Prisma.InputJsonValue } : {}),
          updated_at: now,
        },
      }),
      this.prisma.doctorProfile.update({
        where: { id: submission.doctor_profile_id },
        data: {
          verification_status: dto.status,
          rejection_reason: dto.status === 'APPROVED' ? null : dto.reason?.trim() || null,
          verified_at: dto.status === 'APPROVED' ? now : null,
          verification_expires_at: expiresAt,
          updated_at: now,
        },
      }),
    ]);

    if (dto.status === 'NEEDS_MORE_INFO') {
      await this.reopenForDoctor(submission.id);
    }
    if (dto.status === 'APPROVED' && dto.purgeDocuments !== false) {
      await this.purgeDocuments(submission.id);
    }

    invalidateDoctorCaches(doctorUserId);
    this.notify(dto.status, doctor, dto.reason);

    return this.getDossierForAdmin(doctorUserId);
  }

  async signDocument(documentId: string, doctorUserId?: string) {
    const doc = await this.prisma.verificationDocument.findUnique({
      where: { id: documentId },
      include: { submission: { include: { doctor_profile: { select: { user_id: true } } } } },
    });
    if (!doc) throw new NotFoundException('Το έγγραφο δεν βρέθηκε.');
    if (doctorUserId && doc.submission.doctor_profile.user_id !== doctorUserId) {
      throw new ForbiddenException();
    }
    if (doc.purged_at) {
      throw new NotFoundException('Το αρχείο έχει διαγραφεί μετά την έγκριση.');
    }

    return {
      url: this.storage.signedUrl(doc.storage_key, doc.resource_type, doc.format),
      expiresInSeconds: 300,
      resourceType: doc.resource_type,
      format: doc.format,
    };
  }

  async recordDocumentAccess(
    actor: { id: string; email: string },
    documentId: string,
    ip?: string,
    userAgent?: string,
  ) {
    const doc = await this.prisma.verificationDocument.findUnique({
      where: { id: documentId },
      select: {
        type: true,
        submission: { select: { doctor_profile: { select: { user_id: true } } } },
      },
    });

    await this.prisma.adminAuditLog
      .create({
        data: {
          actor_id: actor.id,
          actor_email: actor.email,
          action: 'verification.document_view',
          target_type: 'doctor',
          target_id: doc?.submission.doctor_profile.user_id ?? null,
          summary: doc ? DOCUMENT_LABELS[doc.type] : null,
          ip: ip ?? null,
          user_agent: userAgent ?? null,
        },
      })
      .catch((err: unknown) => console.error('[audit] document view not recorded', err));
  }

  async purgeDocuments(submissionId: string) {
    const docs = await this.prisma.verificationDocument.findMany({
      where: { submission_id: submissionId, purged_at: null },
    });

    for (const doc of docs) {
      await this.storage.destroy(doc.storage_key, doc.resource_type).catch(() => {});
    }

    await this.prisma.verificationDocument.updateMany({
      where: { id: { in: docs.map((d) => d.id) } },
      data: { purged_at: new Date() },
    });
  }

  async expireLapsed() {
    const now = new Date();
    const lapsed = await this.prisma.doctorProfile.findMany({
      where: {
        verification_status: 'APPROVED',
        verification_expires_at: { lt: now },
      },
      select: { id: true, user_id: true },
    });
    if (lapsed.length === 0) return { expired: 0 };

    await this.prisma.doctorProfile.updateMany({
      where: { id: { in: lapsed.map((l) => l.id) } },
      data: { verification_status: 'EXPIRED', updated_at: now },
    });

    for (const l of lapsed) invalidateDoctorCaches(l.user_id);
    return { expired: lapsed.length };
  }

  private async presentDossier(
    profile: { id: string; user_id: string; verification_status: VerificationStatus; verified_at: Date | null; verification_expires_at: Date | null },
    submission: SubmissionWithDocs,
    forAdmin: boolean,
  ) {
    const duplicates = forAdmin ? await this.findDuplicateHashes(submission) : new Map<string, string[]>();

    return {
      status: profile.verification_status,
      verifiedAt: profile.verified_at,
      expiresAt: profile.verification_expires_at,
      editable: EDITABLE_STATUSES.includes(submission.status),
      submission: {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submitted_at,
        reviewedAt: submission.reviewed_at,
        decisionReason: submission.decision_reason,
        checklist: submission.checklist,
        ...(forAdmin
          ? {
              adminNotes: submission.admin_notes,
              reviewedByEmail: submission.reviewed_by_email,
              phoneVerifiedAt: submission.phone_verified_at,
              phoneVerifiedNumber: submission.phone_verified_number,
              phoneVerifiedNote: submission.phone_verified_note,
              registryCheckedAt: submission.registry_checked_at,
              registrySource: submission.registry_source,
              registryNote: submission.registry_note,
            }
          : {}),
      },
      documents: submission.documents.map((d) => ({
        id: d.id,
        type: d.type,
        label: DOCUMENT_LABELS[d.type],
        status: d.status,
        filename: d.original_filename,
        bytes: d.bytes,
        format: d.format,
        expiresAt: d.expires_at,
        uploadedAt: d.uploaded_at,
        purgedAt: d.purged_at,
        reviewerNote: d.reviewer_note,
        ...(forAdmin ? { duplicateOf: duplicates.get(d.id) ?? [] } : {}),
      })),
      required: REQUIRED_DOCUMENTS.map((type) => ({
        type,
        label: DOCUMENT_LABELS[type],
        uploaded: submission.documents.some((d) => d.type === type),
      })),
      blockers: this.getBlockers(await this.loadProfileFields(profile.user_id), submission),
    };
  }

  private async findDuplicateHashes(submission: SubmissionWithDocs) {
    const hashes = submission.documents.map((d) => d.sha256).filter((h): h is string => !!h);
    const map = new Map<string, string[]>();
    if (hashes.length === 0) return map;

    const matches = await this.prisma.verificationDocument.findMany({
      where: {
        sha256: { in: hashes },
        submission_id: { not: submission.id },
      },
      select: {
        sha256: true,
        submission: {
          select: {
            doctor_profile: {
              select: { user: { select: { email: true, full_name: true } } },
            },
          },
        },
      },
    });

    for (const doc of submission.documents) {
      if (!doc.sha256) continue;
      const owners = matches
        .filter((m) => m.sha256 === doc.sha256)
        .map((m) => m.submission.doctor_profile.user.full_name || m.submission.doctor_profile.user.email);
      if (owners.length > 0) map.set(doc.id, [...new Set(owners)]);
    }
    return map;
  }

  private getBlockers(
    profile: { full_name?: string | null; specialty?: unknown; phone?: string | null; medical_association_number?: string | null; ghs_provider_id?: string | null },
    submission: SubmissionWithDocs,
  ): string[] {
    const blockers: string[] = [];

    if (!profile.full_name) blockers.push('Πλήρες όνομα');
    if (!profile.specialty) blockers.push('Ειδικότητα');
    if (!profile.phone) blockers.push('Τηλέφωνο');
    if (!profile.medical_association_number && !profile.ghs_provider_id) {
      blockers.push('Αριθμός μητρώου ή ΓεΣΥ');
    }

    for (const type of REQUIRED_DOCUMENTS) {
      if (!submission.documents.some((d) => d.type === type)) {
        blockers.push(DOCUMENT_LABELS[type]);
      }
    }

    return blockers;
  }

  private async loadProfileFields(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        full_name: true,
        doctor_profile: {
          select: { specialty: true, phone: true, medical_association_number: true, ghs_provider_id: true },
        },
      },
    });
    return {
      full_name: user?.full_name ?? null,
      specialty: user?.doctor_profile?.specialty ?? null,
      phone: user?.doctor_profile?.phone ?? null,
      medical_association_number: user?.doctor_profile?.medical_association_number ?? null,
      ghs_provider_id: user?.doctor_profile?.ghs_provider_id ?? null,
    };
  }

  private async requireDoctorProfile(userId: string) {
    const profile = await this.prisma.doctorProfile.findUnique({ where: { user_id: userId } });
    if (!profile) throw new NotFoundException('Doctor profile not found');
    return profile;
  }

  private async requireLatestSubmission(doctorUserId: string): Promise<SubmissionWithDocs> {
    const profile = await this.requireDoctorProfile(doctorUserId);
    const submission = await this.prisma.verificationSubmission.findFirst({
      where: { doctor_profile_id: profile.id },
      include: SUBMISSION_INCLUDE,
      orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }],
    });
    if (!submission) throw new NotFoundException('Δεν υπάρχει αίτηση επαλήθευσης.');
    return submission;
  }

  private async getOrCreateOpenSubmission(
    doctorProfileId: string,
    profileStatus: VerificationStatus,
  ): Promise<SubmissionWithDocs> {
    const open = await this.prisma.verificationSubmission.findFirst({
      where: { doctor_profile_id: doctorProfileId, status: { in: EDITABLE_STATUSES } },
      include: SUBMISSION_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    if (open) return open;

    const latest = await this.prisma.verificationSubmission.findFirst({
      where: { doctor_profile_id: doctorProfileId },
      include: SUBMISSION_INCLUDE,
      orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }],
    });

    const closed: VerificationStatus[] = ['APPROVED', 'PENDING', 'IN_REVIEW', 'REVOKED'];
    if (latest && closed.includes(latest.status)) return latest;

    return this.prisma.verificationSubmission.create({
      data: { doctor_profile_id: doctorProfileId, status: 'DRAFT' },
      include: SUBMISSION_INCLUDE,
    });
  }

  private async reopenForDoctor(previousSubmissionId: string) {
    const previous = await this.prisma.verificationSubmission.findUniqueOrThrow({
      where: { id: previousSubmissionId },
      include: SUBMISSION_INCLUDE,
    });

    const next = await this.prisma.verificationSubmission.create({
      data: {
        doctor_profile_id: previous.doctor_profile_id,
        status: 'NEEDS_MORE_INFO',
        admin_notes: previous.admin_notes,
        checklist: (previous.checklist ?? Prisma.DbNull) as Prisma.InputJsonValue,
        phone_verified_at: previous.phone_verified_at,
        phone_verified_number: previous.phone_verified_number,
        phone_verified_note: previous.phone_verified_note,
        registry_checked_at: previous.registry_checked_at,
        registry_source: previous.registry_source,
        registry_note: previous.registry_note,
      },
    });

    const carried = previous.documents.filter((d) => d.status !== 'REJECTED' && !d.purged_at);
    if (carried.length > 0) {
      await this.prisma.verificationDocument.updateMany({
        where: { id: { in: carried.map((d) => d.id) } },
        data: { submission_id: next.id },
      });
    }
  }

  private assertEditable(status: VerificationStatus) {
    if (!EDITABLE_STATUSES.includes(status)) {
      throw new ForbiddenException('Η αίτηση βρίσκεται σε έλεγχο και δεν μπορεί να τροποποιηθεί.');
    }
  }

  private touch(submissionId: string) {
    return this.prisma.verificationSubmission.update({
      where: { id: submissionId },
      data: { updated_at: new Date() },
    });
  }

  private notify(
    status: VerificationStatus,
    doctor: { email: string; full_name: string | null; business_name: string | null },
    reason?: string,
  ) {
    const appUrl = this.config.get<string>('appUrl') ?? 'https://bookpro.gr';
    const name = doctor.business_name || doctor.full_name || doctor.email;

    if (status === 'APPROVED') {
      this.email.sendDoctorApproved({ to: doctor.email, name, appUrl }).catch(() => {});
    } else if (status === 'NEEDS_MORE_INFO') {
      this.email
        .sendDoctorNeedsInfo({ to: doctor.email, name, reason: reason ?? '', appUrl })
        .catch(() => {});
    } else if (status === 'REJECTED' || status === 'REVOKED') {
      this.email.sendDoctorRejected({ to: doctor.email, name, reason, appUrl }).catch(() => {});
    }
  }
}
