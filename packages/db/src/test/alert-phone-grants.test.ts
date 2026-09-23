import { describe, it, expect } from "vitest";
import { withRollback, actAs, actAsOwner } from "./db";
import { withTestAccount, testPhoneNumber } from "./fixtures";

/**
 * 0035 adds ONE nullable column to public.accounts and NO grant, and the
 * absent grant is the part worth pinning.
 *
 * `public.accounts` is edited per-column by clients — 0013 revoked UPDATE
 * wholesale and 0014 re-granted it one column at a time — so "we added a
 * column to accounts" is exactly the moment someone reaches for a grant out
 * of habit. `alert_phone` must not get one: it is a DESTINATION for outbound
 * messages the platform sends and the account is billed for, carrying lead
 * PII, and RLS confines the write to the client's own row but cannot judge
 * whether the destination is the right handset. See the migration's own
 * comment for the full reasoning, and `from_email` (0015) for the precedent
 * that an absent grant IS a control.
 *
 * The UPDATE list is asserted EXACTLY, in both directions, AND `alert_phone`
 * is named explicitly — the exact-set assertion alone cannot catch a column
 * that has no grant, a gap `client-branding-grants.test.ts` already records
 * for `from_email`.
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
 * Shapes this column must REFUSE. Every one is a real thing a person types or
 * a form posts, not an invented adversarial string.
 *
 * The point of refusing at save time is stated in the migration: a number that
 * cannot be dialled fails in front of the operator who typed it, not at 2 AM
 * inside a background send where the only trace is a provider error nobody
 * reads. Verified read-only against the live database before the migration was
 * written (`select '(956) 292-1696' ~ '^\+[0-9]{8,15}$'` and friends), so the
 * regex's behaviour on each of these is measured rather than assumed.
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
  // The empty string a blank form field posts. Refusing it is what gives
  // "no alert number" exactly ONE representation (NULL) — see the migration.
  "",
];

/**
 * Shapes this column must ACCEPT, all on country code 999, which is assigned
 * to no country and no service. `testPhoneNumber()`'s own doc records why:
 * this suite shares ONE Supabase project with production, and a dialable
 * number written into a column a send path will later read is a text to a
 * stranger waiting to happen. The main accepted value is DRAWN per run; the
 * two boundary values are literals because their exact digit COUNT is the
 * assertion (8 is E.164's floor, 15 its ceiling) and they are unroutable.
 */
const FLOOR_15 = "+999123456789012"; // fifteen digits, the ceiling
const FLOOR_8 = "+99912345";         // eight digits, the floor

describe("0035 accounts.alert_phone", () => {
  it("exists as nullable text with no default, so every account starts with alerts off", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{
        column_name: string; data_type: string; is_nullable: string; column_default: string | null;
      }>(
        `select column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts'
            and column_name = 'alert_phone'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data_type).toBe("text");
      // Nullable with no default is the switch: 0031's `report_emails` chose
      // an empty-array default for the same idea because an ARRAY needs a
      // value the due-query can filter on. A scalar does not — NULL already
      // is that value, and it is the ONLY "off" the check constraint permits.
      expect(rows[0]!.is_nullable).toBe("YES");
      expect(rows[0]!.column_default).toBeNull();
    });
  });

  it("carries the same E.164 shape rule as phone_numbers.e164, worded for a nullable column", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = 'public.accounts'::regclass
            and conname = 'accounts_alert_phone_check'`,
      );
      expect(rows).toHaveLength(1);
      // Pinned against the CONSTRAINT TEXT, not only against behaviour: the
      // whole reason this column reuses `phone_numbers_e164_check`'s regex
      // verbatim is that one phone-shape rule drifting from another is worse
      // than one strict rule, and only reading the definition catches a
      // later migration that "improves" it into a second dialect.
      expect(rows[0]!.def).toContain("^\\+[0-9]{8,15}$");
      // The null branch is explicit rather than leaning on SQL's
      // "a CHECK that evaluates to NULL is satisfied" rule, so nobody has to
      // know that rule to read the column.
      expect(rows[0]!.def).toContain("alert_phone IS NULL");
    });
  });

  it("starts NULL on a new account — the field is the switch, and it starts off", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data, error } = await db.from("accounts")
        .select("alert_phone").eq("id", accountId).single();
      expect(error, `accounts select failed: ${error?.message}`).toBeNull();
      expect(data!.alert_phone).toBeNull();
    });
  });

  it("stores an E.164 number exactly, at both ends of the length range, and clears back to NULL", async () => {
    await withTestAccount(async (db, accountId) => {
      const drawn = testPhoneNumber();
      for (const value of [drawn, FLOOR_8, FLOOR_15]) {
        const saved = await db.from("accounts")
          .update({ alert_phone: value }).eq("id", accountId).select("alert_phone").single();
        expect(saved.error, `alert_phone rejected ${JSON.stringify(value)}: ${saved.error?.message}`).toBeNull();
        // Exactly, byte for byte: this column does not normalise, so whatever
        // the send path is handed is whatever was written.
        expect(saved.data!.alert_phone).toBe(value);
      }

      const cleared = await db.from("accounts")
        .update({ alert_phone: null }).eq("id", accountId).select("alert_phone").single();
      expect(cleared.error, `clearing alert_phone failed: ${cleared.error?.message}`).toBeNull();
      expect(cleared.data!.alert_phone).toBeNull();
    });
  });

  it("refuses every shape that would fail to send, at save time rather than at 2 AM", async () => {
    await withTestAccount(async (db, accountId) => {
      // One account, all shapes, and the verdicts collected into a single
      // assertion rather than one expect() per shape inside a loop. A loop of
      // expects is fail-fast — the first bad shape aborts and every shape
      // after it goes unmeasured, so a red run is not a full audit. Each
      // PostgREST call is its own transaction, so a refusal does not poison
      // the next one the way it would inside `withRollback` (25P02).
      const verdicts: Record<string, string | undefined> = {};
      for (const value of REFUSED) {
        const res = await db.from("accounts")
          .update({ alert_phone: value }).eq("id", accountId).select("alert_phone");
        verdicts[JSON.stringify(value)] = res.error?.code;
      }
      // 23514 is check_violation. Every entry must carry it: an `undefined`
      // here means the database ACCEPTED a number that cannot be texted.
      expect(verdicts).toEqual(
        Object.fromEntries(REFUSED.map((value) => [JSON.stringify(value), "23514"])),
      );
    });
  });

  it("grants authenticated no UPDATE on alert_phone — the absent grant is the only control", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'accounts' and privilege_type = 'UPDATE'
          order by column_name`,
      );
      const granted = rows.map((r) => r.column_name);
      expect(granted).not.toContain("alert_phone");
      // And the exact set, so this also goes red if a later migration grants
      // something else here out of habit.
      expect(granted).toEqual(ACCOUNTS_UPDATE_COLUMNS);
    });
  });

  it("keeps alert_phone readable by the client: SELECT on accounts is table-level", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'accounts' and privilege_type = 'SELECT'
            and column_name = 'alert_phone'`,
      );
      // A table-level SELECT grant covers columns added later, so the
      // Settings page can show the number with no further work — the same
      // property 0031 verified against information_schema before relying on
      // it. Asserted rather than assumed, because "the read still works" is
      // the half of this design nobody would notice breaking until a page
      // rendered blank.
      expect(rows).toHaveLength(1);
    });
  });

  it("refuses a CLIENT's write to their own alert_phone, while the same client may still write branding", async () => {
    await withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [agency] } = await c.query<{ id: string }>(
        "insert into public.agencies (name) values ('T') returning id",
      );
      await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_alert_phone', 'AlertPhone', true)`, [agency!.id],
      );

      await actAs(c, { org_id: "org_alert_phone" });
      // Proves the POLICY lets this caller update this row at all, so the
      // refusal below is unambiguously the COLUMN grant and not RLS. Without
      // this line the test would still pass against a policy that denied
      // everything, which is a different bug wearing the same green.
      await c.query(
        "update public.accounts set brand_name = 'Renamed' where clerk_org_id = 'org_alert_phone'",
      );

      // ONE refused statement per withRollback: after this the transaction is
      // aborted (25P02) and nothing else in this block could run.
      await expect(
        c.query(
          "update public.accounts set alert_phone = $1 where clerk_org_id = 'org_alert_phone'",
          [FLOOR_15],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("needs no new policy: accounts RLS is row-scoped and every policy is to authenticated", async () => {
    await withRollback(async (c) => {
      const { rows: sec } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = 'public.accounts'::regclass`,
      );
      expect(sec[0]?.relrowsecurity).toBe(true);

      const { rows: pol } = await c.query<{ policyname: string; roles: string }>(
        `select policyname, roles::text as roles from pg_policies
          where schemaname = 'public' and tablename = 'accounts' order by policyname`,
      );
      // A Postgres policy is ROW-scoped and never column-scoped, so these
      // three already cover a column added today — there is nothing for 0035
      // to add, and adding one would be the mistake. What must not change is
      // WHO they are scoped to: 0016 shipped the schema's only PUBLIC-scoped
      // policies and 0017 rescoped them, so the role list is pinned here too.
      expect(pol.map((r) => r.policyname)).toEqual([
        "accounts_agency_all", "accounts_member_read", "accounts_member_update",
      ]);
      for (const p of pol) expect(p.roles, `${p.policyname} roles`).toBe("{authenticated}");
    });
  });
});
