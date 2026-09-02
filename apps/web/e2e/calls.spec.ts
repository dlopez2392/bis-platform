import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, setClientAccess, assignPhoneNumber, createContact,
  startCallRow, finishCallRow, countCallsSince, type TranscriptEvent,
} from "@bis/db";
import { readLimitConfig, utcDayStart } from "../src/lib/voice/call-limits";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * `calls` carries a SELECT-only grant to `authenticated` (migration 0020,
 * correcting 0019's accidental full grant) behind an RLS policy that lets a
 * client see their own rows and nobody else's. Every unit test around the
 * Calls pages runs on plain fixtures, which cannot see a grant at all — this
 * project has shipped two defects behind that exact blind spot. A real signed-
 * in CLIENT session reading a real seeded row is the only thing that proves
 * the grant and the policy are both actually there.
 *
 * Seeded onto the per-run CLIENT FIXTURE account (auth.setup.ts), not
 * `Test Client One`: the client half needs an account the client user owns,
 * and a fresh account is what makes "1 of N calls today" a fact rather than a
 * hope — `Test Client One` carries real calls made from a real phone.
 *
 * Everything is written with the same `@bis/db` helpers the voice route itself
 * calls (`assignPhoneNumber` → `startCallRow` → `finishCallRow`), so the row
 * under test has the shape production writes rather than one this spec
 * invented.
 */
test.describe.configure({ timeout: 120_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

const stamp = Date.now();
const callerFirstName = "E2E";
const callerLastName = `Caller ${stamp}`;
const callerName = `${callerFirstName} ${callerLastName}`;
/** Fictional 555 exchange, timestamp-unique so it can never collide with a
 *  leftover row or a real Telnyx number. `phone_numbers.e164` is globally
 *  unique and CHECK-constrained to `^\+[0-9]{8,15}$`. */
const numberE164 = `+1555${String(stamp).slice(-7)}`;
const callerE164 = `+1556${String(stamp).slice(-7)}`;

const summaryFacts = `Recorded: booking created, contact linked. Ref ${stamp}`;
const summaryProse =
  `El cliente llamó para agendar una revisión del techo y la cita quedó hecha. Ref ${stamp}`;

const CALLER_TURN = `Hola, necesito una cita para el techo. Ref ${stamp}`;
const ASSISTANT_TURN = `Claro que sí — le agendo mañana a las diez. Ref ${stamp}`;

/** Two turns, one per side: the transcript view renders caller left and
 *  assistant right, and one turn could never prove both. */
const TRANSCRIPT: TranscriptEvent[] = [
  { role: "caller", text: CALLER_TURN, at: new Date(stamp).toISOString() },
  { role: "assistant", text: ASSISTANT_TURN, at: new Date(stamp + 12_000).toISOString() },
];

let accountId = "";
let phoneNumberId = "";
let contactId = "";
let callId = "";

test.beforeAll(async () => {
  const f = fixture();
  accountId = f.accountId;
  const db = serviceDb();

  // This spec's own precondition, established rather than assumed — the same
  // beforeAll client-branding.spec.ts needs. "calls" sorts before
  // "client-access" today, which is the only reason the fixture's client
  // access happens to still be on when this runs; a spec that passes on
  // filename order proves nothing.
  await setClientAccess(db, accountId, true, f.clerkUserId);

  const number = await assignPhoneNumber(
    db, accountId, { e164: numberE164, status: "testing" }, "e2e-calls-spec",
  );
  phoneNumberId = number.id;

  const contact = await createContact(
    db, accountId, { firstName: callerFirstName, lastName: callerLastName }, "e2e-calls-spec",
  );
  contactId = contact.id;

  // `started_at` defaults to now(), which is what puts this row inside the
  // meter's UTC-day window below. Deliberately not overridden: the page counts
  // with the SAME `countCallsSince` + `utcDayStart` pair the incoming-call
  // webhook enforces its cap with, and back-dating the row would test a
  // different window than the one that actually declines calls.
  const started = await startCallRow(db, accountId, { phoneNumberId, callerE164 });
  callId = started.id;

  await finishCallRow(db, accountId, callId, {
    outcome: "booked",
    endedAt: new Date(),
    durationSecs: 222,
    turnCount: TRANSCRIPT.length,
    transcript: TRANSCRIPT,
    summary: `${summaryFacts}\n\n${summaryProse}`,
    language: "es",
    contactId,
  });
});

test.afterAll(async () => {
  const db = serviceDb();
  // FK-child-first, and every step independently checked. `calls` and
  // `phone_numbers` both reference `accounts` with ON DELETE RESTRICT
  // (migration 0019), so a row left behind here makes auth.teardown's account
  // delete fail — and that failure is only logged, so it would leak a real
  // Clerk user, a real org and real rows into the shared dev environment
  // silently. Errors are reported rather than thrown: cleanup must not become
  // a new way for the suite to go red.
  const deletes: [string, string, string][] = [
    ["calls", "id", callId],
    ["phone_numbers", "id", phoneNumberId],
    ["contacts", "id", contactId],
  ];
  for (const [table, column, value] of deletes) {
    if (!value) continue;
    const { error } = await db.from(table).delete().eq(column, value);
    if (error) console.error(`calls e2e cleanup: ${table} delete failed: ${error.message}`);
  }
});

test.describe("the Calls log, as the agency", () => {
  test("lists a finished call, and its detail carries the whole conversation", async ({ page }) => {
    const db = serviceDb();
    const base = `/dashboard/accounts/${accountId}`;

    await page.goto(`${base}/calls`);

    // --- The usage meter -------------------------------------------------
    // The cap comes from the same `readLimitConfig` the page reads, so a
    // machine with PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY set does not fail on a
    // hard-coded 50 — and a drift between the meter's denominator and the cap
    // that actually declines callers still would.
    const cap = readLimitConfig().perAccountPerDay;
    // Stated as a precondition, so the assertion below reads as "the meter
    // agrees with the database" rather than "the meter says what I typed".
    expect(
      await countCallsSince(db, accountId, utcDayStart(new Date())),
      "the fixture account should hold exactly the one call this spec seeded today",
    ).toBe(1);
    await expect(page.getByText(`1 of ${cap} calls today`)).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Daily call usage" }))
      .toHaveAttribute("aria-valuetext", `1 of ${cap} calls today`);

    // --- The row ---------------------------------------------------------
    const row = page.getByRole("row").filter({ hasText: callerName });
    await expect(row).toHaveCount(1);
    // The caller is the matched CONTACT's name, not the number they rang from
    // — `callerLabel`'s first branch, and the one that proves the embedded
    // `contact:contacts(...)` read survived RLS.
    await expect(row.getByRole("link", { name: callerName })).toBeVisible();
    await expect(row).toContainText("Booked");
    await expect(row).toContainText("3:42");

    // The language badge is stored lowercase and uppercased in CSS, so the
    // rendered text node is "es" while what a client actually reads is "ES".
    // Both are asserted: text alone would pass if the uppercase were dropped,
    // and this project has a standing lesson about measuring painted values.
    const languageBadge = row.getByText("es", { exact: true });
    await expect(languageBadge).toBeVisible();
    await expect(languageBadge).toHaveCSS("text-transform", "uppercase");

    // --- The detail ------------------------------------------------------
    // P4 Task 9 made whole-row click the only way into a call (CallRow's own
    // onClick -> router.push), matching the contacts table's own rule
    // (DESIGN.md #4); the timestamp cell and the mouse-only chevron are no
    // longer <a> elements at all, and the row's one remaining real link goes
    // to the CALLER's contact, not the call. Click a cell known to carry no
    // link of its own (duration, already asserted above) instead of an href
    // that no longer exists.
    await row.locator("td").nth(2).click();
    await expect(page).toHaveURL(new RegExp(`/calls/${callId}$`));

    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    // Both blocks `splitSummaryBlocks` produced: the fact line the SYSTEM
    // vouches for, and the model's prose. A page that rendered only the first
    // would still show a "Summary" heading.
    await expect(page.getByText(summaryFacts)).toBeVisible();
    await expect(page.getByText(summaryProse)).toBeVisible();

    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(page.getByText(CALLER_TURN)).toBeVisible();
    await expect(page.getByText(ASSISTANT_TURN)).toBeVisible();

    // --- And it goes somewhere -------------------------------------------
    await page.getByRole("link", { name: "View contact" }).click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${contactId}$`));
    // Content only the real detail screen has — a 404 on this route renders
    // not-found.tsx, which still "loads" and would satisfy the URL check
    // above. Same guard contact-detail.spec.ts uses, for the same reason.
    await expect(page.getByRole("heading", { name: callerName })).toBeVisible();
    await expect(page.getByText("Page not found")).toHaveCount(0);
  });
});

/**
 * The grant, through a real client session.
 *
 * Calls are the client's OWN business data — who rang and what the
 * receptionist did about it — not agency work about the client, which is why
 * `requireAccountAccess` gates the page rather than
 * `requireAgencyOnlyAccountAccess`. That decision is only worth anything if
 * the database agrees: `authenticated` needs SELECT on `calls` and the tenant
 * policy has to admit this account. Nothing below `dbForRequest()` can tell
 * us that, and no fixture-backed unit test can either.
 */
test.describe("the Calls log, as the client", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("sees their own call, and the nav offers it", async ({ page }) => {
    await page.goto(`/dashboard/accounts/${accountId}/calls`);

    // The positive case FIRST — the M2 lesson. Every absence check in this
    // suite's client specs once passed while the client's whole CRM was a 404.
    const row = page.getByRole("row").filter({ hasText: callerName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Booked");

    // Not the agency's own screen wearing a client session: Setup and Voice
    // are agency work about the client and must not be offered here, while
    // Calls — unlike them — must be.
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("link", { name: "Calls", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Setup", exact: true })).toHaveCount(0);
  });
});
