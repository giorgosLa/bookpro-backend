-- Per-clinic timezone for correct multi-country slot generation / booking.
-- Nullable, no default → existing rows fall back to the doctor's profile timezone.
ALTER TABLE "locations" ADD COLUMN "timezone" TEXT;
