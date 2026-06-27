-- Remove schema objects that the application never reads or writes.
-- All IF EXISTS so the migration is safe whether or not the object was ever
-- materialised in the target database (Prisma never creates unused enum types,
-- and "Account" is a NextAuth leftover that may or may not exist).

-- 1. NextAuth leftover — JWT auth is the only mechanism; no prisma.account.* calls.
DROP TABLE IF EXISTS "Account";

-- 2. Recurrence feature was designed but never implemented (0 reads/writes).
--    Dropping the column also drops the self-referencing FK constraint.
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "parent_appointment_id";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "recurrence_pattern";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "recurrence_end_date";

-- 3. Enum types defined in schema but never used as a column type
--    (appointments.status and profiles.subscription_status are plain TEXT).
DROP TYPE IF EXISTS "appointment_status";
DROP TYPE IF EXISTS "subscription_status";
