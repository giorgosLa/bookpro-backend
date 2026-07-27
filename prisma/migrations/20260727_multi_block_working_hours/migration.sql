-- Split shifts: a weekday may now hold several working_hours rows (e.g. 09:00–13:00
-- and 17:00–21:00). No constraint change is needed — the table never had a unique on
-- (profile_id, location_id, day_of_week) — only the two new per-window columns.

-- Minutes between consecutive bookable slots inside this window. NULL = 30 (previous
-- hardcoded step), so every existing row keeps its current behaviour.
ALTER TABLE "working_hours" ADD COLUMN "slot_interval_minutes" INTEGER;

-- Display/creation order of the windows within a day.
ALTER TABLE "working_hours" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
