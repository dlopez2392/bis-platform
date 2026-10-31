-- 0110_contact_match.sql - contact search reads an account-first trigram index through a matcher that applies the
-- account and Technician rules itself (F-092 scale follow-up, parts B and C; docs/superpowers/specs/
-- 2026-10-31-search-scale-design.md sections 3, 4.2, 4.3, 4.5, 4.7, 4.8)
--
-- WHY. Under RLS no ILIKE arm of the contact search can become an index condition: ILIKE is not LEAKPROOF, so the
-- planner must run the policies' quals first and filter every row of the account (spec section 1, cause 1). 0109
-- removed the per-row policy cost; a searched list plus its count at 50,000 contacts still took 430 to 715 ms as an
-- Owner (spec 3.3, column b). A matcher that runs the arms with no RLS above it, over a trigram index that leads with
-- the account, brings every searched list line but the two-letter "ma" under 150 ms (column d), and reading one- and
-- two-character terms byte-wise brings "ma" from 588-674 ms to 211-244 ms (column e). The owner ruled (spec section 5):
-- searches shorter than three typed characters compare byte-wise; this file and bis-crm's app change ship together,
-- after 0109.
--
-- WHAT.
--   btree_gin, in the extensions schema (read on both projects 2026-10-31: version 1.3 available, not installed,
--     trusted). It gives GIN an operator class for uuid (extensions.uuid_ops).
--   contacts_search_trgm, rebuilt: account_id extensions.uuid_ops first, then 0108's seven trigram columns in 0108's
--     order. One GIN scan now intersects the account's entries with the pattern's trigrams, so a common trigram no
--     longer fetches every account's matches first. Built under a new name, then 0108's index dropped and the new one
--     renamed (LOCKS below says why that order).
--   app.contact_match_ids(p_account_id, p_text, p_tokens, p_phone_keys, p_national) returns setof uuid. plpgsql,
--     STABLE, SECURITY DEFINER, search_path pg_catalog, pg_temp. In order:
--     1. Who may ask about which account. The session's own role (current_setting('role'), which a definer does not
--        change) being service_role: answered for the named account, as RLS lets service_role read every row. That
--        setting is exactly as forgeable as the role itself: changing it takes membership of service_role for the
--        SESSION user (on Supabase, authenticator), and SQL able to do that could set role service_role and read every
--        table already; PostgREST runs no caller SQL. A claim is never trusted for it (a JWT saying role service_role
--        on an authenticated session gets nothing; contact-match-schema.test.ts).
--        Anyone else: answered only when the house predicate of contacts_member_all holds for the NAMED account,
--        null-safe (coalesce(coalesce(app.is_agency(), false) or p_account_id = app.current_account_id(), false));
--        the outer coalesce matters, because a client token's is_agency() is NULL and a bare "if not (NULL)" takes
--        neither branch. The account is a parameter because the agency's token names no client account
--        (current_account_id() is NULL for it); identity is never a parameter: it is the session's role and its
--        claims, read through app.jwt().
--     2. The Technician scope, as contacts_technician_scope (0068) states it, for everyone but service_role: unless
--        app.sees_all_customers(app.current_account_id()), only a CURRENT Technician (app.is_technician) is
--        answered, and only rows with assigned_to = app.current_user_id(); a client with no membership gets nothing.
--     3. Inputs refused, never repaired (22023): exactly the shapes the app sends (contactSearchFilter's
--        sanitizeSearchTerm and contactSearchPlan, packages/db/src/search-term.ts and contact-search.ts). p_text:
--        not NULL, not empty, at most 160 characters (80 typed, each _ sent as backslash-underscore), no %, no
--        backslash except before _, and no _ without one. p_tokens: not NULL, at most 6, each 1 to 80 of [a-z0-9].
--        p_phone_keys: not NULL, at most 2, each 1 to 20 digits. p_national: NULL or exactly 10 digits. No pattern
--        in this file is written with a backslash (chr(92) instead).
--     4. The match: contactSearchFilter's arms in its order (packages/db/src/contacts.ts), every one an ILIKE on a
--        bound pattern: the four raw arms on p_text (first_name, last_name, email, phone), the words ANDed on
--        search_name, each phone key on phone_key, the national ten on phone_national; ORed; within the account,
--        and within the Technician's own rows when step 2 named them. When the TYPED term (p_text with each
--        backslash-underscore counted as one character) is shorter than 3 characters, every arm compares under
--        collate "C" (owner ruling Q2): no trigram index can serve such a term, and a C comparison costs about a
--        third of an ICU one. What that changes, for those terms only: the raw arms fold case for ASCII letters
--        alone, so "iv" typed in Cyrillic finds only the same case, and so does a Latin letter outside the name
--        fold's table (Vietnamese, Polish, Turkish and similar letters typed in the other case; 0 such names on
--        production or bis-ci on 2026-10-31); Spanish names are still found through search_name, which is ASCII by
--        construction (spec 3.8). The contacts list and export send one-character terms too; they read byte-wise.
--        Run as one dynamic statement on purpose: EXECUTE plans it with the real patterns, so for a term of 3 or more
--        characters each arm becomes a bitmap scan of contacts_search_trgm, and an absent arm is absent (no "is null
--        or" the planner cannot index). Its text is assembled ONLY from fixed
--        fragments in this file and integer array positions; every value travels as a USING parameter ($1 the
--        account, $2 the Technician, $3 the array of patterns). No format(), no caller text in the SQL.
--     5. Ids only, of every matching row of the account the caller may see, archived, merged-away and holding
--        records included: the app's own filters decide those, outside, exactly as today.
--   public.contacts_matching(the same five, the same defaults) returns setof public.contacts. sql, STABLE, INVOKER,
--     no SET clause, one select: the only thing PostgREST can call (app is not an exposed schema). INVOKER, so RLS
--     on contacts applies to every row it returns, and the matcher's gates are a SECOND gate, not the only one.
--     With no SET clause and no definer flag PostgreSQL inlines it into the caller's statement (a GET call passes
--     plain parameters), so the app's eq, or, order and limit reach contacts and its indexes directly. The defaults
--     exist because a GET call omits an absent argument (postgrest-js writes a null as the string "null").
--
-- GRANTS. EXECUTE on both functions for authenticated and service_role; revoked from PUBLIC and from anon by name (the
-- default ACL grants anon by name). The matcher is the 38th SECURITY DEFINER in public and app
-- (definer-search-path.test.ts: EXPECTED_DEFINERS 37 -> 38). No table or column grant changes: the client-write
-- digest in proposals-drop.test.ts stays 49|e0df0cc230da2dce6fa93b26b43e6d46.
--
-- SEARCH PATHS. The matcher says set search_path = pg_catalog, pg_temp (the 0096 rule) and names every relation and
-- app function by schema; the index names its operator classes by schema. The entry point has NO set clause on
-- purpose (a set clause stops the inlining, which contact-match-schema.test.ts pins): it runs as its caller, raises no
-- one's privileges, and names its one relation and its one function by schema.
--
-- WHAT THE MATCHER READS AS. Its owner, postgres, owns contacts with FORCE ROW LEVEL SECURITY off (read on both
-- projects 2026-10-31), so its own read is not filtered by RLS: that is the point, and why steps 1 and 2 restate the
-- policies. app.my_contact_ids() (0068) has always read contacts on the same footing.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each lock.
--   The new index is built first, under SHARE on contacts: reads go on, every contact insert, update and delete waits
--   until the file commits. Then 0108's index is dropped, which takes ACCESS EXCLUSIVE on contacts from that
--   statement to the commit (milliseconds: a drop and a rename); every contact read waits for that tail only.
--   Building first and dropping last is why: dropping first would hold ACCESS EXCLUSIVE through the whole build.
--   MEASURED on a PostgreSQL 17.6 replica (laptop SSD, psql -1, three runs, a fresh copy of the database each run):
--   50,000 contacts in one account (on 0001-0109), the whole file 1.65 to 1.86 s, the build 1.40 to 1.54 s, the drop
--   1 to 3 ms, the index 9,986,048 bytes; 500,000 contacts (10 accounts of 50,000, spec 3.1's seed, on 0001-0109),
--   the whole file 15.9 to 16.1 s, the build 15.5 to 15.8 s, the drop 4 to 6 ms, the index 117,571,584 bytes (0108's
--   on the same copy: 121,929,728). Probed from a second session during a 500,000 build: the file held ShareLock on
--   contacts; a read of one account's 50,000 contacts returned in 31 ms; an update waited and was cancelled at its own
--   1 s lock_timeout.
--   Production held 53 contacts on 2026-10-31 (the index 360,448 bytes): no off-peak rule.
--   A deadlock is possible only with a live transaction that already read contacts and then writes it while the
--   build holds SHARE: PostgreSQL aborts whichever side waited when it detected the cycle, the file (run it again) or
--   that request (40P01, the app's to retry).
--   The searches themselves, on a PostgreSQL 17.6 replica of 500,000 contacts (10 accounts of 50,000; spec 3.1's
--   seed and queries, 20 timed runs after 3 warm-up, p95, as the app will call it after bis-crm's change): the list
--   newest first plus its count, the list by name plus its count, and the search box's three tiers (their sum, and in
--   brackets the slowest tier, which is what the route waits for), in ms. Budgets: 150 a list line, 100 the box, 300
--   for "ma".
--     Owner       garcia 45.2 / 46.5 / 77.4 (27.9); ana 78.7 / 84.8 / 116.9 (50.5); maria lopez 20.8 / 21.8 / 37.4
--                 (15.3); garcia lopez typed with accents 31.3 / 31.4 / 38.0 (14.4); 0199 9.2 / 11.2 / 13.9 (5.1);
--                 (956) 555-0199 22.8 / 22.4 / 21.8 (10.7); +52 1 899 123 41.5 / 42.6 / 40.8 (21.1); zzqx 4.9 / 5.1 /
--                 9.0 (3.9); ma 198.0 / 195.1 / 276.0 (104.3).
--     Technician  garcia 27.9 / 30.1 / 45.1 (17.6); ana 40.8 / 39.7 / 52.5 (19.6); +52 1 899 123 49.3 / 46.9 / 52.0
--                 (25.6); ma 16.5 / 16.0 / 30.5 (14.9).
--     agency      garcia 39.3 / 40.7 / 68.2 (25.6); ana 80.3 / 83.2 / 154.0 (91.8); ma 203.2 / 200.0 / 290.6 (105.6).
--   With 0109 alone every searched Owner list line took 430 to 715 ms (spec 3.3, column b). By the conservative sum
--   of the three tiers "ana" (6,118 matches) misses the box's 100 ms as an Owner and as the agency; by the slowest
--   tier every term is under it. All 162 answers (54 queries for each of the three callers: the page's ids, or the
--   count) were identical to the same queries through contactSearchFilter on the same data at 0109. Inside the
--   matcher, for "ana" each arm is a Bitmap Index Scan on contacts_search_trgm with Index Cond (account_id = ...)
--   AND (first_name ~~* '%ana%'); for "ma" the index narrows to the account's 50,000 rows and the C arms filter them.
--
-- LOAD-BEARING. bis-crm's change (spec 4.4, plan T6) calls public.contacts_matching for every searched contact list,
-- count and search box; it merges only after this file is on production, because under the old schema every search
-- would fail (PGRST202). contactSearchFilter stays in the app as the oracle contact-match-schema.test.ts holds the
-- matcher to; a change to the search's arms is a change to BOTH, in one pull request, with a new migration.
-- contacts_search_trgm's column set is the search's arm set: an arm added without its column here is an arm no index
-- serves.
--
-- ROLLBACK (roll the app back first):
--   drop function public.contacts_matching(uuid, text, text[], text[], text);
--   drop function app.contact_match_ids(uuid, text, text[], text[], text);
--   create index contacts_search_trgm_0108 on public.contacts using gin (search_name extensions.gin_trgm_ops,
--     first_name extensions.gin_trgm_ops, last_name extensions.gin_trgm_ops, email extensions.gin_trgm_ops,
--     phone extensions.gin_trgm_ops, phone_key extensions.gin_trgm_ops, phone_national extensions.gin_trgm_ops);
--   drop index public.contacts_search_trgm;
--   alter index public.contacts_search_trgm_0108 rename to contacts_search_trgm;
--   btree_gin stays: nothing else depends on it, and removing it is a separate decision.
--
-- ASCII only, no backslash anywhere. Every dollar sign in this file is part of a dollar-quote pair, except the
-- parameter markers $1, $2 and $3 inside the matcher's dynamic statement.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. A GIN operator class for uuid.
create extension if not exists btree_gin with schema extensions;

-- 2. The trigram index, account-first: built beside 0108's (SHARE), then 0108's dropped (ACCESS EXCLUSIVE, to commit).
create index contacts_search_trgm_0110 on public.contacts using gin (
  account_id extensions.uuid_ops,
  search_name extensions.gin_trgm_ops,
  first_name extensions.gin_trgm_ops,
  last_name extensions.gin_trgm_ops,
  email extensions.gin_trgm_ops,
  phone extensions.gin_trgm_ops,
  phone_key extensions.gin_trgm_ops,
  phone_national extensions.gin_trgm_ops
);
drop index public.contacts_search_trgm;
alter index public.contacts_search_trgm_0110 rename to contacts_search_trgm;

-- 3. The matcher.
create function app.contact_match_ids(
  p_account_id uuid, p_text text, p_tokens text[] default '{}', p_phone_keys text[] default '{}',
  p_national text default null)
returns setof uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_me uuid;
  v_rest text;
  v_c text := '';
  v_pats text[] := '{}';
  v_arms text[];
  v_words text[] := '{}';
  v_t text;
begin
  -- 1. Who may ask about which account. service_role is the session's own role; everyone else is held to the house
  --    predicate for the NAMED account, null-safe.
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    if not coalesce(coalesce(app.is_agency(), false) or p_account_id = app.current_account_id(), false) then
      return;
    end if;
    -- 2. The Technician scope (0068's contacts_technician_scope).
    if not coalesce(app.sees_all_customers(app.current_account_id()), false) then
      if not coalesce(app.is_technician(app.current_account_id()), false) then
        return;
      end if;
      v_me := app.current_user_id();
      if v_me is null then
        return;
      end if;
    end if;
  end if;

  -- 3. Inputs: only what the app sends. v_rest is p_text without its escaped underscores; a backslash or an
  --    underscore left in it was not sent by sanitizeSearchTerm.
  v_rest := pg_catalog.replace(p_text, pg_catalog.chr(92) || '_', '');
  if p_text is null or p_text = '' or pg_catalog.length(p_text) > 160
     or pg_catalog.strpos(p_text, '%') > 0
     or pg_catalog.strpos(v_rest, pg_catalog.chr(92)) > 0
     or pg_catalog.strpos(v_rest, '_') > 0
     or p_tokens is null or pg_catalog.cardinality(p_tokens) > 6
     or exists (select 1 from pg_catalog.unnest(p_tokens) as t(v)
                 where t.v is null or t.v = '' or pg_catalog.length(t.v) > 80 or t.v collate "C" ~ '[^a-z0-9]')
     or p_phone_keys is null or pg_catalog.cardinality(p_phone_keys) > 2
     or exists (select 1 from pg_catalog.unnest(p_phone_keys) as k(v)
                 where k.v is null or k.v = '' or pg_catalog.length(k.v) > 20 or k.v collate "C" ~ '[^0-9]')
     or (p_national is not null and (pg_catalog.length(p_national) <> 10 or p_national collate "C" ~ '[^0-9]')) then
    raise exception 'contact_match_ids: refused input' using errcode = '22023';
  end if;

  -- 4. Fewer than 3 typed characters: byte-wise (owner ruling Q2). A backslash-underscore is one typed character.
  if pg_catalog.length(pg_catalog.replace(p_text, pg_catalog.chr(92) || '_', '_')) < 3 then
    v_c := ' collate "C"';
  end if;

  -- 5. contactSearchFilter's arms, in its order. Patterns go into v_pats ($3); the SQL text holds only the fixed
  --    fragments below and each pattern's integer position.
  v_pats := pg_catalog.array_append(v_pats, '%' || p_text || '%');
  v_arms := array['c.first_name' || v_c || ' ilike $3[1]', 'c.last_name' || v_c || ' ilike $3[1]',
                  'c.email' || v_c || ' ilike $3[1]', 'c.phone' || v_c || ' ilike $3[1]'];
  foreach v_t in array p_tokens loop
    v_pats := pg_catalog.array_append(v_pats, '%' || v_t || '%');
    v_words := pg_catalog.array_append(v_words,
      'c.search_name' || v_c || ' ilike $3[' || pg_catalog.cardinality(v_pats)::text || ']');
  end loop;
  if pg_catalog.cardinality(v_words) > 0 then
    v_arms := pg_catalog.array_append(v_arms, '(' || pg_catalog.array_to_string(v_words, ' and ') || ')');
  end if;
  foreach v_t in array p_phone_keys loop
    v_pats := pg_catalog.array_append(v_pats, '%' || v_t || '%');
    v_arms := pg_catalog.array_append(v_arms,
      'c.phone_key' || v_c || ' ilike $3[' || pg_catalog.cardinality(v_pats)::text || ']');
  end loop;
  if p_national is not null then
    v_pats := pg_catalog.array_append(v_pats, '%' || p_national || '%');
    v_arms := pg_catalog.array_append(v_arms,
      'c.phone_national' || v_c || ' ilike $3[' || pg_catalog.cardinality(v_pats)::text || ']');
  end if;

  return query execute
    'select c.id from public.contacts c where c.account_id = $1'
      || case when v_me is null then '' else ' and c.assigned_to = $2' end
      || ' and (' || pg_catalog.array_to_string(v_arms, ' or ') || ')'
    using p_account_id, v_me, v_pats;
end $$;

revoke all on function app.contact_match_ids(uuid, text, text[], text[], text) from public, anon;
grant execute on function app.contact_match_ids(uuid, text, text[], text[], text) to authenticated, service_role;

comment on function app.contact_match_ids(uuid, text, text[], text[], text) is
  'F-092 scale (0110): ids of the named account''s contacts that match a search, for a caller RLS lets read them.';

-- 4. The entry point. INVOKER, no SET clause, one select: inlined into the caller's statement, under the caller's RLS.
create function public.contacts_matching(
  p_account_id uuid, p_text text, p_tokens text[] default '{}', p_phone_keys text[] default '{}',
  p_national text default null)
returns setof public.contacts
language sql stable as $$
  select c.* from public.contacts c
   where c.id in (select app.contact_match_ids(p_account_id, p_text, p_tokens, p_phone_keys, p_national))
$$;

revoke all on function public.contacts_matching(uuid, text, text[], text[], text) from public, anon;
grant execute on function public.contacts_matching(uuid, text, text[], text[], text) to authenticated, service_role;

comment on function public.contacts_matching(uuid, text, text[], text[], text) is
  'F-092 scale (0110): the contacts a search matches, under the caller''s RLS. Call it as GET so it is inlined.';
