-- Create appointment_services junction table (idempotent)
CREATE TABLE IF NOT EXISTS appointment_services (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  appointment_id UUID        NOT NULL,
  service_id     UUID        NOT NULL,
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT appointment_services_pkey PRIMARY KEY (id),
  CONSTRAINT appointment_services_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT appointment_services_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT appointment_services_appointment_id_service_id_key
    UNIQUE (appointment_id, service_id)
);

CREATE INDEX IF NOT EXISTS appointment_services_appointment_id_idx ON appointment_services(appointment_id);

-- Migrate existing data only if service_id column still exists on appointments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'service_id'
  ) THEN
    INSERT INTO appointment_services (id, appointment_id, service_id, created_at)
    SELECT gen_random_uuid(), a.id, a.service_id, a.created_at
    FROM appointments a
    WHERE a.service_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_service_id_fkey;
    ALTER TABLE appointments DROP COLUMN IF EXISTS service_id;
  END IF;
END $$;
