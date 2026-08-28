-- 0021: the same Telnyx number must never be attached twice (wizard makes
-- assignment/reassignment a button; this is the DB-level guardrail).
-- Partial: telnyx_id is nullable — manually assigned numbers may omit it.
create unique index phone_numbers_telnyx_id_unique
  on public.phone_numbers (telnyx_id) where telnyx_id is not null;
