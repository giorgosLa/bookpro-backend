-- Admin audit trail: one row per state-changing admin action.
-- Purely additive — creates a new table, touches nothing existing.
--
-- actor_id / target_id are intentionally NOT foreign keys: the log has to
-- outlive the accounts it describes (a user.delete entry must survive the
-- very user it records being deleted).

CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id"    UUID NOT NULL,
  "actor_email" TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "target_type" TEXT,
  "target_id"   TEXT,
  "summary"     TEXT,
  "payload"     JSONB,
  "snapshot"    JSONB,
  "ip"          TEXT,
  "user_agent"  TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx" ON "admin_audit_log" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "admin_audit_log_actor_id_idx"   ON "admin_audit_log" ("actor_id");
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_id_idx"  ON "admin_audit_log" ("target_id");
CREATE INDEX IF NOT EXISTS "admin_audit_log_action_idx"     ON "admin_audit_log" ("action");
