-- Google Calendar 2-way sync: OAuth tokens on the doctor's profile + event id on appointments.
-- All columns additive and nullable — safe, no data loss.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "google_refresh_token" TEXT,
  ADD COLUMN IF NOT EXISTS "google_access_token" TEXT,
  ADD COLUMN IF NOT EXISTS "google_token_expiry" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "google_calendar_id" TEXT DEFAULT 'primary';

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "google_event_id" TEXT;
