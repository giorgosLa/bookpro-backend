-- Human-readable name of the audited target, resolved at write time.
-- The UUID in target_id cannot be joined back once the row it points at is deleted,
-- which is exactly the case the audit log exists for.
-- Additive and nullable — existing rows keep NULL.

ALTER TABLE "admin_audit_log"
  ADD COLUMN IF NOT EXISTS "target_label" TEXT;
