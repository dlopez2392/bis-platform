-- 0038_transfer_answered_by.sql
-- What picked up when we transferred a caller — recorded, and acted on by
-- nothing.
--
-- 0037's own spec says a voicemail "reads as a human, and cannot be told
-- apart... nothing in the carrier payload distinguishes them". THAT CLAIM IS
-- WRONG, and three real calls on 2026-09-17 are why it matters: a transfer to
-- a number whose voicemail answers is stamped `transferred`, counts as the
-- best outcome the product has, and suppresses the missed-call text-back. The
-- caller reached a machine and the business is told they reached a person.
--
-- Telnyx does offer answering-machine detection on a TeXML `<Dial>` — the
-- result arrives as `AnsweredBy` on a status callback. We simply never asked
-- for it.
--
-- THIS MIGRATION CHANGES NO BEHAVIOUR AND IS NOT MEANT TO. It adds one
-- nullable column so a detection result can be WRITTEN DOWN while every
-- existing decision — the outcome stamp, the text-back gate, the summary —
-- goes on ignoring it. The reason is the failure mode: a false `human` costs
-- nothing we are not already paying, but a false `machine` would record a
-- real conversation as a failed transfer and text somebody "Sorry we missed
-- you just now" minutes after they spoke to a person. That is the sharpest
-- failure in this product's design, and it is not one to accept on a vendor's
-- reputation. So: measure first on real calls, compare against what actually
-- happened, and only then let anything read this column.


-- ─────────────────────────────────────────────────────────────────────────
-- `calls.transfer_answered_by`
--
-- NO CHECK CONSTRAINT, and that is deliberate rather than lazy.
--
-- Everywhere else in this schema a constrained vocabulary is the right call —
-- `calls_outcome_check` exists precisely so a seventh outcome cannot appear
-- without a migration saying so. This column is the opposite situation: its
-- values are chosen by a CARRIER, not by us, and the whole point of the
-- column is to find out what they actually are. Telnyx documents `human`,
-- `machine_start`, `fax` and `unknown` for `Enable` mode, plus
-- `machine_end_beep`, `machine_end_silence` and `machine_end_other` for
-- `DetectMessageEnd` — but a constraint here would mean a value we did not
-- anticipate is DROPPED ON THE FLOOR by the very migration whose job is to
-- observe. An observation column that refuses unexpected observations is
-- worthless.
--
-- When the behaviour phase lands and the set is known from real traffic, a
-- check belongs here. Not before.
--
-- NULL is the normal state and always will be: it means no detection result
-- for this call. Every call that never asked for a person, every call from
-- before this migration, and every transfer where the callback never arrived.
-- NULL is NOT "human" and must never be read as one.
alter table public.calls add column transfer_answered_by text;

comment on column public.calls.transfer_answered_by is
  'What answered the transferred leg, from the carrier''s answering-machine detection (Telnyx AnsweredBy). OBSERVATION ONLY as of 0038 — nothing reads it. NULL means no result, never "human". Unconstrained on purpose: the values are the carrier''s to choose and this column exists to learn them.';


-- ─────────────────────────────────────────────────────────────────────────
-- GRANTS — none, and the absence is the same decision 0037 made.
--
-- `authenticated` has NO write verb on public.calls at all: 0020 revoked
-- insert, update, delete, truncate, references and trigger on this table and
-- re-granted none, because a call is a RECORD and a client who could write one
-- could rewrite what happened on it. A new column inherits that nothing, and
-- must. serviceDb() writes this one, from the AMD callback route; that is the
-- whole list.
--
-- `authenticated` keeps table-level SELECT, so a member of the owning account
-- can read it — the same position every other column on this table is in, and
-- `calls_tenant` is a ROW policy, so they only ever see their own account's
-- calls. Nothing further is needed and no RLS policy is added: a Postgres
-- policy is row-scoped, never column-scoped, so `calls_tenant` already covers
-- this column.
--
-- `anon` has nothing on public.calls (0020 revoked all) and gains nothing.
