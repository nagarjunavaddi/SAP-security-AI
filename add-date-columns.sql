-- add-date-columns.sql  [IK-DB-DATES]
-- Adds valid_from / valid_to to approval_requests. Safe to run once.
-- IF NOT EXISTS -> re-running does nothing (idempotent).
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS valid_from TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS valid_to   TEXT;
