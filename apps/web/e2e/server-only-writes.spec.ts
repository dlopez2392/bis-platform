import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { mintClientToken } from "./support";

// Same two paths, same reason, as every spec that talks to Supabase and Clerk
// from the runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHO WRITES THE RECORD-KEEPING TABLES, at the real data API (0053).
 *
 * Server code writes `events`, `conversations`, `messages` and
 * `form_submissions`; the client role reads them. The client role appends an
 * event only through `public.record_event`, which takes the actor from the
 * request's token. Its UPDATE on `contacts` is a column list that leaves out
 * the once-ever automation stamps. packages/db pins the same rules at the
 * catalogue (server-only-writes-grants.test.ts, record-event.test.ts); this
 * file pins them where a signed-in client actually meets them: PostgREST,
 * called with a real Clerk session token for the per-run fixture's CLIENT
 * user, so Clerk's claims and the database's grants are both the real ones.
 *
 * Every row here is on the per-run fixture account (auth.setup.ts), never on
 * Test Client One. Each test seeds its own rows with the service client and
 * deletes them in `finally`, in foreign-key order, scoped to that account.
 *
 * Every refusal is asserted by its REASON, not only its status: 42501 AND
 * "permission denied for table <name>", which is what a missing GRANT raises
 * for every verb. A bare `status >= 400` passes for any refusal (a typo'd
 * column is PGRST204). What row-level security does instead depends on the
 * verb:
 *   - POST (INSERT): a row the policy refuses is 42501 too, with "new row
 *     violates row-level security policy", so the message is what tells the
 *     two apart.
 *   - PATCH (UPDATE): rows the policy hides are simply not matched: 200 with
 *     `[]`, which the `>= 400` check catches. (A visible row whose NEW values
 *     fail the policy's WITH CHECK is 42501 with the row-level-security
 *     message again.)
 *   - DELETE: rows the policy hides are not matched either: 200 with `[]`,
 *     caught the same way.
 *
 * Each refused write is READ BACK with the service client before its refusal
 * is checked, and the read-back is a SOFT assertion. The status, code and
 * message checks stay hard, so a failing run reports both what the API
 * answered and what the row holds afterwards.
 *
 * Each case is its own test, so every one is reported by name on its own
 * rather than hidden behind the first failure in a shared test.
 */

type ClientFixture = { accountId: string; clerkUserId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
/** Read at RUN TIME, never at module scope (setup.spec.ts:70-84 explains the collection-time trap). */
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};

// `@supabase/supabase-js` is a dependency of @bis/db, not of apps/web, so the
// client's type is taken from the factory that produces it (as fixtures/sweep.ts does).
type Db = ReturnType<typeof serviceDb>;

/** The event type every probe here uses; the fixture account is this run's alone. */
const PROBE_TYPE = "e2e.boundary_probe";

/**
 * NON-DEFAULT seed values, one per column a refused write targets. A refused
 * write's read-back can only fail if the attempted value DIFFERS from the
 * stored one: the probes below write unread_count 0 and null stamps, so the
 * seeds are 3 and a fixed past instant.
 */
const SEEDED_UNREAD = 3;
const SEEDED_STAMP = "2026-01-02T03:04:05.000Z";

/** A value unique to one probe, carried in an event's payload so its row can be found again. */
const newRun = () => `sow-${Date.now()}-${randomUUID().slice(0, 8)}`;

type Rest = { status: number; rows: unknown[]; body: string };

/**
 * PostgREST, called directly with the client's own token: automations.spec.ts's
 * `rest()`, generalised to any verb and path (`/rest/v1/<table>?…` or
 * `/rest/v1/rpc/<function>`). Returns the raw body as well as the status, so
 * every assertion can read the reason.
 */
async function rest(
  token: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string,
  body?: Record<string, unknown>,
): Promise<Rest> {
  const isRpc = path.startsWith("/rest/v1/rpc/");
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(isRpc ? {} : { Prefer: "return=representation" }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // A void function answers with an empty body; only a table read or a
  // representation-returning write answers with an array.
  const rows = res.ok && text.trimStart().startsWith("[") ? (JSON.parse(text) as unknown[]) : [];
  return { status: res.status, rows, body: text };
}

/** PostgREST's error body is `{ code, message, details, hint }`. */
function errorOf(r: Rest): { code?: string; message?: string } {
  try {
    return JSON.parse(r.body) as { code?: string; message?: string };
  } catch {
    return {};
  }
}

/**
 * HARD: status, code and message. Every caller reads its row back, as a soft
 * assertion, BEFORE calling this, so a run that fails here still reports what
 * the row holds.
 */
function expectRefusedByPrivilege(r: Rest, table: string) {
  expect(r.status, r.body).toBeGreaterThanOrEqual(400);
  const e = errorOf(r);
  expect(e.code, r.body).toBe("42501");
  expect(e.message, r.body).toMatch(new RegExp(`permission denied for table ${table}\\b`));
}

type AppRoleClaim = { shape: "absent" | "null" | "string" | "other"; isAgency: boolean };

/**
 * The SHAPE of the minted token's `app_role` claim, and whether it names the
 * agency exactly as app.is_agency() tests it (`= 'agency_admin'`, 0001). Only
 * those two leave this function: never the token, never the claim's value,
 * and no error below echoes either.
 */
function appRoleClaim(token: string): AppRoleClaim {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("the minted Clerk token is not a JWT");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("the minted Clerk token's payload is not JSON");
  }
  if (typeof claims !== "object" || claims === null) {
    throw new Error("the minted Clerk token's payload is not an object");
  }
  if (!Object.prototype.hasOwnProperty.call(claims, "app_role")) return { shape: "absent", isAgency: false };
  const value = (claims as Record<string, unknown>).app_role;
  if (value === null) return { shape: "null", isAgency: false };
  if (typeof value === "string") return { shape: "string", isAgency: value === "agency_admin" };
  return { shape: "other", isAgency: false };
}

/**
 * This fixture account's probe events carrying `run`, read with the service
 * client and filtered in the database (`payload->>run`). The limit is 2, not
 * 1, so "exactly one" can still see a second row.
 */
async function probeEvents(db: Db, accountId: string, run: string) {
  const { data, error } = await db.from("events")
    .select("actor_type, actor_id, payload")
    .eq("account_id", accountId).eq("type", PROBE_TYPE).eq("payload->>run", run)
    .limit(2);
  if (error) throw new Error(`could not read events: ${error.message}`);
  return (data ?? []) as { actor_type: string; actor_id: string | null; payload: { run?: string } }[];
}

/** One row read back with the service client. A read that errors is not a result, so it throws. */
async function readBack(db: Db, table: string, columns: string, column: string, value: string) {
  const { data, error } = await db.from(table).select(columns).eq(column, value);
  if (error) throw new Error(`could not read ${table} back: ${error.message}`);
  return (data ?? []) as unknown[];
}

/** A timestamp as PostgREST returns it, as `toISOString()` gives it, so it compares to SEEDED_STAMP; null stays null. */
const isoOf = (value: unknown) => (typeof value === "string" ? new Date(value).toISOString() : value);

/** The fixture's ids, the service client, and a fresh client token (Clerk's live ~60 s). */
async function asClient() {
  const { accountId, clerkUserId } = fixture();
  return { db: serviceDb(), accountId, clerkUserId, token: await mintClientToken(clerkUserId) };
}

type Seeded = {
  contactId: string; conversationId: string; messageId: string; formId: string; submissionId: string;
};

/**
 * One contact with a conversation holding one message, and one form with one
 * submission from that contact, on the fixture account. Owner-side (service
 * client). Fills `into` as it goes, so a seed that fails half-way is still
 * cleaned up.
 */
async function seed(db: Db, accountId: string, into: Partial<Seeded>): Promise<Seeded> {
  const one = async (table: string, row: Record<string, unknown>): Promise<string> => {
    const { data, error } = await db.from(table).insert(row).select("id").single();
    if (error || !data) throw new Error(`could not seed ${table}: ${error?.message ?? "no row returned"}`);
    return (data as { id: string }).id;
  };
  into.contactId = await one("contacts", {
    account_id: accountId, first_name: "Boundary", last_name: "Probe", reactivation_sent_at: SEEDED_STAMP,
  });
  into.conversationId = await one("conversations", {
    account_id: accountId, contact_id: into.contactId, unread_count: SEEDED_UNREAD,
  });
  into.messageId = await one("messages", {
    account_id: accountId, conversation_id: into.conversationId, channel: "sms", direction: "outbound",
    body: "boundary probe",
  });
  into.formId = await one("forms", {
    account_id: accountId, public_id: `sow_${newRun()}`, name: "Boundary probe form",
  });
  into.submissionId = await one("form_submissions", {
    account_id: accountId, form_id: into.formId, contact_id: into.contactId, instant_reply_sent_at: SEEDED_STAMP,
  });
  return into as Seeded;
}

/**
 * Foreign-key order: messages (every one on the seeded conversation, not only
 * the seeded id, so a write that was meant to be refused leaves nothing
 * behind), then conversations, form_submissions (by form), forms, contacts.
 * Every delete is also scoped to the fixture account. Returns the failures
 * rather than throwing, so a cleanup error never hides the assertion that
 * failed before it.
 */
async function cleanUp(db: Db, accountId: string, s: Partial<Seeded>): Promise<string[]> {
  const errors: string[] = [];
  const del = async (table: string, column: string, value: string | undefined) => {
    if (!value) return;
    try {
      const { error } = await db.from(table).delete().eq("account_id", accountId).eq(column, value);
      if (error) errors.push(`${table}: ${error.message}`);
    } catch (e) {
      errors.push(`${table}: ${String(e)}`);
    }
  };
  await del("messages", "conversation_id", s.conversationId);
  await del("conversations", "id", s.conversationId);
  await del("form_submissions", "form_id", s.formId);
  await del("forms", "id", s.formId);
  await del("contacts", "id", s.contactId);
  return errors;
}

async function withSeeded(
  body: (ctx: { db: Db; accountId: string; token: string; seeded: Seeded }) => Promise<void>,
): Promise<void> {
  const { accountId, clerkUserId } = fixture();
  const db = serviceDb();
  const partial: Partial<Seeded> = {};
  try {
    const seeded = await seed(db, accountId, partial);
    const token = await mintClientToken(clerkUserId);
    await body({ db, accountId, token, seeded });
  } finally {
    expect.soft(await cleanUp(db, accountId, partial), "deleting the rows this test seeded").toEqual([]);
  }
}

// client-access.spec.ts switches the fixture's access OFF and does not restore
// it (auth.teardown deletes the fixture), and that file sorts before this one.
// Every read and write below is the account's own, which requires access on.
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

test.describe("the client role at the data API: server code writes the record-keeping tables", () => {
  // THE POSITIVE CASE FIRST: every refusal below would pass just as happily
  // for a token that can reach nothing at all.
  test("POSITIVE CONTROL: the client reads its own message", async () => {
    await withSeeded(async ({ token, seeded }) => {
      const own = await rest(token, "GET", `/rest/v1/messages?id=eq.${seeded.messageId}&select=id`);
      expect(own.status, own.body).toBe(200);
      expect(own.rows).toEqual([{ id: seeded.messageId }]);
    });
  });

  test("a client's event goes through record_event, stamped with the token's own user, and the function takes no actor", async () => {
    const { db, accountId, clerkUserId, token } = await asClient();

    const run = newRun();
    const appended = await rest(token, "POST", "/rest/v1/rpc/record_event",
      { p_account_id: accountId, p_type: PROBE_TYPE, p_payload: { run } });
    expect(appended.status, appended.body).toBeGreaterThanOrEqual(200);
    expect(appended.status, appended.body).toBeLessThan(300);
    // The actor is the token's `sub`, which Clerk minted for this user; the
    // call above sent no actor at all.
    expect(await probeEvents(db, accountId, run))
      .toEqual([{ actor_type: "user", actor_id: clerkUserId, payload: { run } }]);

    // PGRST202 is PostgREST's "no function with these argument names". On its
    // own that would also hold if record_event did not exist at all, so it
    // is asserted only here, after the call above has shown that it does: the
    // function exists, and no signature of it takes an actor.
    const aiRun = newRun();
    const withActor = await rest(token, "POST", "/rest/v1/rpc/record_event",
      { p_account_id: accountId, p_type: PROBE_TYPE, p_payload: { run: aiRun }, p_actor_type: "ai" });
    expect.soft(await probeEvents(db, accountId, aiRun), "events recorded by the call that named an actor")
      .toEqual([]);
    expect(withActor.status, withActor.body).toBeGreaterThanOrEqual(400);
    expect(errorOf(withActor).code, withActor.body).toBe("PGRST202");
  });

  test("record_event refuses, for a client's token, an account it is not a member of", async () => {
    const { token } = await asClient();
    // A CLIENT's token, not the agency's. auth.setup.ts creates the fixture
    // user with no public_metadata and fails the run if it ever carries
    // `app_role`; the session token renders the claim from
    // `{{user.public_metadata.app_role}}` (docs/runbooks/clerk-setup.md:74).
    // What Clerk renders for that unresolved shortcode is an ASSUMPTION here,
    // not a measurement: absent, or JSON null. Either way app.jwt()->>'app_role'
    // is SQL NULL, so app.is_agency() is NULL rather than false, which is the
    // case record_event's coalesce exists for. The shape is recorded on every
    // run (annotation and log line, never the value), so the first CI run
    // shows which. A non-agency STRING still passes, because the property this
    // case needs is "not the agency", but is flagged: is_agency() is then
    // false rather than NULL, and the NULL branch is covered only at the
    // database level (packages/db record-event.test.ts).
    const role = appRoleClaim(token);
    expect(role.isAgency, "the fixture's minted token names the agency").toBe(false);
    test.info().annotations.push({ type: "app_role claim shape", description: role.shape });
    console.log(`server-only-writes: the client token's app_role claim is ${role.shape}`);
    if (role.shape === "string" || role.shape === "other") {
      const note =
        `the client token carries a non-agency app_role claim (${role.shape}), so app.is_agency() is ` +
        `false here rather than NULL; the NULL branch is covered at the database level only`;
      test.info().annotations.push({ type: "warning", description: note });
      console.warn(`server-only-writes: ${note}`);
    }

    // A random id names no account, so nothing here touches any other
    // account. There is no read-back: events.account_id references accounts,
    // so no row can exist for this id and a read-back could not fail. The
    // code and message are the discriminator: past a missing membership
    // check the same call would fail on that foreign key instead (23503).
    const refused = await rest(token, "POST", "/rest/v1/rpc/record_event",
      { p_account_id: randomUUID(), p_type: PROBE_TYPE, p_payload: { run: newRun() } });
    expect(refused.status, refused.body).toBeGreaterThanOrEqual(400);
    const e = errorOf(refused);
    expect(e.code, refused.body).toBe("42501");
    expect(e.message, refused.body).toMatch(/record_event: not a member of this account/);
  });

  test("the client role cannot insert into events: record_event is its only path", async () => {
    const { db, accountId, clerkUserId, token } = await asClient();
    const run = newRun();
    const direct = await rest(token, "POST", "/rest/v1/events?select=id", {
      account_id: accountId, type: PROBE_TYPE, actor_type: "user", actor_id: clerkUserId, payload: { run },
    });
    expect.soft(await probeEvents(db, accountId, run), "events recorded by the direct insert").toEqual([]);
    expectRefusedByPrivilege(direct, "events");
  });

  test("the client role cannot insert a message", async () => {
    await withSeeded(async ({ db, accountId, token, seeded }) => {
      const r = await rest(token, "POST", "/rest/v1/messages?select=id", {
        account_id: accountId, conversation_id: seeded.conversationId, channel: "sms", direction: "inbound",
        body: "boundary probe",
      });
      expect.soft(
        await readBack(db, "messages", "id", "conversation_id", seeded.conversationId),
        "the conversation's messages after the refused insert",
      ).toEqual([{ id: seeded.messageId }]);
      expectRefusedByPrivilege(r, "messages");
    });
  });

  test("the client role cannot change a conversation's unread count", async () => {
    await withSeeded(async ({ db, token, seeded }) => {
      const r = await rest(token, "PATCH", `/rest/v1/conversations?id=eq.${seeded.conversationId}&select=id`,
        { unread_count: 0 });
      expect.soft(
        await readBack(db, "conversations", "unread_count", "id", seeded.conversationId),
        "the unread count after the refused update",
      ).toEqual([{ unread_count: SEEDED_UNREAD }]);
      expectRefusedByPrivilege(r, "conversations");
    });
  });

  test("the client role cannot clear a form submission's instant-reply stamp", async () => {
    await withSeeded(async ({ db, token, seeded }) => {
      const r = await rest(token, "PATCH", `/rest/v1/form_submissions?id=eq.${seeded.submissionId}&select=id`,
        { instant_reply_sent_at: null });
      const rows = await readBack(db, "form_submissions", "instant_reply_sent_at", "id", seeded.submissionId);
      expect.soft(
        rows.map((row) => isoOf((row as { instant_reply_sent_at: unknown }).instant_reply_sent_at)),
        "the instant-reply stamp after the refused update",
      ).toEqual([SEEDED_STAMP]);
      expectRefusedByPrivilege(r, "form_submissions");
    });
  });

  test("the client role cannot delete a message", async () => {
    await withSeeded(async ({ db, token, seeded }) => {
      const r = await rest(token, "DELETE", `/rest/v1/messages?id=eq.${seeded.messageId}&select=id`);
      expect.soft(
        await readBack(db, "messages", "id", "id", seeded.messageId),
        "the message after the refused delete",
      ).toEqual([{ id: seeded.messageId }]);
      expectRefusedByPrivilege(r, "messages");
    });
  });

  test("the client role cannot clear a contact's once-ever reactivation stamp", async () => {
    await withSeeded(async ({ db, token, seeded }) => {
      const r = await rest(token, "PATCH", `/rest/v1/contacts?id=eq.${seeded.contactId}&select=id`,
        { reactivation_sent_at: null });
      const rows = await readBack(db, "contacts", "reactivation_sent_at", "id", seeded.contactId);
      expect.soft(
        rows.map((row) => isoOf((row as { reactivation_sent_at: unknown }).reactivation_sent_at)),
        "the reactivation stamp after the refused update",
      ).toEqual([SEEDED_STAMP]);
      expectRefusedByPrivilege(r, "contacts");
    });
  });

  // The narrowing is narrow: the operator's own fields on the same row still save.
  test("POSITIVE CONTROL: the client role still renames its own contact", async () => {
    await withSeeded(async ({ db, token, seeded }) => {
      const r = await rest(token, "PATCH", `/rest/v1/contacts?id=eq.${seeded.contactId}&select=id`,
        { first_name: "E2E renamed" });
      expect(r.status, r.body).toBe(200);
      expect(r.rows).toEqual([{ id: seeded.contactId }]);
      const { data, error } = await db.from("contacts").select("first_name").eq("id", seeded.contactId).single();
      expect(error).toBeNull();
      expect(data).toEqual({ first_name: "E2E renamed" });
    });
  });
});
