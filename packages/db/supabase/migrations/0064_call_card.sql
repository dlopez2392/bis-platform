-- 0064_call_card.sql
-- Every call leaves a card: why they called, the number to call back, and
-- the caller's own words. And when the caller wants a call back, a To do
-- exists for a person to make that call.
--
-- WHY. A caller's message and callback number lived only in the transcript
-- and the summary. `take_message` and `capture_lead` record both during the
-- call (apps/web/src/lib/voice/tools/registry.ts), but the call state they
-- live in dies with the request, and `finishCall` never stored either:
-- `TakenMessage.callbackNumber` had no reader anywhere. Who called, why and
-- on which number is what an answering service sells.
--
-- WHAT.
--   1. calls.reason, calls.callback_number, calls.caller_words: text, NULL.
--      NULL = no card, which is every call that exists today, every spam
--      call, and any call whose card leg failed (the call itself is recorded
--      exactly as before; the card is written by a SEPARATE update after
--      finishCallRow, never inside it).
--        reason          one line: what Sofia wrote down when she took the
--                        message or the lead, else a one-line reading of the
--                        transcript.
--        callback_number as the caller said it, or the caller ID (the same
--                        rule the lead's contact write uses, `spokenPhone`).
--                        Never parsed into E.164 here: a ten-digit number can
--                        be a US or a Mexican one, and a person is about to
--                        dial it.
--        caller_words    one caller turn, verbatim from calls.transcript
--                        (the proposals' grounding rule: never the
--                        assistant, never a paraphrase).
--   2. UNIQUE (account_id, id) on calls. Redundant as a uniqueness rule (id
--      is the primary key), there only because a foreign key must reference
--      a unique key on exactly its target columns (0050, 0055, 0061).
--   3. tasks.call_id uuid NULL, with
--        (account_id, call_id) -> calls (account_id, id)
--        ON DELETE SET NULL (call_id)
--      The call a callback To do came from. Same-account by construction
--      (0050's composite pattern). It is also how a To do is shown as
--      Sofia's (DESIGN.md, provenance: every row names who did it).
--      The COLUMN LIST on SET NULL is load-bearing (0061's finding): a plain
--      SET NULL on a composite key nulls account_id too, which is NOT NULL,
--      so deleting a call that had a To do would fail. account-teardown.ts
--      deletes calls BEFORE tasks, which is exactly that case.
--   4. tasks_call_once: one callback To do per call. finishCall runs once per
--      call, so this is a guard, not a dedupe path: a second insert answers
--      23505 and ensureCallbackTask returns the first row. It is also the
--      FK's delete-side index.
--
-- GRANTS. None in this file, on purpose.
--   calls: since 0020 the client role (authenticated) holds table-level
--   SELECT only; the new columns inherit it, so the card is readable by a
--   signed-in member under calls_tenant and writable only by the service
--   role, which is the client finishCall runs with.
--   tasks: keeps its table-level grants (authenticated INSERT, UPDATE,
--   DELETE; schema-grants-guard.test.ts pins them), so call_id is
--   client-writable like every other tasks column, exactly as 0055's
--   consent_event_id is. The composite key means a client can only link its
--   own account's task to its own account's call. What a client could do
--   with that is label one of its own To dos as coming from one of its own
--   calls; nothing acts on the link.
--
-- ADDITIVE ONLY. The build before this file never names the new columns,
-- and its inserts get NULL. Production can take this file BEFORE the merge
-- deploy. The build after it reads the card with its own query on the calls
-- pages (a failure there renders no card, never no page) and writes it with
-- its own update in finishCall's tail (a failure there loses the card, never
-- the call row). Two reads name tasks.call_id: openTasks (work-queue.ts),
-- behind the account dashboard, the To do page and the agency work page, and
-- listContactTasks (activities.ts), behind the contact page. Without this
-- file those four pages would error (42703); both reads therefore retry
-- without the column on exactly that error (call-id-fallback.ts, TEMPORARY,
-- removed once this file is on production), and a To do then shows without
-- its author mark. Apply to production before the app ships all the same:
-- the fallback is a net, not the plan.
--
-- LOCKS AND COST. The UNIQUE build takes ACCESS EXCLUSIVE on calls for the
-- length of a small index build; ADD COLUMN with no default is
-- catalogue-only; validating the FK reads tasks rows whose new column is
-- NULL, which pass.
--
-- PostgREST: a new tasks -> calls relationship. Nothing in packages/ or
-- apps/ embeds calls from tasks or tasks from calls (grepped before writing
-- this file). tasks is not a junction table to PostgREST (its primary key is
-- id alone), so contacts -> calls embeds are unchanged; call_proposals has
-- the same two FKs already.
--
-- ROLLBACK (roll the app back first; the build after this file writes and
-- reads these columns):
--   drop index public.tasks_call_once;
--   alter table public.tasks drop column call_id;   (drops tasks_call_fkey)
--   alter table public.calls drop constraint calls_account_id_id_key;
--   alter table public.calls drop column reason, drop column callback_number,
--     drop column caller_words;
--
-- ASCII only, no backslash anywhere (the MCP apply rule).

set local lock_timeout = '5s';

alter table public.calls
  add column reason text,
  add column callback_number text,
  add column caller_words text;

alter table public.calls
  add constraint calls_account_id_id_key unique (account_id, id);

alter table public.tasks
  add column call_id uuid,
  add constraint tasks_call_fkey
    foreign key (account_id, call_id) references public.calls (account_id, id)
    on delete set null (call_id);

create unique index tasks_call_once
  on public.tasks (call_id) where call_id is not null;

comment on column public.calls.reason is
  'Why the caller called, in one line: the message or lead Sofia recorded, else a one-line reading of the transcript. NULL = no card. Written by the service role after the call row is finished.';
comment on column public.calls.callback_number is
  'The number to call back, as the caller said it or the caller ID. Not normalised: a ten-digit number can be US or Mexican. NULL = no card or no number.';
comment on column public.calls.caller_words is
  'One caller turn, verbatim from the transcript, in which the caller says why they called. Never the assistant. NULL = none found.';
comment on column public.tasks.call_id is
  'The call this callback To do came from. Written by the voice lifecycle as the service role; a To do with a call_id is shown as Sofia''s. Client-writable like every tasks column, same-account by the composite FK. One To do per call.';
