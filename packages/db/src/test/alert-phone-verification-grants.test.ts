import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { serviceDb } from "../service";
import {
  ALERT_CODE_DIGITS, ALERT_CODE_MAX_ATTEMPTS, ALERT_CODE_TTL_MINUTES,
  generateAlertCode, hashAlertCode,
} from "../alert-phone-verification";

/**
 * 0036 — the storage behind proof of possession for `accounts.alert_phone`.
 *
 * 0035 Decision 1 named the gap it was leaving: the agency writes the alert
 * number with nothing proving anybody holds the handset, and a mistyped digit
 * sends a stranger a stream of customers' names and appointment times with no
 * symptom anywhere. This file pins the storage that closes it.
 *
 * THE TABLE IS SERVICE-ROLE ONLY, and that is the assertion worth reading
 * twice. `code_hash` is an unsalted SHA-256 of a six-digit code — 10^6
 * preimages, reversible in milliseconds — so a SELECT grant to
 * `authenticated` would hand the code to every token in the org and the gate
 * would prove nothing. Every other tenant table in this schema grants
 * `authenticated` at least SELECT; this one is the first that grants it
 * nothing, so the exact-empty assertion below is the design, not tidiness.
 */
const HEX64 = /^[0-9a-f]{64}$/;

/** sha256('123456') as computed BY POSTGRES, read-only, before any of this
 *  was written: `select encode(extensions.digest('123456','sha256'),'hex')`
 *  against project tlbkbmlrfafquucsmsmm. Pinning Node's answer against the
 *  DATABASE's is the 0033/0034 lesson applied to a value two engines must
 *  agree on: there, a generated column and its TypeScript twin disagreed on a
 *  tab and nothing caught it. Here SQL never computes the hash — only Node
 *  does — but the column's CHECK still describes its shape, so the two still
 *  have to agree, and this literal is what makes that a measurement. */
const PG_SHA256_OF_123456 =
  "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";

describe("alert code twin (no database)", () => {
  it("hashes a code the way the database's own digest() does", () => {
    expect(hashAlertCode("123456")).toBe(PG_SHA256_OF_123456);
  });

  it("produces exactly the shape alert_phone_verifications_code_hash_check accepts", () => {
    // Lowercase hex, 64 chars. Uppercase or base64 would satisfy `text` and
    // fail the column, which is the failure this pins.
    expect(hashAlertCode(generateAlertCode())).toMatch(HEX64);
    expect(hashAlertCode("000000")).toMatch(HEX64);
  });

  it("draws codes of exactly six digits, leading zeros included", () => {
    // 2000 draws: a `String(randomInt(...))` without padding produces a
    // five-digit code about one draw in ten, and a five-digit code silently
    // shrinks the guess space by 90%.
    const drawn = Array.from({ length: 2000 }, generateAlertCode);
    const wrong = drawn.filter((c) => !new RegExp(`^[0-9]{${ALERT_CODE_DIGITS}}$`).test(c));
    expect(wrong).toEqual([]);
    // Not a constant function either: 2000 draws from 10^6 collide often but
    // are never all equal.
    expect(new Set(drawn).size).toBeGreaterThan(1000);
  });

  it("states the limits the migration's CHECK constraints hold", () => {
    expect([ALERT_CODE_DIGITS, ALERT_CODE_MAX_ATTEMPTS, ALERT_CODE_TTL_MINUTES])
      .toEqual([6, 5, 10]);
  });
});

describe("0036 alert_phone_verifications shape", () => {
  it("has exactly the columns the verification needs, and no more", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{
        column_name: string; data_type: string; is_nullable: string; column_default: string | null;
      }>(
        `select column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'alert_phone_verifications'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        "account_id", "attempts", "code_hash", "consumed_at",
        "created_at", "expires_at", "id", "phone",
      ]);
      const by = Object.fromEntries(rows.map((r) => [r.column_name, r]));
      // `consumed_at` is the ONLY nullable column: null means "not proven
      // yet", and that is the whole state machine. A nullable `phone` or
      // `code_hash` would be a row that claims nothing.
      expect(rows.filter((r) => r.is_nullable === "YES").map((r) => r.column_name))
        .toEqual(["consumed_at"]);
      expect(by.attempts!.data_type).toBe("smallint");
      // Postgres deparses a smallint default either way depending on how the
      // literal was coerced; both are the same default, and pinning the
      // rendering harder would fail on a truth about pg_get_expr rather than
      // about this table.
      expect(by.attempts!.column_default).toMatch(/^0(::smallint)?$/);
      expect(by.expires_at!.column_default).toContain("now()");
    });
  });

  it("carries the ONE phone-shape rule this platform has, byte for byte", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conname in ('alert_phone_verifications_phone_check', 'accounts_alert_phone_check')`,
      );
      const def = (name: string) => rows.find((r) => r.conname === name)?.def;
      const pattern = (d: string | undefined) => d?.match(/~ '([^']+)'::text/)?.[1];
      // Not "both contain a plausible regex" — the SAME regex, extracted from
      // each definition and compared. 0035 Decision 2 spends a paragraph on
      // why a second dialect of "a number we can reach" is worse than one
      // strict rule; this is that paragraph as an assertion.
      expect(pattern(def("alert_phone_verifications_phone_check"))).toBe("^\\+[0-9]{8,15}$");
      expect(pattern(def("alert_phone_verifications_phone_check")))
        .toBe(pattern(def("accounts_alert_phone_check")));
    });
  });

  it("holds the limits in the database, not only in the app", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'public.alert_phone_verifications'::regclass and contype = 'c'
          order by conname`,
      );
      const defs = Object.fromEntries(rows.map((r) => [r.conname, r.def]));
      expect(Object.keys(defs).sort()).toEqual([
        "alert_phone_verifications_attempts_check",
        "alert_phone_verifications_code_hash_check",
        "alert_phone_verifications_consumed_check",
        "alert_phone_verifications_lifetime_check",
        "alert_phone_verifications_phone_check",
      ]);
      // The attempt cap is the difference between a gate and a six-digit
      // speed bump. An app-side counter fails OPEN when a code path forgets
      // it; this one makes a sixth attempt unrepresentable.
      expect(defs.alert_phone_verifications_attempts_check)
        .toContain(`<= ${ALERT_CODE_MAX_ATTEMPTS}`);
      expect(defs.alert_phone_verifications_code_hash_check).toContain("[0-9a-f]{64}");
      // Written as a SUBTRACTION on purpose: `timestamptz + interval` is
      // STABLE (provolatile 's', measured on this project), `timestamptz -
      // timestamptz` is IMMUTABLE ('i'), and only the immutable form belongs
      // in a constraint.
      expect(defs.alert_phone_verifications_lifetime_check).toContain("expires_at - created_at");
    });
  });

  it("lets the account's row go when the account goes — cascade, not restrict", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ confdeltype: string }>(
        `select confdeltype from pg_constraint
          where conrelid = 'public.alert_phone_verifications'::regclass and contype = 'f'`,
      );
      // 'c' = cascade, 'r' = restrict, 'a' = no action. The lead-bearing
      // tables are `restrict` (0017); the one existing CASCADE among the 28
      // FKs into `accounts` is 0033's derived `contact_duplicate_flags`, and
      // this row belongs with it — a dead code is not evidence, and restrict
      // would make "delete this account" fail on a ten-minute-old secret.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.confdeltype).toBe("c");
    });
  });
});

describe("0036 alert_phone_verifications privileges", () => {
  it("grants authenticated and anon NOTHING — the first such table in this schema", async () => {
    await withRollback(async (c) => {
      // The table's EXISTENCE first, and not as ceremony. "no rows in
      // role_table_grants" is also true of a table that was never created,
      // so without this line the whole assertion is vacuously green before
      // the migration is applied and proves nothing after it.
      const { rows: exists } = await c.query<{ oid: string | null }>(
        `select to_regclass('public.alert_phone_verifications')::text as oid`,
      );
      // Schema-qualified or not depending on the connection's search_path,
      // which this suite does not control.
      expect(exists[0]!.oid?.replace(/^public\./, "")).toBe("alert_phone_verifications");

      const { rows } = await c.query(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'alert_phone_verifications'
            and grantee in ('authenticated', 'anon')
          order by grantee, privilege_type`,
      );
      // Measured before the migration was written: this project's
      // pg_default_acl still grants ALL on a new public table to anon,
      // authenticated AND service_role, whatever config.toml's comment says
      // about the cloud default. So the revoke is not belt-and-braces — it is
      // the only thing standing between `anon` and a table of secrets.
      expect(rows).toEqual([]);
    });
  });

  it("leaves service_role able to run the whole flow", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ privilege_type: string }>(
        `select distinct privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'alert_phone_verifications'
            and grantee = 'service_role'`,
      );
      // A superset assertion, not an exact one: the default ACL also hands
      // service_role TRIGGER/REFERENCES/TRUNCATE, and pinning those would be
      // pinning Supabase's defaults rather than this migration's intent.
      expect(rows.map((r) => r.privilege_type).sort())
        .toEqual(expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"]));
    });
  });

  it("has RLS on and NO policy — deny-all is the policy", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ relrowsecurity: boolean; policies: string }>(
        `select c.relrowsecurity,
                (select count(*) from pg_policy p where p.polrelid = c.oid)::text as policies
           from pg_class c where c.oid = 'public.alert_phone_verifications'::regclass`,
      );
      expect(rows[0]!.relrowsecurity).toBe(true);
      // Every other table here carries a `_member_all` or `_tenant` policy.
      // This one carries none, because there is no role left for a policy to
      // serve: service_role bypasses RLS and nobody else may reach the table
      // at all. If a later migration adds a policy here, it is because
      // somebody also added a grant, and that is the change to stop.
      expect(rows[0]!.policies).toBe("0");
    });
  });

  it("refuses a client's SELECT outright — 42501, before RLS is even consulted", async () => {
    await withRollback(async (c) => {
      await actAs(c, { org_id: "org_no_such_org" });
      // ONE refused statement per withRollback: this aborts the transaction
      // (25P02 for anything after it).
      await expect(
        c.query("select id from public.alert_phone_verifications limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("0036 alert_phone_verifications behaviour", () => {
  const pending = (accountId: string, phone: string, code: string) => ({
    account_id: accountId, phone, code_hash: hashAlertCode(code),
  });

  it("opens a verification with the limits already set: zero attempts, ten minutes, unconsumed", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data, error } = await db.from("alert_phone_verifications")
        .insert(pending(accountId, testPhoneNumber(), generateAlertCode()))
        .select("attempts, consumed_at, created_at, expires_at").single();
      expect(error, `insert failed: ${error?.message}`).toBeNull();
      expect(data!.attempts).toBe(0);
      expect(data!.consumed_at).toBeNull();
      const ttlMs = Date.parse(data!.expires_at) - Date.parse(data!.created_at);
      expect(ttlMs).toBe(ALERT_CODE_TTL_MINUTES * 60_000);
    });
  });

  it("refuses every row that would weaken the gate", async () => {
    await withTestAccount(async (db, accountId) => {
      const good = pending(accountId, testPhoneNumber(), generateAlertCode());
      const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
      const cases: Record<string, Record<string, unknown>> = {
        "a number that cannot be dialled": { ...good, phone: "(956) 292-1696" },
        "a blank number": { ...good, phone: "" },
        // The code stored as written instead of hashed: six digits are not 64
        // hex chars, so the column itself refuses plaintext.
        "the code in the clear": { ...good, code_hash: "123456" },
        "an uppercase digest": { ...good, code_hash: hashAlertCode("1").toUpperCase() },
        "a sixth attempt": { ...good, attempts: ALERT_CODE_MAX_ATTEMPTS + 1 },
        "a negative attempt count": { ...good, attempts: -1 },
        "a code that never expires": { ...good, expires_at: at(60 * 24 * 365) },
        "a code that expired before it was sent": { ...good, expires_at: at(-1) },
        "a consumption stamped after the deadline": {
          ...good, expires_at: at(10), consumed_at: at(11),
        },
      };
      // Verdicts collected, then ONE assertion: a loop of expects is
      // fail-fast, so the first bad row would leave every later shape
      // unmeasured and a red run would not be a full audit. Each PostgREST
      // call is its own transaction, so a refusal does not poison the next.
      const verdicts: Record<string, string | undefined> = {};
      for (const [label, row] of Object.entries(cases)) {
        const res = await db.from("alert_phone_verifications").insert(row).select("id");
        verdicts[label] = res.error?.code;
      }
      // 23514 is check_violation. An `undefined` here is a row the database
      // accepted that should never exist.
      expect(verdicts).toEqual(
        Object.fromEntries(Object.keys(cases).map((label) => [label, "23514"])),
      );
    });
  });

  it("lets an agency that mistyped try again without clearing the first attempt", async () => {
    await withTestAccount(async (db, accountId) => {
      const wrong = testPhoneNumber();
      const right = testPhoneNumber();
      const rows = [
        pending(accountId, wrong, generateAlertCode()),   // the typo
        pending(accountId, right, generateAlertCode()),   // the correction
        pending(accountId, right, generateAlertCode()),   // "it never arrived"
      ];
      const { data, error } = await db.from("alert_phone_verifications")
        .insert(rows).select("phone");
      // No unique constraint anywhere: an attempt is a fact that happened,
      // and a pending typo must not lock the account out of its own correct
      // number. The brief's own test — "an agency that mistypes twice should
      // not be locked out by its own first attempt."
      expect(error, `a second pending verification was refused: ${error?.message}`).toBeNull();
      expect(data!.map((r) => r.phone).sort()).toEqual([wrong, right, right].sort());
    });
  });

  it("is carried off by the account's own deletion, so it needs no line in the teardown list", async () => {
    let accountId = "";
    await withTestAccount(async (db, id) => {
      accountId = id;
      const { error } = await db.from("alert_phone_verifications")
        .insert(pending(id, testPhoneNumber(), generateAlertCode()));
      expect(error, `insert failed: ${error?.message}`).toBeNull();
    });
    // withTestAccount's finally has now run deleteAccountCascade, which does
    // NOT name this table. Under `on delete restrict` that would have thrown
    // "cleanup failed on accounts"; under cascade the rows are simply gone.
    // This is the assertion that makes the absence from ACCOUNT_OWNED_TABLES
    // a decision instead of an omission.
    const { data, error } = await serviceDb().from("alert_phone_verifications")
      .select("id").eq("account_id", accountId);
    expect(error, `leftover check failed: ${error?.message}`).toBeNull();
    expect(data).toEqual([]);
  });
});
