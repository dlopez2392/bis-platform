import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { withRollback } from "./db";

/**
 * The 0049 fold (consent chain PR-3, plan Task 2): the two SQL files Task 15
 * pastes into execute_sql on production, run here as written, against 0055's
 * function, on the replica's `post` and on the CI project. withRollback only.
 *
 * RED BEFORE THIS TASK: the two files do not exist.
 */
const sql = (name: string) => readFileSync(fileURLToPath(new URL(`../../supabase/backfills/${name}`, import.meta.url)), "utf8");
const RUN = Math.random().toString(36).slice(2, 10);

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, $3) returning id",
    [agency!.id, `org_FOLD_${label}_${RUN}`, `Fold ${label}`])).rows[0]!.id;
}
async function contact(c: Client, accountId: string, email: string | null, optedOutAt: string | null): Promise<string> {
  return (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, email, marketing_email_opted_out_at) values ($1, 'Fold', $2, $3) returning id",
    [accountId, email, optedOutAt])).rows[0]!.id;
}
/** As service_role, the function's only grantee besides its owner (0055). */
async function asService<T>(c: Client, q: string): Promise<T[]> {
  await c.query("set local role service_role");
  try {
    return (await c.query(q)).rows as T[];
  } finally {
    await c.query("reset role");
  }
}
type Outcome = { outcome: string; n: number };
const outcomes = (rows: Outcome[]) => Object.fromEntries(rows.map((r) => [r.outcome, Number(r.n)]));

/**
 * The fixture, in one fresh account (the counts below are scoped to it by
 * a WHERE the test adds around the file's own statement, so rows from other
 * accounts on the CI project cannot move them):
 *   ana1  opted out 2026-09-01, "  Ana@X.com " (spaces, capitals)
 *   ana2  opted out 2026-09-05, "ana@x.com" — the same address, later
 *   ana3  NOT opted out, "ANA@x.com" — the same address: it stops too
 *   none  opted out, no email
 *   uni   opted out, "ñandu@x.com" — outside printable ASCII: left out
 *   fe    opted out, "fe@x.com", already stopped by the customer (one_click)
 *   gee   opted out, "gee@x.com", a booking in 7 days
 *   fut   opted out TOMORROW, "fut@x.com": a future stamp, never folded
 */
async function fixture(c: Client) {
  const a = await account(c, "one");
  const ids = {
    ana1: await contact(c, a, "  Ana@X.com ", "2026-09-01T10:00:00Z"),
    ana2: await contact(c, a, "ana@x.com", "2026-09-05T10:00:00Z"),
    ana3: await contact(c, a, "ANA@x.com", null),
    none: await contact(c, a, null, "2026-09-02T10:00:00Z"),
    uni: await contact(c, a, "ñandu@x.com", "2026-09-03T10:00:00Z"),
    fe: await contact(c, a, "fe@x.com", "2026-09-04T10:00:00Z"),
    gee: await contact(c, a, "gee@x.com", "2026-09-06T10:00:00Z"),
    fut: await contact(c, a, "fut@x.com", new Date(Date.now() + 86_400_000).toISOString()),
  };
  await asService(c, `select * from public.append_consent_event('${a}', 'email', 'fe@x.com', 'revoked', 'one_click', 'none', null, null, null, null, null, '{}'::jsonb, null)`);
  const cal = (await c.query<{ id: string }>(
    "insert into calendars (account_id, public_id) values ($1, $2) returning id", [a, `fold-${RUN}`])).rows[0]!.id;
  await c.query(
    "insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token) values ($1, $2, $3, now() + interval '7 days', now() + interval '7 days 1 hour', $4)",
    [a, cal, ids.gee, `fold-cancel-${RUN}`]);
  return { a, ids };
}

/** The file's OWN statement, narrowed to one account (the CI project holds
 *  other accounts' contacts): the first CTE's filter gains the account. */
const OPTED_FILTER = "   where c.marketing_email_opted_out_at is not null";
const scoped = (file: string, accountId: string) => {
  const text = sql(file);
  expect(text.split(OPTED_FILTER).length, `${file} must hold its opted-out filter exactly once`).toBe(2);
  return text.replace(OPTED_FILTER, `${OPTED_FILTER} and c.account_id = '${accountId}'`);
};

describe("0049-fold-count.sql", () => {
  it("counts what the fold would write and what it widens, naming no customer, judging foldable by the WRITE's own rules (mutation: count contacts instead of distinct addresses → to_fold_addresses 4, FAILS; drop the ASCII rule → left_out_needs_a_look 0, FAILS; drop `o.at <= now()` from foldable → to_fold_addresses 4, FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await fixture(c);
      const [row] = await asService<Record<string, unknown>>(c, scoped("0049-fold-count.sql", a));
      expect({
        opted_out_contacts: Number(row!.opted_out_contacts),
        no_email: Number(row!.no_email),
        left_out_needs_a_look: Number(row!.left_out_needs_a_look),
        to_fold_addresses: Number(row!.to_fold_addresses),
        accounts: Number(row!.accounts),
        already_stopped_or_decided: Number(row!.already_stopped_or_decided),
        other_contacts_sharing_an_address: Number(row!.other_contacts_sharing_an_address),
        with_a_booking_in_30_days: Number(row!.with_a_booking_in_30_days),
        future_stamps: Number(row!.future_stamps),
      }).toEqual({
        opted_out_contacts: 7, no_email: 1, left_out_needs_a_look: 1, to_fold_addresses: 3, accounts: 1,
        already_stopped_or_decided: 1, other_contacts_sharing_an_address: 1, with_a_booking_in_30_days: 1, future_stamps: 1,
      });
      expect(row!.can_write).toBe(true);
    }));
});

describe("0049-fold-write.sql", () => {
  it("writes ONE backfill_0049 stop per address, dated at the earliest opt-out, sourced to that one event; refuses an address the customer already stopped; skips the future stamp (mutation: order the DISTINCT ON by the stamp DESC → occurred_at is 2026-09-05, FAILS; drop `o.at <= now()` → 0055 raises 22023 on fut and the whole statement fails, FAILS)", () =>
    withRollback(async (c) => {
      const { a, ids } = await fixture(c);
      expect(outcomes(await asService<Outcome>(c, scoped("0049-fold-write.sql", a)))).toEqual({ appended: 2, refused: 1 });
      const { rows } = await c.query<{ address: string; occurred_at: Date; contact_id: string; source_ref: string; evidence: Record<string, unknown> }>(
        "select address, occurred_at, contact_id, source_ref, evidence from consent_events where account_id = $1 and method = 'backfill_0049' order by address", [a]);
      expect(rows.map((r) => r.address)).toEqual(["ana@x.com", "gee@x.com"]);
      expect(rows[0]!.occurred_at.toISOString()).toBe("2026-09-01T10:00:00.000Z");
      expect(rows[0]!.contact_id).toBe(ids.ana1);
      expect(rows[0]!.source_ref).toBe(`contact:${ids.ana1}:0049:2026-09-01T10:00:00.000000Z`);
      expect(rows[0]!.evidence).toEqual({ column: "contacts.marketing_email_opted_out_at", contactId: ids.ana1 });
    }));

  it("is idempotent: a second run writes nothing — the same source answers duplicate, the refused stays refused (spec §5 'Backfills are idempotent'; mutation: end the source with clock_timestamp()::text → the second run's sources are new, so 0055's backfill rule refuses all three over the first run's stops and the outcomes read { refused: 3 }, not { duplicate: 2, refused: 1 }, FAILS — `now()` would NOT bite: it is fixed for the whole transaction, withRollback's included)", () =>
    withRollback(async (c) => {
      const { a } = await fixture(c);
      await asService(c, scoped("0049-fold-write.sql", a));
      expect(outcomes(await asService<Outcome>(c, scoped("0049-fold-write.sql", a)))).toEqual({ duplicate: 2, refused: 1 });
      const { rows: [n] } = await c.query<{ n: string }>("select count(*) as n from consent_events where account_id = $1 and method = 'backfill_0049'", [a]);
      expect(Number(n!.n)).toBe(2);
    }));

  it("never lands over a later customer act: after a resubscribe, a delta run's older row does not change the state (0055 appends it, older; the reducer keeps the resubscribe; mutation: pass clock_timestamp() as the row's time in the file → the backfill row is newest and the address reads stopped, FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await fixture(c);
      await asService(c, `select * from public.append_consent_event('${a}', 'email', 'gee@x.com', 'revoked', 'one_click', 'none', null, null, null, null, null, '{}'::jsonb, null)`);
      await c.query("select pg_sleep(0.002)");
      await asService(c, `select * from public.append_consent_event('${a}', 'email', 'gee@x.com', 'resubscribed', 'unsubscribe_page', 'if_stopped_or_held', null, null, null, null, null, '{}'::jsonb, null)`);
      await asService(c, scoped("0049-fold-write.sql", a));
      const { rows: [newest] } = await c.query<{ action: string }>(
        `select action from consent_events where account_id = $1 and channel = 'email' and address = 'gee@x.com'
            and action in ('revoked','held','hold_released','resubscribed')
          order by date_trunc('milliseconds', occurred_at) desc,
                   case action when 'revoked' then 3 when 'held' then 2 else 1 end desc, id desc limit 1`, [a]);
      expect(newest!.action).toBe("resubscribed");
    }));
});
