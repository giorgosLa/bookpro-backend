-- Doctors were created with the schema default "UTC", which was never a real
-- choice — the platform serves Greece/Cyprus (both EET/EEST). Now that booking
-- instants are converted using the stored timezone, "UTC" shifts every time by
-- the offset. Make the default the clinic default and backfill the placeholder.
ALTER TABLE "profiles" ALTER COLUMN "timezone" SET DEFAULT 'Europe/Athens';
UPDATE "profiles" SET "timezone" = 'Europe/Athens' WHERE "timezone" IS NULL OR "timezone" = 'UTC';
