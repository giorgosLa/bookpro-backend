-- Convert ref_number from auto-increment integer to random short code string
ALTER TABLE appointments DROP COLUMN IF EXISTS ref_number;
ALTER TABLE appointments ADD COLUMN ref_number TEXT;
UPDATE appointments SET ref_number = gen_random_uuid()::text WHERE ref_number IS NULL;
ALTER TABLE appointments ALTER COLUMN ref_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_ref_number_key ON appointments(ref_number);
