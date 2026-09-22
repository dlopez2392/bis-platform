import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { withRollback } from "./db";
import { getOrCreateCalendar } from "../booking";
import { createContact } from "../contacts";

const token = () => `tok_${Math.random().toString(36).slice(2, 12)}`;

/** The bookings FKs a test row needs — the sibling suites' own helpers, not a
 *  local re-implementation (automations.test.ts:373-374, due-by-id.test.ts:14-16).
 *  `getOrCreateCalendar` is idempotent per account (`calendars_one_per_account`).
 *  The bookings themselves are inserted directly rather than through
 *  `createBooking`: these rows carry `confirm_reply` and a non-default
 *  `status`, and `createBooking` accepts neither. */
async function parents(db: Parameters<typeof createContact>[0], accountId: string) {
  const cal = await getOrCreateCalendar(db, accountId, "user_test");
  const { id: contactId } = await createContact(
    db, accountId, { firstName: "Bo", phone: "(956) 555-0123" }, "user_test");
  return { calendarId: cal.id, contactId };
}

describe("0047 - the recipe catalogue is eight keys", () => {
  it("accepts each of the four new recipe keys", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const key of ["appointment_confirm", "referral_ask", "reactivation", "quote_followup"] as const) {
        const { error } = await db.from("automations")
          .insert({ account_id: accountId, recipe_key: key, enabled: false, body: "", config: {} });
        expect(error, `inserting recipe_key=${key}`).toBeNull();
      }
    });
  });

  it("keeps all FOUR original recipe keys writable", async () => {
    // The drop-and-re-add is the stated reason this is ONE migration rather
    // than four (the migration's own header): re-typing a surviving value is
    // how a key silently stops being writable. The log's nine are checked the
    // same way below; the catalogue's four were not, until this case.
    await withTestAccount(async (db, accountId) => {
      for (const key of ["review_request", "no_show_nudge", "sms_reminder", "instant_reply"] as const) {
        const { error } = await db.from("automations")
          .insert({ account_id: accountId, recipe_key: key, enabled: false, body: "", config: {} });
        expect(error, `inserting recipe_key=${key}`).toBeNull();
      }
    });
  });

  it("still refuses a key that is not in the catalogue, by SQLSTATE 23514", async () => {
    await withTestAccount(async (db, accountId) => {
      const { error } = await db.from("automations")
        .insert({ account_id: accountId, recipe_key: "birthday_greeting", enabled: false, body: "", config: {} });
      // 23514 = check_violation. The CODE, never "an error": a typo'd column
      // name also produces an error and would satisfy a truthiness check
      // while proving nothing about the constraint.
      expect(error?.code).toBe("23514");
    });
  });
});

describe("0047 - the log accepts thirteen sources and no more", () => {
  it("accepts each of the four new sources", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const source of ["appointment_confirm", "referral_ask", "reactivation", "quote_followup"] as const) {
        const { error } = await db.from("automation_log").insert({
          account_id: accountId, source, channel: "sms", subject_key: `t:${source}`,
          status: "sent", reason: "",
        });
        expect(error, `inserting source=${source}`).toBeNull();
      }
    });
  });

  it("keeps all NINE original sources writable", async () => {
    await withTestAccount(async (db, accountId) => {
      const nine = ["reminders", "followups", "review_request", "no_show_nudge", "sms_reminder",
                    "instant_reply", "weekly_report", "concierge", "voice"] as const;
      for (const source of nine) {
        const isAi = source === "concierge" || source === "voice";
        const { error } = await db.from("automation_log").insert({
          account_id: accountId, source, channel: isAi ? "ai" : "email",
          subject_key: `t9:${source}`, status: "sent", reason: "",
        });
        expect(error, `inserting source=${source}`).toBeNull();
      }
    });
  });

  it("refuses an unknown source by SQLSTATE 23514", async () => {
    await withTestAccount(async (db, accountId) => {
      const { error } = await db.from("automation_log").insert({
        account_id: accountId, source: "weekly_agency_report", channel: "email",
        subject_key: "t:none", status: "sent", reason: "",
      });
      expect(error?.code).toBe("23514");
    });
  });
});

describe("0047 - the nine columns exist and carry their constraints", () => {
  it("bookings.confirm_reply accepts yes and no and refuses anything else", async () => {
    await withTestAccount(async (db, accountId) => {
      const { calendarId, contactId } = await parents(db, accountId);
      const mk = (reply: string | null) => db.from("bookings").insert({
        account_id: accountId, calendar_id: calendarId, contact_id: contactId,
        starts_at: "2027-01-05T15:00:00Z", ends_at: "2027-01-05T16:00:00Z",
        status: "cancelled", cancel_token: token(), confirm_reply: reply,
      }).select("id").maybeSingle();

      expect((await mk("yes")).error).toBeNull();
      expect((await mk("no")).error).toBeNull();
      expect((await mk(null)).error).toBeNull();
      // "YES" is the customer's word, not the column's: the webhook lowercases
      // before it writes, and this constraint is what proves it must.
      expect((await mk("YES")).error?.code).toBe("23514");
      expect((await mk("maybe")).error?.code).toBe("23514");
    });
  });

  it("every new column is selectable and defaults to null", async () => {
    await withTestAccount(async (db, accountId) => {
      const { calendarId, contactId } = await parents(db, accountId);
      const { data: bk, error: bkErr } = await db.from("bookings").insert({
        account_id: accountId, calendar_id: calendarId, contact_id: contactId,
        starts_at: "2027-01-06T15:00:00Z", ends_at: "2027-01-06T16:00:00Z",
        status: "booked", cancel_token: token(),
      }).select("confirm_asked_at, confirm_reply, confirm_reply_at, confirm_sms_failed_at, referral_asked_at, referral_ask_sms_failed_at").single();
      expect(bkErr).toBeNull();
      expect(bk).toEqual({
        confirm_asked_at: null, confirm_reply: null, confirm_reply_at: null,
        confirm_sms_failed_at: null, referral_asked_at: null, referral_ask_sms_failed_at: null,
      });

      const { data: ct } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Ada", email: "ada@example.com" })
        .select("id, reactivation_sent_at").single();
      expect(ct!.reactivation_sent_at).toBeNull();

      const { data: pipe } = await db.from("pipelines")
        .insert({ account_id: accountId, name: "Sales", position: 0 }).select("id").single();
      const { data: stage } = await db.from("pipeline_stages")
        .insert({ account_id: accountId, pipeline_id: pipe!.id, name: "Quoted", position: 0 })
        .select("id").single();
      const { data: opp, error: oppErr } = await db.from("opportunities").insert({
        account_id: accountId, contact_id: ct!.id, pipeline_id: pipe!.id, stage_id: stage!.id,
        name: "Reroof",
      }).select("quote_followup_sent_at, quote_followup_sms_failed_at").single();
      expect(oppErr).toBeNull();
      expect(opp).toEqual({ quote_followup_sent_at: null, quote_followup_sms_failed_at: null });
    });
  });
});

/**
 * THE CATALOGUE CLAIMS — the two CHECK definitions in full, the nine columns,
 * the EIGHT index names with their partial predicates, and the
 * no-grant-change claim. `withRollback` + raw SQL, because supabase-js goes
 * through PostgREST and PostgREST reaches neither `pg_indexes` nor
 * `information_schema.role_table_grants`: a file that advertises an index
 * claim over PostgREST cannot make it.
 *
 * Every statement below is a READ, so the one-refused-statement-per-
 * transaction rule (`automations-grants.test.ts:56-58` — a refusal aborts the
 * transaction and everything after it reports 25P02 instead of its own
 * reason) has nothing to bite here. It still governs the CHECK cases above,
 * which is why those stay on `withTestAccount`: each PostgREST refusal is its
 * own transaction.
 */
describe("0047 - the catalogue, read directly", () => {
  it("both CHECKs list every value, eight keys and thirteen sources, in one read", async () => {
    // The insert cases above prove one value at a time and cannot see a value
    // that was DROPPED and never re-added unless someone thought to test it.
    // This sees the whole list at once. `pg_get_constraintdef` renders an
    // `in (...)` as `= ANY (ARRAY[...])`; that is Postgres's spelling, not a
    // rewrite of the migration.
    await withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conname in ('automations_recipe_key_check', 'automation_log_source_check')
          order by conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual(
        ["automation_log_source_check", "automations_recipe_key_check"]);
      expect(rows[0]!.def).toBe(
        "CHECK ((source = ANY (ARRAY['reminders'::text, 'followups'::text, 'review_request'::text, "
        + "'no_show_nudge'::text, 'sms_reminder'::text, 'instant_reply'::text, 'weekly_report'::text, "
        + "'concierge'::text, 'voice'::text, 'appointment_confirm'::text, 'referral_ask'::text, "
        + "'reactivation'::text, 'quote_followup'::text])))");
      expect(rows[1]!.def).toBe(
        "CHECK ((recipe_key = ANY (ARRAY['review_request'::text, 'no_show_nudge'::text, "
        + "'sms_reminder'::text, 'instant_reply'::text, 'appointment_confirm'::text, "
        + "'referral_ask'::text, 'reactivation'::text, 'quote_followup'::text])))");
    });
  });

  it("adds exactly the nine columns, each nullable, each timestamptz but confirm_reply", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ t: string; col: string; ty: string; nullable: string }>(
        `select table_name as t, column_name as col, data_type as ty, is_nullable as nullable
           from information_schema.columns
          where table_schema = 'public'
            and (table_name, column_name) in (
              ('bookings','confirm_asked_at'), ('bookings','confirm_reply'),
              ('bookings','confirm_reply_at'), ('bookings','confirm_sms_failed_at'),
              ('bookings','referral_asked_at'), ('bookings','referral_ask_sms_failed_at'),
              ('opportunities','quote_followup_sent_at'), ('opportunities','quote_followup_sms_failed_at'),
              ('contacts','reactivation_sent_at'))`,
      );
      // Sorted in JS, never by SQL: the database's collation decides whether
      // `referral_ask_sms_failed_at` sorts before `referral_asked_at`, and a
      // test that depends on that answer is a test that moves on its own.
      expect(rows.map((r) => `${r.t}.${r.col} ${r.ty} nullable=${r.nullable}`).sort()).toEqual([
        "bookings.confirm_asked_at timestamp with time zone nullable=YES",
        "bookings.confirm_reply text nullable=YES",
        "bookings.confirm_reply_at timestamp with time zone nullable=YES",
        "bookings.confirm_sms_failed_at timestamp with time zone nullable=YES",
        "bookings.referral_ask_sms_failed_at timestamp with time zone nullable=YES",
        "bookings.referral_asked_at timestamp with time zone nullable=YES",
        "contacts.reactivation_sent_at timestamp with time zone nullable=YES",
        "opportunities.quote_followup_sent_at timestamp with time zone nullable=YES",
        "opportunities.quote_followup_sms_failed_at timestamp with time zone nullable=YES",
      ]);
    });
  });

  it("ships NINE indexes, under those exact names, every one of them PARTIAL", async () => {
    // AN INDEX NAME IS PERMANENT. Tasks 5, 7 and 9 cite six of these nine by
    // name in their due-lists' own comments, so a typo here is a comment that
    // points at nothing for as long as the schema lives. The predicates are
    // pinned too: a partial index is chosen only when its predicate is
    // IMPLIED by the query's, so a wrong predicate is a silent sequential
    // scan rather than an error.
    const EXPECTED: Record<string, readonly string[]> = {
      bookings_referral_ask_count: [
        "ON public.bookings USING btree (account_id, referral_asked_at)",
        "WHERE (referral_asked_at IS NOT NULL)"],
      contacts_reactivation_count: [
        "ON public.contacts USING btree (account_id, reactivation_sent_at)",
        "WHERE (reactivation_sent_at IS NOT NULL)"],
      opps_quote_followup_count: [
        "ON public.opportunities USING btree (account_id, quote_followup_sent_at)",
        "WHERE (quote_followup_sent_at IS NOT NULL)"],
      opps_quote_followup_due: [
        "ON public.opportunities USING btree (account_id, stage_id, stage_changed_at)",
        "quote_followup_sent_at IS NULL", "status = 'open'::text"],
      bookings_confirm_due: [
        "ON public.bookings USING btree (account_id, starts_at)",
        "confirm_asked_at IS NULL", "status = 'booked'::text"],
      bookings_referral_due: [
        "ON public.bookings USING btree (ends_at)",
        "status = 'completed'::text", "referral_asked_at IS NULL"],
      bookings_referral_due_completed: [
        "ON public.bookings USING btree (completed_at)",
        "status = 'completed'::text", "referral_asked_at IS NULL"],
      bookings_completed_by_contact: [
        "ON public.bookings USING btree (contact_id)",
        "WHERE (status = 'completed'::text)"],
      // The ninth, added by the pre-apply review: applyConfirmationReply's
      // lookup runs on every inbound text from a known contact, and NEITHER
      // of the two candidates above can serve it — bookings_confirm_due's
      // `confirm_asked_at IS NULL` is this query's exact contradiction, and
      // bookings_completed_by_contact's `status = 'completed'` is not implied
      // by a query carrying no status filter.
      bookings_confirm_reply_pending: [
        "ON public.bookings USING btree (account_id, contact_id, starts_at)",
        "confirm_asked_at IS NOT NULL", "confirm_reply IS NULL"],
    };

    await withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public'
            and (indexname = any($1::text[]) or indexname = 'bookings_confirm_asked')`,
        [Object.keys(EXPECTED)],
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));

      expect([...byName.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
      for (const [name, fragments] of Object.entries(EXPECTED)) {
        for (const fragment of fragments) expect(byName.get(name), name).toContain(fragment);
        expect(byName.get(name), `${name} must be PARTIAL`).toContain(" WHERE ");
      }
      // The one the first draft named and the review dropped. It would index
      // confirm_asked_at for a cap count that does not exist, because
      // appointment_confirm is uncapped and this plan declares no
      // countAppointmentConfirmsSince (B10). The set equality above already
      // fails if it is present; this says WHY out loud.
      expect(byName.has("bookings_confirm_asked")).toBe(false);
    });
  });

  it("changes no grant: bookings keeps NO client UPDATE, and the two control columns keep exactly four", async () => {
    await withRollback(async (c) => {
      // THE SHARPEST PIN AVAILABLE. `0016_booking.sql:88` revokes UPDATE on
      // bookings from authenticated and never re-grants it, so the client's
      // UPDATE set for this table is EMPTY — and six new columns must leave
      // it empty. (`automations-grants.test.ts` makes the same assertion for
      // 0025's and 0026's columns; this is 0047's six.)
      const { rows: bookingUpdates } = await c.query(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'bookings' and privilege_type = 'UPDATE'`);
      expect(bookingUpdates).toEqual([]);

      // contacts and opportunities are the OTHER shape, and 0030's own
      // appended correction is the in-repo proof of it
      // (`0030_contacts_sort_name.sql:37-49`): these tables carry TABLE-level
      // grants, and `information_schema.column_privileges` EXPANDS a
      // table-level grant into one row per column — so a newly added column
      // appears automatically with the same four privileges every other
      // column already has. Both sides are written as LITERALS rather than
      // one compared to the other: two empty sets are also equal.
      const privs = async (table: string, col: string) => (await c.query<{ p: string }>(
        `select privilege_type as p from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = $1 and column_name = $2 order by privilege_type`,
        [table, col])).rows.map((r) => r.p);
      const FOUR = ["INSERT", "REFERENCES", "SELECT", "UPDATE"];
      expect(await privs("contacts", "first_name"), "contacts.first_name (the control)").toEqual(FOUR);
      expect(await privs("opportunities", "name"), "opportunities.name (the control)").toEqual(FOUR);

      // THE POSITIVE CONTROL FOR THE EMPTY SET ABOVE (pre-apply review).
      // `expect(bookingUpdates).toEqual([])` carries two literals nothing else
      // in this case exercises — `table_name = 'bookings'` and
      // `privilege_type = 'UPDATE'`. Misspell either and the query returns []
      // for the wrong reason and the assertion is green FOR EVER. The two
      // controls above do not close it: they use a different filter shape and
      // a different table. This does — bookings.id really does carry three
      // privileges, so the table name resolves, and UPDATE really is the one
      // that is absent rather than the query matching nothing at all.
      expect(await privs("bookings", "id"), "bookings.id (the control for the empty set)")
        .toEqual(["INSERT", "REFERENCES", "SELECT"]);
    });
  });

  // SPLIT OUT OF THE CASE ABOVE ON PURPOSE (2026-09-21, from Task 1's report).
  // The two live on opposite sides of the apply and must not share an `it`:
  //
  //   the case above is GREEN BEFORE AND AFTER. That is its whole evidentiary
  //   value — the grant surface is proven not to have MOVED, and a value that
  //   does not move is only proof if the assertion could not have been red for
  //   an unrelated reason. Bundling a red-before assertion into it destroyed
  //   exactly that property: pre-apply the case failed at the first new
  //   column, so nothing it claimed about the unmoved grants was demonstrated.
  //
  //   this case is RED BEFORE, GREEN AFTER, like every other case in the file:
  //   `information_schema.column_privileges` returns no rows for a column that
  //   does not exist yet, so [] !== FOUR until 0047 lands.
  //
  // Pre-apply this file is therefore 8 red / 5 green over 13 cases (the split
  // ADDED a red; it did not turn a green into one), and the plan’s Step 2
  // postscript says so.
  it("the three new client-writable columns inherit their table's four privileges", async () => {
    await withRollback(async (c) => {
      const privs = async (table: string, col: string) => (await c.query<{ p: string }>(
        `select privilege_type as p from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = $1 and column_name = $2 order by privilege_type`,
        [table, col])).rows.map((r) => r.p);
      const FOUR = ["INSERT", "REFERENCES", "SELECT", "UPDATE"];
      expect(await privs("contacts", "reactivation_sent_at"), "contacts.reactivation_sent_at").toEqual(FOUR);
      expect(await privs("opportunities", "quote_followup_sent_at"), "opportunities.quote_followup_sent_at").toEqual(FOUR);
      expect(await privs("opportunities", "quote_followup_sms_failed_at"), "opportunities.quote_followup_sms_failed_at").toEqual(FOUR);
    });
  });
});
