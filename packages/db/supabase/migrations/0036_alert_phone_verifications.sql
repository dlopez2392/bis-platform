-- 0036_alert_phone_verifications.sql
-- Proof that somebody holds the alert phone, before the number is saved.
--
-- 0035 added `accounts.alert_phone` and named this gap in its own Decision 1,
-- rather than leaving it to be discovered: the agency writes that number with
-- nothing proving anybody holds the handset. One mistyped digit and this
-- platform sends a stranger a continuous stream of customers' names and
-- appointment times — and there is NO SYMPTOM. The screen still shows a
-- number, the sends still succeed, the provider still returns a message id.
-- The only person who could notice is the one person who never sees the
-- texts. 0035 wrote down exactly what would have to exist to close it: "a
-- write path that sends a confirmation code to the number and stores it only
-- once the code comes back." This is that storage.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THE EMAIL PRECEDENT DOES NOT TRANSFER, and it is worth reading before
-- anything below, because the next person WILL reach for it.
--
-- 0035 points at `saveVerifiedFromAddress` (apps/web/src/lib/email/
-- preflight.ts) as the shape to copy, and for `from_email` it is the right
-- shape: it verifies, then writes, and stores NOTHING in between. That works
-- for one reason and it is a property of Resend, not a property of good
-- design — Resend REJECTS an unverified sender SYNCHRONOUSLY, with a 403, on
-- the send itself. The answer arrives inside the same request that asked the
-- question, so one real send is the whole gate and there is no state to keep.
--
-- A carrier does not do that. An SMS to a valid number that belongs to a
-- stranger is ACCEPTED — queued, billed, delivered, and acknowledged with a
-- message id. A successful send proves the number is DIALABLE and proves
-- absolutely nothing about who holds it, which is the only question worth
-- asking here. Possession can be established one way and one way only: a
-- round trip through a human who reads a code back. That round trip crosses
-- two requests, with a human and a handset in between, so it needs somewhere
-- to wait. THIS IS THE ONE THAT GENUINELY NEEDS STATE. Nobody should read
-- `saveVerifiedFromAddress` and conclude a table is over-engineering here;
-- the email path needed none because its provider answered synchronously,
-- and ours does not.
--
-- The send that carries the code goes through `resolveSmsSender`, the same
-- A2P-gated sender every alert uses, so an account that cannot send alerts
-- cannot verify a number either. That is CORRECT rather than a limitation:
-- the gate that would stop the code is the same gate that would stop every
-- alert, and a number that could never be texted has nothing to prove.


-- ─────────────────────────────────────────────────────────────────────────
-- DECISION 1 — A TABLE, NOT COLUMNS ON `accounts`.
--
-- Four columns (`alert_phone_pending`, `alert_phone_code_hash`,
-- `alert_phone_code_expires_at`, `alert_phone_code_attempts`) would work for
-- the happy path, and they are the wrong shape for three separate reasons.
--
--   1. THE HALF-VERIFIED VALUE MUST HAVE NOWHERE TO LIVE. The brief for this
--      column is that it "should only ever hold a number somebody proved they
--      hold." Put the pending number in a column ADJACENT to `alert_phone`
--      and the two are one careless UPDATE, one copy-paste, or one later
--      "simplification" apart. In a separate table, "claimed" and "proven"
--      are different PLACES, and there is no representable state in which
--      `accounts.alert_phone` holds a number nobody answered for. That is a
--      structural guarantee rather than a discipline, which is the only kind
--      that survives.
--
--   2. AN AGENCY THAT MISTYPES TWICE MUST NOT BE LOCKED OUT BY ITS OWN FIRST
--      ATTEMPT. One row per account means one pending verification per
--      account: type the wrong number, realise it, and the correction has
--      nowhere to go until the wrong one expires — or it overwrites the first
--      and the code already in flight to a stranger's handset silently
--      becomes valid for a DIFFERENT number. A column model cannot hold two
--      live attempts. This one structurally can, and Decision 4 makes that
--      deliberate rather than accidental.
--
--   3. 0013 MAKES EVERY `accounts` COLUMN ANSWER THE GRANT QUESTION. That
--      migration revoked UPDATE on `public.accounts` wholesale and re-granted
--      it one column at a time, so four new columns are four new answers, all
--      of them "no", each one an opportunity for a later migration to get one
--      wrong out of habit. And "no" would not even be sufficient: SELECT on
--      `accounts` is TABLE-LEVEL for `authenticated` (0035 verified this and
--      relies on it so the client can SEE their alert number), so a
--      `code_hash` column on `accounts` would be READABLE by every token in
--      the org the moment it existed. See Decision 5 for why that single fact
--      would defeat the entire gate.
--
-- The cost, named: one more table, one more cleanup question (Decision 6),
-- and a two-statement write path instead of one. Decision 3 shows that path
-- has a safe failure direction, which is what makes the cost acceptable.

create table public.alert_phone_verifications (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE, not `restrict`, and there is already a precedent for
  -- that here — read live rather than remembered: of the 28 foreign keys
  -- pointing at `public.accounts`, 8 are `restrict` (bookings, calendars,
  -- calls, phone_numbers, sites and the traffic pair, voice_profiles,
  -- automations), 17 predate 0017 and name no action at all, `blueprints`
  -- is `set null`, and exactly one is CASCADE: 0033's
  -- `contact_duplicate_flags`. That one is the right company to keep. It is
  -- DERIVED, cheap to recompute and worthless on its own, so nothing is lost
  -- by letting it go — and, like this table, it is deliberately absent from
  -- `ACCOUNT_OWNED_TABLES` for that reason.
  --
  -- Restrict exists to protect LEAD-BEARING rows: 0017 made bookings restrict
  -- because a booking is a lead and a lead must never vanish as a side
  -- effect. A verification is the other kind of row — a ten-minute secret,
  -- worthless the minute after it expires, carrying no customer's data at all
  -- (the number in it is the BUSINESS's own). Restrict would buy nothing and
  -- cost something real: deleting an account would fail on a dead code, which
  -- is 0035 Decision 3's own objection ("provisioning can fail at 2 AM
  -- because of a value in a different table") in a new outfit. So the rows go
  -- when the account goes, and a test proves that rather than assuming it.
  account_id uuid not null references public.accounts(id) on delete cascade,

  -- The number being CLAIMED. Not yet the number alerts go to — that is
  -- `accounts.alert_phone` and it is written only after this row is consumed.
  --
  -- The regex is `phone_numbers_e164_check`'s, verbatim, for the reason 0035
  -- Decision 2 argues at length: this platform has exactly ONE definition of
  -- "a number we can reach", and a second dialect of it means a number one
  -- column accepts and the send path cannot dial. The grants test extracts
  -- the pattern from BOTH constraint definitions and compares them, so drift
  -- in either direction is red.
  phone text not null
    constraint alert_phone_verifications_phone_check
    check (phone ~ '^\+[0-9]{8,15}$'),

  -- DECISION 2a — HASHED, NOT AS WRITTEN, and the honest reason is narrower
  -- than the reflex.
  --
  -- What hashing does NOT buy: secrecy. An unsalted SHA-256 of a six-digit
  -- code is a million preimages — milliseconds on a laptop — so anyone who
  -- can READ this table can recover the code. Saying otherwise in a comment
  -- would be the kind of claim that gets believed later. A per-row salt would
  -- not change that (the attacker has the salt); only a server-side pepper
  -- would, and that means a shared secret whose rotation instantly breaks
  -- every code in flight, to defend a value that is worthless in ten minutes.
  -- Not worth it. And note the reader who worries most about here — someone
  -- holding the service key — can simply UPDATE `accounts.alert_phone`
  -- directly. The code is not the weakest link for that person and no amount
  -- of hashing would make it one.
  --
  -- What it DOES buy, and why it is still right: the code is not LEGIBLE.
  -- This product's verifier and requester are the SAME PERSON — an agency
  -- operator, setting a client's alert number, who also has dashboard access
  -- to this database. Store the code as written and the shortcut exists:
  -- read it off the row, type it in, move on. That shortcut converts proof of
  -- possession into a rubber stamp, silently, with the best of intentions, on
  -- exactly the busy afternoon this feature was built for. A digest makes the
  -- shortcut cost a deliberate act — pasting a hash into a cracker — which is
  -- no longer something anyone does by accident. THAT is the threat model
  -- here: not an outside attacker, an insider taking the fast path.
  --
  -- The shape is pinned so the column itself refuses the code in the clear:
  -- six digits are not 64 hex characters. Lowercase hex, which is exactly
  -- `encode(digest(code,'sha256'),'hex')` — but SQL never computes it. Node
  -- does (src/alert-phone-verification.ts), and its answer is pinned against
  -- a digest THIS DATABASE produced, because 0033/0034 is what it costs when
  -- two engines disagree about one value and nothing measures it.
  code_hash text not null
    constraint alert_phone_verifications_code_hash_check
    check (code_hash ~ '^[0-9a-f]{64}$'),

  -- DECISION 2b — FIVE ATTEMPTS, IN THE DATABASE.
  --
  -- A six-digit code with unlimited attempts is not a gate; it is a formality
  -- a script walks in minutes. Five wrong guesses out of 10^6 is one in
  -- 200,000 per live code, and buying more guesses means triggering another
  -- send — a text to a real handset, billed, logged, and rate-limited by the
  -- send path.
  --
  -- Five rather than three because the person typing is reading digits off a
  -- phone screen and slips; locking them out on the third slip is the
  -- friction that makes an operator ask for the gate to be removed, and a
  -- gate people route around protects nobody.
  --
  -- It lives in a CHECK rather than only in app code because an app-side
  -- counter FAILS OPEN: the code path that forgets to compare leaves an
  -- unlimited oracle and looks completely normal. The constraint cannot count
  -- for the app, but it makes a sixth attempt unrepresentable, so a broken
  -- verify path errors instead of quietly opening.
  attempts smallint not null default 0
    constraint alert_phone_verifications_attempts_check
    check (attempts >= 0 and attempts <= 5),

  created_at timestamptz not null default now(),

  -- DECISION 2c — TEN MINUTES, as the DEFAULT rather than as app arithmetic,
  -- so a caller that forgets to set it still gets a row that dies. The
  -- operator has the handset in their hand while they do this; an hour of
  -- validity buys nothing and widens the window in which a code sitting
  -- unread in a stranger's message list is still worth something.
  expires_at timestamptz not null default now() + interval '10 minutes',

  -- NULL until the code came back. This column IS the state machine, and
  -- there is no `status` text beside it to disagree with — the 0035 lesson
  -- about "off" needing exactly one spelling, applied to "proven".
  consumed_at timestamptz,

  -- A code cannot live forever, and the cap is a SUBTRACTION on purpose.
  -- `expires_at <= created_at + interval '1 hour'` would have been the
  -- obvious phrasing and it leans on `timestamptz + interval`, which is
  -- STABLE (pg_proc.provolatile = 's', measured read-only on this project
  -- before this file was written) because interval addition consults the
  -- session timezone. `timestamptz - timestamptz` is IMMUTABLE ('i'), so the
  -- subtraction form says the same thing with no volatility question
  -- attached. The same measurement decides Decision 4.
  constraint alert_phone_verifications_lifetime_check
    check (expires_at > created_at and expires_at - created_at <= interval '1 hour'),

  -- An expired code can never be recorded as consumed. This is the one piece
  -- of expiry the DATABASE can enforce without a trigger: even a verify path
  -- that forgets `expires_at > now()` cannot stamp a truthful `consumed_at`
  -- past the deadline. Its limit, stated rather than implied: it binds only
  -- if the caller stamps the real time. A caller that writes a fake timestamp
  -- defeats it — and that caller could equally have written
  -- `accounts.alert_phone` directly, so this constraint is the backstop for
  -- the bug, not for the liar.
  constraint alert_phone_verifications_consumed_check
    check (consumed_at is null
           or (consumed_at >= created_at and consumed_at <= expires_at))
);


-- ─────────────────────────────────────────────────────────────────────────
-- DECISION 3 — WHAT HAPPENS TO `accounts.alert_phone` WHILE THIS IS PENDING:
-- nothing. It is not touched until a code comes back, and there is no
-- "pending" anywhere on `accounts` for a half-verified number to sit in.
--
-- The write order is CONSUME, THEN WRITE, and only that order:
--
--   1. stamp `consumed_at` on the matching live row (the row is now spent),
--   2. write `accounts.alert_phone`.
--
-- These are two statements because both go through PostgREST as service_role
-- and there is no transaction spanning them. That is survivable BECAUSE the
-- failure direction is safe: if (1) succeeds and (2) fails, the code is burnt
-- and the number is NOT set — the operator asks for a new code and nothing
-- was ever half-true. Reverse the order and the same crash leaves the number
-- live with no proof behind it, which is precisely the state this migration
-- exists to make impossible. ⚠️ DO NOT "TIDY" THESE INTO THE OTHER ORDER.
--
-- WHY THE SCHEMA DOES NOT ENFORCE IT — both candidates were considered and
-- both are worse:
--
--   A TRIGGER on `accounts` could demand a consumed verification before
--   letting `alert_phone` change. It would fire for service_role too, which
--   is the right audience (the client already cannot write the column at
--   all). It is still wrong TODAY for a reason that has nothing to do with
--   taste: the moment it is applied, the agency's CURRENT write path — which
--   has no verification and is in production right now — stops working. A
--   migration that breaks the running app on apply is not a migration this
--   repo can take, and append-only means there is no undo. The order has to
--   be: this storage, then the verify path, then (optionally) a trigger, and
--   that last step needs a backfilled consumed row for every alert_phone
--   already live or it locks those accounts out of their own number.
--
--   A FOREIGN KEY from `accounts (id, alert_phone)` to this table is not
--   expressible at all. It would need a unique index over consumed rows
--   only, and Postgres will not back a foreign key with a PARTIAL unique
--   index; a total unique index on (account_id, phone) would instead forbid
--   ever re-verifying a number, which is Decision 4's whole point.
--
-- So the enforcement today is the write order plus the fact that there is no
-- second place for a pending number to live. Named honestly: a code path that
-- skips this table entirely is still possible, and what catches it is review,
-- not the schema.


-- ─────────────────────────────────────────────────────────────────────────
-- DECISION 4 — PER NUMBER, NOT PER ACCOUNT: NO UNIQUE CONSTRAINT ANYWHERE.
--
-- An attempt is a fact that happened, and several can be true at once. The
-- agency types a wrong number, sends a code, notices, and types the right
-- one: both rows are live and the second must not be refused because of the
-- first. A "resend, it never arrived" is a third. Any uniqueness on
-- `account_id` turns each of those into an error at the exact moment somebody
-- is fixing a mistake.
--
-- WHY NOT EVEN a partial unique index on the LIVE rows — "at most one
-- unexpired, unconsumed verification per (account_id, phone)"? Because it
-- cannot be written. An index predicate must be IMMUTABLE and `now()` is
-- STABLE (provolatile 's', the same measurement Decision 2c rests on), so the
-- predicate could only say `consumed_at is null` — which also matches EXPIRED
-- rows, and would therefore refuse a legitimate retry an hour later. A
-- constraint that blocks the correct behaviour to prevent a harmless one is a
-- bad trade.
--
-- THE COST, named: nothing here caps how many codes an account can request,
-- and every request is a text to a real handset. That is a rate limit — "no
-- more than N in an hour" — and no UNIQUE index can express one. It belongs
-- in the send path, which already has the account in hand and already has to
-- decide whether to spend a segment. This index is what makes that cheap:
-- "the live verifications for this account and this number, newest first".
create index alert_phone_verifications_account_phone
  on public.alert_phone_verifications (account_id, phone, created_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- DECISION 5 — GRANTS AND RLS: service_role only. THE FIRST TABLE IN THIS
-- SCHEMA THAT GRANTS `authenticated` NOTHING AT ALL.
--
-- Every other tenant table gives `authenticated` at least SELECT under a
-- member policy (0029's three, 0025's automations, voice's tables). Read live
-- before writing this, across all 31 tables, so "first" is measured and not
-- remembered. This one is different for a reason that is not general
-- caution:
--
--   `code_hash` IS THE SECRET, and it is reversible. A SELECT grant hands
--   every `authenticated` token in the org a value that becomes the code in
--   milliseconds (Decision 2a is blunt about this). Whoever can read this
--   table can confirm a number they do not hold — which is the entire thing
--   the table exists to prevent. There is no version of "read-only is safe"
--   here: for this column, READ IS WRITE.
--
-- And there is nobody who needs it. The verifier is the agency, through
-- serviceDb() behind `requireAgencyOnlyAccountAccess`, exactly as 0035
-- Decision 1 fixed for the column itself. The client cannot write
-- `alert_phone` and has no part in proving it.
--
-- So: RLS ON with NO POLICY, which in this schema is unusual enough to be
-- worth stating plainly rather than leaving to be discovered. It is not an
-- oversight and not an unfinished migration — a policy would be dead code,
-- because service_role bypasses RLS and no other role can reach the table at
-- all. Two independent layers say no, and the grants test pins both: the
-- privilege rows are exactly empty AND the policy count is exactly zero.
--
-- THE REVOKE IS NOT BELT-AND-BRACES. Measured on this project before writing
-- it: `pg_default_acl` still grants ALL on a new public table to `anon`,
-- `authenticated` and `service_role` — whatever config.toml's comment says
-- about the current cloud default, THIS database's default ACLs are the
-- legacy ones (it is why 0020 and 0029 carry revokes at all). Without the
-- line below, `anon` — an unauthenticated caller with the publishable key —
-- could read and write this table the moment it is created.
--
-- IF A CLIENT EVER NEEDS TO SEE PENDING STATE, here is the recipe, so nobody
-- has to guess: a COLUMN-scoped grant that excludes `code_hash`
-- (`grant select (id, account_id, phone, expires_at, consumed_at) …`) plus
-- the house member policy read off the live `notes_member_all` row. Never a
-- table-level SELECT, because a table-level grant covers columns added later
-- and the next secret column would be exposed by a migration that never
-- mentioned grants at all.
alter table public.alert_phone_verifications enable row level security;
revoke all on public.alert_phone_verifications from anon, authenticated;
grant select, insert, update, delete on public.alert_phone_verifications to service_role;


-- ─────────────────────────────────────────────────────────────────────────
-- DECISION 6 — EXPIRY AND CLEANUP: stale rows are INERT, and no sweeper ships
-- with this.
--
-- What makes them inert is not diligence in the read path, it is that a spent
-- row cannot do anything. Consumed is a one-way stamp; an expired row cannot
-- be stamped at all (the consumed check above); attempts cannot pass five.
-- The worst a forgotten row does is occupy about a hundred bytes.
--
-- Volume: a row is written when an operator changes an alert number. That is
-- single digits per account per YEAR — this is not `events` or `messages`,
-- and a cron pass to delete a few hundred rows a year would cost more
-- attention than the rows do. `pg_cron` is not installed on this project
-- (measured), so a sweeper would mean a new pass in apps/web/api/cron, a new
-- registration, and a new thing that can fail silently at 4 AM.
--
-- WHAT WOULD CHANGE THE ANSWER, so the next person has a threshold rather
-- than a vibe: if a self-serve flow ever lets clients change their own alert
-- number, the write rate stops being "an operator, occasionally" and a
-- retention pass belongs on the existing cron tick — `delete where
-- expires_at < now() - interval '30 days'`, one statement, no new
-- infrastructure. Until then this is a cost with no benefit.
--
-- Test rows: nothing extra is needed. The account's own deletion carries them
-- (the cascade above), so `withTestAccount` and `sweepAbandonedFixtures`
-- already clean up after themselves through `deleteAccountCascade`.

comment on table public.alert_phone_verifications is
  'One attempt to prove somebody holds a phone number, before it is stored as accounts.alert_phone. Service-role only: code_hash is a reversible digest of a six-digit code, so READ IS WRITE here and authenticated is granted nothing. Rows are scratch — they cascade away with the account.';

comment on column public.alert_phone_verifications.phone is
  'The number being CLAIMED, not yet the number alerts go to. Same E.164 rule as phone_numbers.e164 and accounts.alert_phone, verbatim.';

comment on column public.alert_phone_verifications.code_hash is
  'Lowercase hex SHA-256 of the six-digit code, computed in Node (src/alert-phone-verification.ts); SQL never computes it. Not secrecy — 10^6 preimages — it exists so nobody reads the code out of a dashboard row and types it in on the requester''s behalf.';

comment on column public.alert_phone_verifications.consumed_at is
  'NULL until the code came back. Set exactly once, and BEFORE accounts.alert_phone is written, so a crash between the two leaves a burnt code rather than an unproven number.';
