-- Doctor verification: private document dossiers, per-attempt history, expiry.

-- The status enum is recreated rather than extended with ALTER TYPE ... ADD VALUE,
-- because Postgres refuses to use a newly added enum value inside the same
-- transaction — and the backfill below needs 'DRAFT' immediately.
ALTER TYPE "VerificationStatus" RENAME TO "VerificationStatus_old";

CREATE TYPE "VerificationStatus" AS ENUM (
  'DRAFT', 'PENDING', 'IN_REVIEW', 'NEEDS_MORE_INFO',
  'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED'
);

ALTER TABLE "doctor_profiles" ALTER COLUMN "verification_status" DROP DEFAULT;
ALTER TABLE "doctor_profiles"
  ALTER COLUMN "verification_status" TYPE "VerificationStatus"
  USING ("verification_status"::text::"VerificationStatus");
ALTER TABLE "doctor_profiles" ALTER COLUMN "verification_status" SET DEFAULT 'DRAFT';

DROP TYPE "VerificationStatus_old";

CREATE TYPE "VerificationDocumentType" AS ENUM (
  'REGISTRATION_CERTIFICATE', 'ID_FRONT', 'ID_BACK', 'DEGREE',
  'SPECIALTY_TITLE', 'GHS_CONTRACT', 'MALPRACTICE_INSURANCE', 'OTHER'
);

CREATE TYPE "VerificationDocumentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

ALTER TABLE "doctor_profiles" ADD COLUMN "ghs_provider_id" VARCHAR(50);
ALTER TABLE "doctor_profiles" ADD COLUMN "verified_at" TIMESTAMPTZ(6);
ALTER TABLE "doctor_profiles" ADD COLUMN "verification_expires_at" TIMESTAMPTZ(6);

CREATE TABLE "verification_submissions" (
  "id"                    UUID NOT NULL,
  "doctor_profile_id"     UUID NOT NULL,
  "status"                "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_at"          TIMESTAMPTZ(6),
  "reviewed_at"           TIMESTAMPTZ(6),
  "reviewed_by_id"        UUID,
  "reviewed_by_email"     TEXT,
  "decision_reason"       TEXT,
  "admin_notes"           TEXT,
  "checklist"             JSONB,
  "phone_verified_at"     TIMESTAMPTZ(6),
  "phone_verified_number" VARCHAR(30),
  "phone_verified_note"   TEXT,
  "registry_checked_at"   TIMESTAMPTZ(6),
  "registry_source"       VARCHAR(60),
  "registry_note"         TEXT,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verification_documents" (
  "id"                UUID NOT NULL,
  "submission_id"     UUID NOT NULL,
  "type"              "VerificationDocumentType" NOT NULL,
  "status"            "VerificationDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "storage_key"       VARCHAR(500) NOT NULL,
  "resource_type"     VARCHAR(20) NOT NULL DEFAULT 'image',
  "format"            VARCHAR(10),
  "original_filename" VARCHAR(255),
  "bytes"             INTEGER,
  "sha256"            VARCHAR(64),
  "reviewer_note"     TEXT,
  "expires_at"        DATE,
  "uploaded_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purged_at"         TIMESTAMPTZ(6),
  CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verification_submissions_doctor_profile_id_idx" ON "verification_submissions"("doctor_profile_id");
CREATE INDEX "verification_submissions_status_idx" ON "verification_submissions"("status");
CREATE INDEX "verification_submissions_submitted_at_idx" ON "verification_submissions"("submitted_at" DESC);
CREATE INDEX "verification_documents_submission_id_idx" ON "verification_documents"("submission_id");
CREATE INDEX "verification_documents_sha256_idx" ON "verification_documents"("sha256");

ALTER TABLE "verification_submissions"
  ADD CONSTRAINT "verification_submissions_doctor_profile_id_fkey"
  FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verification_documents"
  ADD CONSTRAINT "verification_documents_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "verification_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill 1: PENDING used to mean two different things — "just signed up" and
-- "waiting for review" — told apart only by terms_accepted. Split them properly.
UPDATE "doctor_profiles"
   SET "verification_status" = 'DRAFT'
 WHERE "verification_status" = 'PENDING'
   AND "terms_accepted" = false;

-- Backfill 2: approved doctors get an audit date and a one-year expiry, counted
-- from their last profile update since no decision timestamp was ever recorded.
UPDATE "doctor_profiles"
   SET "verified_at" = "updated_at",
       "verification_expires_at" = "updated_at" + INTERVAL '1 year'
 WHERE "verification_status" = 'APPROVED';

-- Backfill 3: one submission row per existing dossier, so the history table is
-- not empty for doctors who were decided under the old flow. Documents cannot be
-- backfilled — the legacy id_photo_url is a public URL, not a private key, and
-- stays on doctor_profiles until each doctor re-uploads.
INSERT INTO "verification_submissions" (
  "id", "doctor_profile_id", "status", "submitted_at", "reviewed_at",
  "decision_reason", "admin_notes", "checklist", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  dp."id",
  dp."verification_status",
  dp."created_at",
  CASE WHEN dp."verification_status" IN ('APPROVED', 'REJECTED') THEN dp."updated_at" END,
  dp."rejection_reason",
  dp."admin_notes",
  dp."verification_checklist",
  dp."created_at",
  dp."updated_at"
FROM "doctor_profiles" dp
WHERE dp."verification_status" <> 'DRAFT';
