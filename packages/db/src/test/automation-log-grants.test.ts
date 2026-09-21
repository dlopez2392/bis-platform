import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import {
  recordAutomationLog, listReleasableHolds, bumpHeldForAccount, listAutomationLog, countAutomationUsage,
} from "../automation-log";
import { readQuietSettings, saveQuietSettings } from "../automation-settings";
import { createContact } from "../contacts";

/**
 * 0046 at the level that can see it. Unit tests that mock the db are blind
 * to grants (four shipped defects in this repo); these run real SQL inside a
 * rolled-back transaction, or through serviceDb() under withTestAccount.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_AL_${label}_${RUN}`;

const TABLES = ["automation_log", "automation_settings"] as const;

async function seedTwoAccountsWithLog(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const mk = async (org: string, name: string) => (await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency.id, org, name])).rows[0].id as string;
  const a = await mk(orgId("A"), "Alpha");
  const b = await mk(orgId("B"), "Bravo");
  await c.query(
    `insert into automation_log (account_id, source, channel, subject_key, status, reason)
       values ($1,'sms_reminder','sms','booking:a1','sent',''), ($2,'sms_reminder','sms','booking:b1','sent','')`,
    [a, b]);
  await c.query(
    "insert into automation_settings (account_id, quiet_start, quiet_end) values ($1,'22:00','07:00'), ($2,'23:00','06:00')",
    [a, b]);
  return { a, b };
}

describe("0046 tables exist (guards every grants assertion below from vacuity)", () => {
  for (const table of TABLES) {
    it(`${table} exists`, () => withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(`select to_regclass('public.${table}')::text as oid`);
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe(table);
    }));
  }
});

describe("0046 grants", () => {
  for (const table of TABLES) {
    // EXACT set, not containment: the default ACL hands TRUNCATE to
    // authenticated on every new table (call-proposals-grants.test.ts:104-118).
    it(`${table}: authenticated holds EXACTLY select (mutation: grant insert to authenticated → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' order by privilege_type`, [table]);
        expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
      }));

    it(`${table}: anon holds nothing (mutation: drop the revoke from anon → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'anon'`, [table]);
        expect(rows).toEqual([]);
      }));

    it(`${table}: service_role holds at least select/insert/update/delete`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ privilege_type: string }>(
          `select privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'service_role'`, [table]);
        expect(rows.map((r) => r.privilege_type)).toEqual(expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]));
      }));

    it(`${table}: the whole grant set across every role but postgres (catches a grant to PUBLIC)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee <> 'postgres' order by grantee, privilege_type`, [table]);
        expect(rows).toEqual([
          { grantee: "authenticated", privilege_type: "SELECT" },
          { grantee: "service_role", privilege_type: "DELETE" },
          { grantee: "service_role", privilege_type: "INSERT" },
          { grantee: "service_role", privilege_type: "REFERENCES" },
          { grantee: "service_role", privilege_type: "SELECT" },
          { grantee: "service_role", privilege_type: "TRIGGER" },
          { grantee: "service_role", privilege_type: "TRUNCATE" },
          { grantee: "service_role", privilege_type: "UPDATE" },
        ]);
      }));

    // information_schema.role_table_grants does not report MAINTAIN at all
    // (it is not one of the privilege_type values that view enumerates), so
    // the "holds EXACTLY select" test above is blind to it — this is the
    // only assertion in the file that can see PG17's default ACL handing
    // authenticated the `m` bit alongside `arwdDxt`. has_table_privilege
    // reads the real ACL directly, bypassing that view's blind spot.
    it(`${table}: authenticated does not hold MAINTAIN (invisible to role_table_grants; mutation: enumerate the revoke like 0025 → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ m: boolean }>(
          `select has_table_privilege('authenticated', 'public.${table}', 'MAINTAIN') as m`);
        expect(rows[0]!.m).toBe(false);
      }));
  }
});

describe("0046 RLS — a second account's row is PRESENT in every case", () => {
  it("a client reads only its own log rows (mutation: drop the policy's account_id clause → FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select account_id from automation_log");
      expect(rows.map((r: any) => r.account_id)).toEqual([a]);
    }));

  it("a client reads only its own settings row", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select account_id, quiet_start::text as s from automation_settings");
      expect(rows).toEqual([{ account_id: a, s: "22:00:00" }]);
    }));

  it("the agency reads every account's rows", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccountsWithLog(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select account_id from automation_log where account_id in ($1,$2) order by account_id", [a, b]);
      expect(rows.map((r: any) => r.account_id).sort()).toEqual([a, b].sort());
    }));

  // ONE refused statement per withRollback (the abort would hide the reason
  // of any later one). A REAL account id, so RLS's own check would PASS and
  // the only thing refusing is the grant — 42501, never "an error".
  it("a client cannot INSERT a log row, even for its own account: 42501", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query(
        "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'voice','ai','call:x','sent')", [a],
      )).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot UPDATE a log row (the escalation: re-labelling a skipped send as sent): 42501", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update automation_log set status = 'skipped' where account_id = $1", [a]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot turn its own quiet hours off: 42501", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update automation_settings set quiet_enabled = false where account_id = $1", [a]))
        .rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0046 constraints (23514 = check_violation, 23505 = unique_violation)", () => {
  it("a held row must carry held_until and a sent row must not; source and status are closed lists", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      const verdicts: Record<string, string | undefined> = {};
      for (const [label, sql] of Object.entries({
        "held without held_until": "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'reminders','email','booking:h1','held')",
        "sent with held_until": "insert into automation_log (account_id, source, channel, subject_key, status, held_until) values ($1,'reminders','email','booking:s1','sent',now())",
        "an unknown source": "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'weekly_agency_report','email','week:x','sent')",
        "an unknown status": "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'reminders','email','booking:q1','queued')",
      })) {
        await c.query("savepoint s");
        try { await c.query(sql, [a]); verdicts[label] = undefined; }
        catch (e: any) { verdicts[label] = e.code; }
        await c.query("rollback to savepoint s");
      }
      expect(verdicts).toEqual({
        "held without held_until": "23514", "sent with held_until": "23514",
        "an unknown source": "23514", "an unknown status": "23514",
      });
    }));

  it("one row per (account, source, subject): a second INSERT is refused (23505); the accessor upserts instead", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await expect(c.query(
        "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'sms_reminder','sms','booking:a1','skipped')", [a],
      )).rejects.toMatchObject({ code: "23505" });
    }));
});

describe("0046 accessors, live (serviceDb under withTestAccount)", () => {
  it("recordAutomationLog flips a held row to sent IN PLACE — exactly one row after both writes (mutation: insert instead of upsert → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const base = { accountId, source: "sms_reminder" as const, channel: "sms" as const, contactId: null, subjectKey: `booking:${RUN}` };
      await recordAutomationLog(db, { ...base, status: "held", heldUntil: "2026-09-22T13:00:00.000Z", reason: "Held until 8:00 AM — quiet hours" });
      await recordAutomationLog(db, { ...base, status: "sent" });
      const rows = await listAutomationLog(db, accountId, { limit: 10 });
      expect(rows.map((r) => [r.subject_key, r.status, r.reason, r.held_until])).toEqual([[`booking:${RUN}`, "sent", "", null]]);
    });
  });

  it("recordAutomationLog refuses a held write without heldUntil BEFORE any query", async () => {
    await expect(recordAutomationLog(serviceDb(), {
      accountId: "00000000-0000-0000-0000-000000000000", source: "reminders", channel: "email",
      contactId: null, subjectKey: "booking:x", status: "held",
    })).rejects.toThrow(/needs heldUntil/);
  });

  it("listReleasableHolds returns held rows whose time has come, oldest first, and nothing else (mutation: drop the lte → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const mk = (k: string, status: "held" | "sent", heldUntil?: string) =>
        recordAutomationLog(db, { accountId, source: "followups", channel: "email", contactId: null, subjectKey: `booking:${k}`, status, heldUntil });
      await mk("later", "held", "2099-01-01T00:00:00.000Z");
      await mk("due2", "held", "2026-01-02T00:00:00.000Z");
      await mk("due1", "held", "2026-01-01T00:00:00.000Z");
      await mk("sent", "sent");
      const due = (await listReleasableHolds(db, "2026-06-01T00:00:00.000Z"))
        .filter((r) => r.account_id === accountId);   // the shared project may hold other accounts' rows
      expect(due.map((r) => r.subject_key)).toEqual(["booking:due1", "booking:due2"]);
    });
  });

  it("bumpHeldForAccount makes every held row of ONE account due now and touches no other status", async () => {
    await withTestAccount(async (db, accountId) => {
      await recordAutomationLog(db, { accountId, source: "reminders", channel: "email", contactId: null, subjectKey: "booking:h", status: "held", heldUntil: "2099-01-01T00:00:00.000Z" });
      await recordAutomationLog(db, { accountId, source: "reminders", channel: "email", contactId: null, subjectKey: "booking:s", status: "sent" });
      expect(await bumpHeldForAccount(db, accountId)).toBe(1);
      const rows = await listAutomationLog(db, accountId, { limit: 10 });
      const held = rows.find((r) => r.subject_key === "booking:h")!;
      expect(new Date(held.held_until!).getTime()).toBeLessThan(Date.now() + 1000);
      expect(rows.find((r) => r.subject_key === "booking:s")!.held_until).toBeNull();
    });
  });

  it("listAutomationLog pages newest-first on (occurred_at, id) with no overlap and no skip, and carries the contact's name", async () => {
    await withTestAccount(async (db, accountId) => {
      // Real contacts, so the `contacts(first_name, last_name)` embed in
      // listAutomationLog is actually exercised (not just written with
      // contactId: null every time, which would leave the join dark).
      const maria = await createContact(db, accountId, { firstName: "Maria", lastName: "Garcia" }, "user_test");
      const solo = await createContact(db, accountId, { firstName: "Solo" }, "user_test");
      await recordAutomationLog(db, { accountId, source: "voice", channel: "ai", contactId: maria.id, subjectKey: "call:1", status: "sent" });
      await recordAutomationLog(db, { accountId, source: "voice", channel: "ai", contactId: solo.id, subjectKey: "call:2", status: "sent" });
      await recordAutomationLog(db, { accountId, source: "voice", channel: "ai", contactId: null, subjectKey: "call:3", status: "sent" });
      const page1 = await listAutomationLog(db, accountId, { limit: 2 });
      expect(page1).toHaveLength(2);
      const last = page1[1]!;
      const page2 = await listAutomationLog(db, accountId, { limit: 2, before: { occurredAt: last.occurred_at, id: last.id } });
      const seen = [...page1, ...page2].map((r) => r.subject_key);
      expect(new Set(seen).size).toBe(3);
      expect(page2).toHaveLength(1);
      // Newest first: call:3 (no contact) → call:2 (Solo, no last name) →
      // call:1 (Maria Garcia).
      expect(page1[0]!.contact_name).toBeNull();
      expect(page1[1]!.contact_name).toBe("Solo");
      expect(page2[0]!.contact_name).toBe("Maria Garcia");
    });
  });

  it("countAutomationUsage counts sent by channel and source, plus held/skipped with their most common reason, inside [from, to)", async () => {
    await withTestAccount(async (db, accountId) => {
      const w = (source: any, channel: any, k: string, status: any, reason = "", heldUntil?: string) =>
        recordAutomationLog(db, { accountId, source, channel, contactId: null, subjectKey: k, status, reason, heldUntil });
      await w("sms_reminder", "sms", "booking:1", "sent");
      await w("instant_reply", "sms", "submission:1", "sent");
      await w("reminders", "email", "booking:2", "sent");
      await w("concierge", "ai", "conversation:1", "sent");
      await w("voice", "ai", "call:1", "sent");
      await w("voice", "ai", "call:2", "skipped", "Screened as a robocall");
      await w("voice", "ai", "call:3", "skipped", "Screened as a robocall");
      await w("followups", "email", "booking:3", "skipped", "No email address on file");
      await w("review_request", "sms", "booking:4", "held", "Held until 8:00 AM — quiet hours", "2099-01-01T00:00:00.000Z");
      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();
      expect(await countAutomationUsage(db, accountId, from, to)).toEqual({
        textsSent: 2, emailsSent: 1, conversations: 1, callsHandled: 1,
        held: 1, skipped: 3,
        topHeldReason: "Held until 8:00 AM — quiet hours", topSkippedReason: "Screened as a robocall",
      });
      expect((await countAutomationUsage(db, accountId, to, "2099-01-01T00:00:00.000Z")).textsSent).toBe(0);
    });
  });

  it("readQuietSettings returns the defaults for an account with no row, and the saved window after a save", async () => {
    await withTestAccount(async (db, accountId) => {
      // The literal, not DEFAULT_QUIET_SETTINGS: comparing the accessor's
      // output to the same constant it reads internally would pass even if
      // both drifted from the migration's actual column defaults together.
      expect(await readQuietSettings(db, accountId)).toEqual({ enabled: true, start: "21:00", end: "08:00" });
      // "WITHOUT writing one" — asserted, not assumed: no row exists yet.
      const before = await db.from("automation_settings").select("account_id").eq("account_id", accountId);
      expect(before.error).toBeNull();
      expect(before.data).toEqual([]);
      await saveQuietSettings(db, accountId, { enabled: true, start: "22:30", end: "06:15" }, "user_test");
      expect(await readQuietSettings(db, accountId)).toEqual({ enabled: true, start: "22:30", end: "06:15" });
      const { data: ev, error: evErr } = await db.from("events").select("type").eq("account_id", accountId).eq("type", "automation_settings.updated");
      expect(evErr).toBeNull();
      expect(ev).toHaveLength(1);
    });
  });

  it("saveQuietSettings refuses a clock that is not HH:MM before writing", async () => {
    await expect(saveQuietSettings(serviceDb(), "00000000-0000-0000-0000-000000000000", { enabled: true, start: "9pm", end: "08:00" }, "user_test"))
      .rejects.toThrow(/HH:MM/);
  });

  for (const table of TABLES) {
    it(`${table} is carried off by the account's own deletion, so it needs no line in the teardown list`, async () => {
      let accountId = "";
      await withTestAccount(async (db, id) => {
        accountId = id;
        if (table === "automation_log") {
          await recordAutomationLog(db, { accountId: id, source: "voice", channel: "ai", contactId: null, subjectKey: "call:c", status: "sent" });
        } else {
          await saveQuietSettings(db, id, { enabled: false, start: "21:00", end: "08:00" }, "user_test");
        }
      });
      // withTestAccount's finally has run deleteAccountCascade, which does NOT
      // name either table. Under restrict that would have thrown; under
      // cascade the rows are gone. This is what makes the absence from
      // ACCOUNT_OWNED_TABLES a decision instead of an omission.
      const { data, error } = await serviceDb().from(table).select("account_id").eq("account_id", accountId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }
});
