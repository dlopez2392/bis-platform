-- 0062_email_suppression.sql
-- D-016 (docs/crm-features.md, Messaging): "nothing stops later mail to an
-- address that bounced or complained". A HARD bounce or a spam complaint
-- becomes a consent-ledger STOP on the email channel, written through 0055's
-- one write path (public.append_consent_event, EXECUTE service_role only) by
-- packages/db/src/consent.ts's recordEmailSuppression, which the Resend
-- webhook calls. A soft (transient) bounce writes nothing.
--
-- ADDITIVE ONLY. The build before this file runs unchanged against it: it
-- never writes either new method, and the new CHECK binds only rows that name
-- one, of which there are none. So production takes this file BEFORE the
-- merge deploy, and the build after it can rely on it from its first request.
--
-- 1. consent_events_method_check gains 'email_bounce' and 'email_complaint'.
--    The list is 0054's (0054:55-58) verbatim, plus the two at the end.
-- 2. consent_events_suppression_shape_check: either method is an email
--    'revoked' row and nothing else (not sms, not a grant, hold or lift).
--
-- Scope: per ADDRESS within the account, because that is the ledger's key
-- (account, channel, address) and the send gate's (emailLedgerAddress of the
-- recipient), so mail to that address is refused whichever contact it is
-- addressed through, and a contact whose address is corrected is a new key.
--
-- What is NOT changed, on purpose: append_consent_event. Under guard 'none' a
-- revoked row with either method meets no state rule, so it lands over any
-- earlier stop. 0055 already refuses every staff lift of it (a staff Resume
-- lifts only a staff, free_text or backfill_0049 stop; a staff undo only a
-- staff stop; a staff stop lands only on an allowed address), and lets the
-- customer's own resubscribe (resubscribed / unsubscribe_page, guard
-- if_stopped_or_held) lift it like any other stop. Neither method joins the
-- unless_customer_stopped list, so consent.ts's CUSTOMER_STOP_METHODS and
-- apps/web's unsubscribe.test.ts (which reads 0055's text) stay true.
-- Grants and RLS are unchanged: no role gains anything, consent_events_read
-- stays the account's users' SELECT, and no role holds UPDATE or DELETE.
--
-- No backslash anywhere in this file (the MCP apply rule).
--
-- ROLLBACK (roll the app back first; the build after this file writes both methods):
--   the rows are consent evidence that no app role can delete, so a rollback
--   with rows present keeps both constraints as they are. With none present:
--   alter table public.consent_events drop constraint consent_events_suppression_shape_check;
--   alter table public.consent_events drop constraint consent_events_method_check;
--   then re-add 0054's consent_events_method_check exactly.

set local lock_timeout = '5s';

alter table public.consent_events drop constraint consent_events_method_check;
alter table public.consent_events add constraint consent_events_method_check
  check (method in (
    'keyword', 'start_keyword', 'free_text', 'staff', 'staff_undo', 'carrier_block',
    'unsubscribe_link', 'one_click', 'unsubscribe_page', 'form', 'booking', 'inbound_text',
    'backfill_0049', 'backfill_telnyx',
    'email_bounce', 'email_complaint'));

alter table public.consent_events add constraint consent_events_suppression_shape_check
  check (method not in ('email_bounce', 'email_complaint') or (channel = 'email' and action = 'revoked'));

comment on constraint consent_events_suppression_shape_check on public.consent_events is
  'D-016 (0062): email_bounce (a HARD bounce) and email_complaint (a spam complaint) are email stops only. Written by consent.ts recordEmailSuppression from the Resend webhook; lifted only by the customer''s own resubscribe.';
