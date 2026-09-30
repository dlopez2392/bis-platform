import { describe, it, expect } from "vitest";
import { withRollback, actAs, actAsOwner } from "./db";
import { withTestAccount, testPhoneNumber } from "./fixtures";

/**
 * 0037_call_handoff.sql — the schema half of "this caller reached a person".
 *
 * Four objects, and this file is the proof for each: `accounts.transfer_phone`
 * (where a handed-off call is sent), a sixth legal value in
 * `calls_outcome_check`, `calls.handoff_token` / `calls.handoff_requested_at`
 * (how a later route finds the call again), and the partial unique index that
 * makes a token identify ONE call.
 *
 * It follows `alert-phone-grants.test.ts` deliberately, because 0035 and 0037
 * add the same SHAPE of column to the same table for the same kind of reason:
 * a business-side number this platform will dial or text. What 0035 decided
 * about grants, validation and the empty string is re-decided here only where
 * the new column differs, and pinned identically where it does not.
 */

/**
 * The EXACT set of `accounts` columns `authenticated` may UPDATE.
 *
 * Unchanged by 0037, and that is the assertion. 0013 revoked UPDATE on
 * `public.accounts` wholesale and re-granted it one column at a time, so
 * adding a column to this table is precisely the moment somebody reaches for
 * a grant out of habit. `transfer_phone` must not get one for a reason
 * strictly stronger than `alert_phone`'s: this number is DIALLED, and a
 * client who could write it could point their own callers at any handset in
 * the world, on the platform's own trunk.
 *
 * Read from the live database before 0037 was written, so the list is
 * measured rather than copied forward.
 */
const ACCOUNTS_UPDATE_COLUMNS = [
  "brand_color",
  "brand_corners",
  "brand_logo_path",
  "brand_mode",
  "brand_name",
  "brand_neutral",
  "brand_type",
  "mailing_address",
  "reply_to_email",
].sort();

/**
 * Shapes `transfer_phone` must REFUSE — the same list `alert_phone` refuses,
 * because it is the same regex, deliberately: `phone_numbers_e164_check`'s,
 * verbatim, for the reason 0035 records (one phone-shape rule that drifts
 * from another is worse than one strict rule).
 *
 * The empty string is the load-bearing entry. A blank settings field posts
 * `""`, and `""` is what gives "no transfer number" a SECOND spelling — the
 * in-call check would read `if (account.transferPhone)` as off while a
 * `transfer_phone is not null` query reads it as on. The field IS the switch
 * and a switch needs one position for "off".
 */
const REFUSED = [
  "(956) 292-1696",     // the majority operator-entered shape in this database
  "956-292-1696",
  "9562921696",         // ten bare digits
  "19562921696",        // eleven, no plus
  "+1 956 292 1696",    // spaced, the way a number is read aloud
  " +19562921696",      // a paste that brought its leading space
  "+19562921696 ",      // ...and its trailing one
  "+1234567",           // seven digits: under E.164's floor
  "+1234567890123456",  // sixteen: over E.164's ceiling
  "not a phone",
  "",                   // the blank field — see above
];

/** E.164's ceiling and floor, both on country code 999, which is assigned to
 *  no country and no service. `testPhoneNumber()`'s own doc records why a
 *  dialable literal must never be written here: this suite shares ONE
 *  Supabase project with production, and this column in particular is a
 *  number the product will one day CONNECT A CALLER TO. */
const E164_CEILING = "+999123456789012"; // fifteen digits
const E164_FLOOR = "+99912345";          // eight digits

/**
 * Values the widened `calls_outcome_check` must still REFUSE.
 *
 * Every one is a near-miss of the value being ADDED, not a far-away string.
 * That is the whole point: a CHECK accidentally widened to admit anything —
 * dropped and re-added as `check (outcome is not null)`, say — would sail
 * through a test that only inserts `'transferred'`. Only a value that is
 * nearly legal can tell a six-value list from no list at all.
 *
 * Verified read-only against this database before the migration was written
 * (`select 'transfer' = any (array[...six values...])` and friends): false,
 * false, false.
 */
const NEAR_MISS_OUTCOMES = [
  "transfer",      // the verb, one word short of the outcome
  "Transferred",   // right word, wrong case — SQL's `=` is case-sensitive
  "transferred ",  // right word, trailing space (a CSV/form artefact)
  "transferrred",  // the typo a human makes typing it
];

describe("0037 accounts.transfer_phone", () => {
  it("exists as nullable text with no default, so every account starts with no transfer offered", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{
        column_name: string; data_type: string; is_nullable: string; column_default: string | null;
      }>(
        `select column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts'
            and column_name = 'transfer_phone'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data_type).toBe("text");
      // NULL with no default is the switch, and it starts off. Every account
      // in this database today offers no transfer, which is the state the
      // product has always been in — not a failure to be backfilled away.
      expect(rows[0]!.is_nullable).toBe("YES");
      expect(rows[0]!.column_default).toBeNull();
    });
  });

  it("carries phone_numbers.e164's shape rule verbatim, worded for a nullable column", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = 'public.accounts'::regclass
            and conname = 'accounts_transfer_phone_check'`,
      );
      expect(rows).toHaveLength(1);
      // Pinned against the constraint TEXT, not only against behaviour: the
      // reason this column reuses one regex is that a second dialect of "a
      // number we can reach" means a number this column accepts and the dial
      // path cannot ring. Only reading the definition catches a later
      // migration that "improves" it.
      expect(rows[0]!.def).toContain("^\\+[0-9]{8,15}$");
      expect(rows[0]!.def).toContain("transfer_phone IS NULL");
    });
  });

  it("starts NULL on a new account — the field is the switch, and it starts off", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data, error } = await db.from("accounts")
        .select("transfer_phone").eq("id", accountId).single();
      expect(error, `accounts select failed: ${error?.message}`).toBeNull();
      expect(data!.transfer_phone).toBeNull();
    });
  });

  it("stores an E.164 number exactly, at both ends of the length range, and clears back to NULL", async () => {
    await withTestAccount(async (db, accountId) => {
      const drawn = testPhoneNumber();
      for (const value of [drawn, E164_FLOOR, E164_CEILING]) {
        const saved = await db.from("accounts")
          .update({ transfer_phone: value }).eq("id", accountId).select("transfer_phone").single();
        expect(saved.error, `transfer_phone rejected ${JSON.stringify(value)}: ${saved.error?.message}`).toBeNull();
        // Byte for byte: this column does not normalise, so whatever the dial
        // path is handed is whatever was written.
        expect(saved.data!.transfer_phone).toBe(value);
      }

      const cleared = await db.from("accounts")
        .update({ transfer_phone: null }).eq("id", accountId).select("transfer_phone").single();
      expect(cleared.error, `clearing transfer_phone failed: ${cleared.error?.message}`).toBeNull();
      expect(cleared.data!.transfer_phone).toBeNull();
    });
  });

  it("refuses every shape that could not be dialled, at save time rather than mid-call", async () => {
    await withTestAccount(async (db, accountId) => {
      // One account, all shapes, verdicts collected into ONE assertion rather
      // than an expect() per shape inside a loop: a loop of expects is
      // fail-fast, so the first bad shape would abort and every shape after it
      // would go unmeasured. Each PostgREST call is its own transaction, so a
      // refusal does not poison the next the way it would inside withRollback.
      const verdicts: Record<string, string | undefined> = {};
      for (const value of REFUSED) {
        const res = await db.from("accounts")
          .update({ transfer_phone: value }).eq("id", accountId).select("transfer_phone");
        verdicts[JSON.stringify(value)] = res.error?.code;
      }
      // 23514 is check_violation. An `undefined` here means the database
      // ACCEPTED a number this product would later try to ring.
      expect(verdicts).toEqual(
        Object.fromEntries(REFUSED.map((value) => [JSON.stringify(value), "23514"])),
      );
    });
  });

  it("grants authenticated no UPDATE on transfer_phone — the absent grant is the only control", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'accounts' and privilege_type = 'UPDATE'
          order by column_name`,
      );
      const granted = rows.map((r) => r.column_name);
      expect(granted).not.toContain("transfer_phone");
      // And the exact set, so a grant added here out of habit goes red too.
      expect(granted).toEqual(ACCOUNTS_UPDATE_COLUMNS);
    });
  });

  it("keeps transfer_phone readable by the client: SELECT on accounts is table-level", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'accounts' and privilege_type = 'SELECT'
            and column_name = 'transfer_phone'`,
      );
      // The same deliberate asymmetry 0035 chose and verified: a client
      // should SEE where their calls would be transferred even though they
      // cannot change it. Asserted rather than assumed, because "the read
      // still works" is the half nobody notices breaking until a settings
      // page renders blank.
      expect(rows).toHaveLength(1);
    });
  });

  it("refuses a CLIENT's write to their own transfer_phone, while the same client may still write branding", async () => {
    await withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [agency] } = await c.query<{ id: string }>(
        "insert into public.agencies (name) values ('T') returning id",
      );
      await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_transfer_phone', 'TransferPhone', true)`, [agency!.id],
      );

      await actAs(c, { org_id: "org_transfer_phone" });
      // Proves the POLICY lets this caller update this row at all, so the
      // refusal below is unambiguously the COLUMN grant and not RLS. Without
      // this line the test would still pass against a policy that denied
      // everything — a different bug wearing the same green.
      await c.query(
        "update public.accounts set brand_name = 'Renamed' where clerk_org_id = 'org_transfer_phone'",
      );

      // ONE refused statement per withRollback: after this the transaction is
      // aborted (25P02) and nothing else in this block could run.
      await expect(
        c.query(
          "update public.accounts set transfer_phone = $1 where clerk_org_id = 'org_transfer_phone'",
          [E164_CEILING],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("0037 calls.outcome admits a sixth value", () => {
  it("names the constraint it replaces and lists exactly the six legal outcomes", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = 'public.calls'::regclass
            and conname = 'calls_outcome_check'`,
      );
      // Re-added under the SAME name 0019 gave it, read from the live schema
      // rather than guessed. A CHECK cannot be altered in place, so 0037 drops
      // and re-adds; keeping the name means the next migration that needs a
      // seventh value finds it exactly where this one did.
      expect(rows, "calls_outcome_check is missing — a dropped constraint that was never re-added").toHaveLength(1);
      const LEGAL = ["booked", "lead", "message", "abandoned", "spam", "transferred"];
      const def = rows[0]!.def;
      for (const legal of LEGAL) {
        expect(def, `calls_outcome_check omits ${legal}`).toContain(`'${legal}'`);
      }
      // "exactly" in this test's name has to MEAN exactly. The loop above only
      // catches a value going missing from the CHECK; the opposite direction —
      // a seventh value appearing in the database that `CallOutcome` (../voice.ts)
      // has never heard of — is the one that produces a stored call row no
      // screen in this app can render, because the outcome pill switches on that
      // closed union. So the quoted literals are extracted and compared as a
      // SET, which guards the database→TypeScript direction too.
      const quoted = [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();
      expect(quoted, `calls_outcome_check quotes a different set than CallOutcome admits: ${def}`)
        .toEqual([...LEGAL].sort());
    });
  });

  it("accepts 'transferred' on a real call row", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();

      const call = await db.from("calls")
        .insert({
          account_id: accountId, phone_number_id: num.data!.id,
          caller_e164: "+19562921696", outcome: "transferred",
        })
        .select("outcome").single();
      expect(call.error, `calls insert rejected 'transferred': ${call.error?.message}`).toBeNull();
      expect(call.data!.outcome).toBe("transferred");
    });
  });

  it("still refuses a value that is NEARLY 'transferred' — proof the list is a list, not a hole", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();

      // Same collected-verdicts shape as the phone refusals above, for the
      // same reason: every near-miss is measured, not just the first.
      const verdicts: Record<string, string | undefined> = {};
      for (const outcome of NEAR_MISS_OUTCOMES) {
        const res = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.data!.id,
          caller_e164: "+19562921696", outcome,
        }).select("id");
        verdicts[outcome] = res.error?.code;
      }
      expect(verdicts).toEqual(
        Object.fromEntries(NEAR_MISS_OUTCOMES.map((o) => [o, "23514"])),
      );
    });
  });
});

describe("0037 calls.handoff_token / handoff_requested_at", () => {
  it("both exist as nullable, defaultless columns — every call ever recorded has neither", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{
        column_name: string; data_type: string; is_nullable: string; column_default: string | null;
      }>(
        `select column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'calls'
            and column_name in ('handoff_token', 'handoff_requested_at')
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(["handoff_requested_at", "handoff_token"]);
      expect(rows[0]).toMatchObject({
        data_type: "timestamp with time zone", is_nullable: "YES", column_default: null,
      });
      expect(rows[1]).toMatchObject({
        data_type: "text", is_nullable: "YES", column_default: null,
      });
    });
  });

  it("has a PARTIAL unique index on handoff_token, so the token names exactly one call", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'calls'
            and indexname = 'calls_handoff_token_unique'`,
      );
      expect(rows, "calls_handoff_token_unique is missing").toHaveLength(1);
      expect(rows[0]!.indexdef).toContain("UNIQUE");
      // PARTIAL is the load-bearing word. Every pre-existing row has a null
      // token and a plain unique index would be satisfied by those (nulls do
      // not conflict), so the predicate is not what makes the nulls legal —
      // it is what keeps the index small and says out loud that null means
      // "no handoff", not "a handoff with no token". Same shape as
      // `messages_provider_message_id_unique` (0005), read from the live
      // schema before this was written.
      expect(rows[0]!.indexdef).toContain("WHERE (handoff_token IS NOT NULL)");
    });
  });

  it("refuses a second call carrying a token another call already holds — the wrong-caller guard", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();

      // Drawn, never a literal: this index is PROJECT-WIDE (a token carries no
      // account, which is the point of it), so a fixed string here is green
      // only while this is the only run in the project — the exact accident
      // `testPhoneNumber()` exists to prevent for `phone_numbers.e164`.
      const token = `test_handoff_${Math.random().toString(36).slice(2, 12)}`;
      const insert = (t: string | null) => db.from("calls").insert({
        account_id: accountId, phone_number_id: num.data!.id,
        caller_e164: "+19562921696", handoff_token: t,
      }).select("id");

      const first = await insert(token);
      expect(first.error, `first token insert failed: ${first.error?.message}`).toBeNull();

      const second = await insert(token);
      // 23505 is unique_violation. Without it, two live calls share a token
      // and the action route transfers whichever one it happens to read.
      expect(second.error?.code, "a duplicate handoff token was ACCEPTED").toBe("23505");

      // ...while any number of untokened calls coexist, which is every call
      // this product has ever recorded.
      const nullA = await insert(null);
      const nullB = await insert(null);
      expect(nullA.error, `null-token call rejected: ${nullA.error?.message}`).toBeNull();
      expect(nullB.error, `second null-token call rejected: ${nullB.error?.message}`).toBeNull();
    });
  });

  it("gives authenticated no write on the new calls columns — they are serviceDb()-only, like every other", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; privilege_type: string }>(
        `select column_name, privilege_type from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'calls' and privilege_type in ('INSERT', 'UPDATE')`,
      );
      // 0020 revoked every write verb on public.calls from authenticated and
      // re-granted none, so this is the WHOLE table, not just the new columns:
      // a call is a record, and a client who could write one could rewrite
      // what happened on it. 0037 adds no grant and this is the pin.
      expect(rows).toEqual([]);
    });
  });

  it("leaves handoff_token readable by the account's own members, and says why that is not a leak", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'calls' and privilege_type = 'SELECT'
            and column_name = 'handoff_token'`,
      );
      // SELECT on public.calls is TABLE-level for authenticated (0019), so it
      // covers a column added today. That is deliberate rather than
      // overlooked: `calls_tenant` is a row policy, so the only tokens a
      // member can read are the ones on their OWN account's calls, and the
      // token's whole job is to authorise an action on that same call. It is
      // a credential for a thing its reader may already do.
      //
      // Narrowing it would mean revoking table-level SELECT on `calls` and
      // re-granting fifteen columns one at a time — a change that reaches far
      // past this feature, and one the next person should make deliberately in
      // its own migration rather than discover here. Pinned so that if it ever
      // IS narrowed, this test is where the decision gets recorded.
      expect(rows).toHaveLength(1);
    });
  });
});
