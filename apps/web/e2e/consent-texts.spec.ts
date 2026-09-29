import { test, expect } from "@playwright/test";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { m } from "../src/lib/messages";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Consent chain PR-2 end to end (spec §8's e2e list, as plan G15 adjusts it):
 *   1. a signed inbound STOP that Telnyx answered stops the contact; the
 *      drawer says so and offers no Resume (choice 19);
 *   2. staff Stop texts runs at once with Undo, and keeps focus in the row
 *      (R3-M9); Resume's submit stays disabled with an empty note (task-12
 *      fix round 1 #4 — see the note by that assertion below) and resumes
 *      once one is written;
 *   3. a stop sentence holds texts and makes a To-do; "Not a stop" on the To-do
 *      lifts the hold and closes it.
 * NOT here (plan G15): BIS's own confirmation text. The fixture account has no
 * approved A2P registration, so the gate refuses every send there; the
 * one-confirmation rule is proven by the route's signed-fixture tests
 * (route.consent.test.ts).
 *
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY, never Test Client One (CLAUDE.md). Its
 * own contacts and its own phone_numbers row, deleted in afterAll; the
 * ledger rows stay (append-only) until the fixture account is swept.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

type ClientFixture = { accountId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};

// The fixed test key (Task 15, Step 1). Its public half MUST equal ci.yml's
// e2e job literal (TELNYX_PUBLIC_KEY) — computed once by running the node
// one-liner in the plan's Task 15, never re-derived here.
const PRIVATE = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from("5eed".repeat(16), "hex")]),
  format: "der", type: "pkcs8",
});
const PUBLIC_RAW = createPublicKey(PRIVATE).export({ format: "der", type: "spki" }).subarray(12).toString("base64");

const ACTOR = "e2e-consent-texts";
const STAMP = Date.now().toString();
const four = () => String(Math.floor(Math.random() * 9000) + 1000);
// 956-292 is a McAllen exchange, valid as a US number only (PR-1's E1), so
// none of these reads as "could be Mexican" and the row is not Check number.
// Immaterial in practice too: every number here already carries a leading
// "+", and normalisePhone (packages/db/src/phone.ts) keeps any "+" number
// as given (rule 1) without judging US/MX validity at all — but the McAllen
// fact is why a bare-digits version of the same exchange would ALSO be safe.
const OUR_NUMBER = `+1956555${four()}`;
const STOPPER = `+1956292${four()}`;
const STAFF = `+1956292${four()}`;
const HOLDER = `+1956292${four()}`;
const made: { contacts: string[]; numberId: string | null } = { contacts: [], numberId: null };

function signedHeaders(raw: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    "content-type": "application/json",
    "telnyx-timestamp": ts,
    "telnyx-signature-ed25519": sign(null, Buffer.from(`${ts}|${raw}`, "utf8"), PRIVATE).toString("base64"),
  };
}
const inbound = (from: string, text: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  data: { event_type: "message.received", payload: {
    id: `e2e-${STAMP}-${Math.random().toString(36).slice(2, 8)}`, to: [{ phone_number: OUR_NUMBER }],
    from: { phone_number: from }, text, messaging_profile_id: "e2e-profile", ...extra,
  } },
});

test.beforeAll(async () => {
  if (process.env.TELNYX_PUBLIC_KEY !== PUBLIC_RAW) {
    // In CI the literal is set (ci.yml), so a mismatch is a real failure. A
    // local run holds the real public key (or none): skip there, loudly,
    // rather than fail every local e2e run (review R3-m4; billing.spec.ts's
    // own precedent, :123-124).
    const why = "TELNYX_PUBLIC_KEY is not this spec's test key: set ci.yml's e2e literal from the command in plan Task 15";
    if (process.env.CI) throw new Error(why);
    console.warn(`::warning title=consent-texts.spec.ts skipped::${why}`);
    test.skip(true, why);
  }
  const { accountId } = fixture();
  const db = serviceDb();
  const { data, error } = await db.from("phone_numbers")
    .insert({ account_id: accountId, e164: OUR_NUMBER, status: "testing" }).select("id").single();
  if (error || !data) throw new Error(`consent-texts e2e: number insert failed: ${error?.message}`);
  made.numberId = (data as { id: string }).id;
  for (const [first, phone] of [["Stopper", STOPPER], ["Staff", STAFF], ["Holder", HOLDER]] as const) {
    made.contacts.push((await createContact(db, accountId, { firstName: first, lastName: STAMP, phone }, ACTOR)).id);
  }
});

test.afterAll(async () => {
  const db = serviceDb();
  // whole-branch review m2: `conversations.contact_id` and `messages.conversation_id` both
  // carry a plain FK with no ON DELETE action (0005_messaging.sql:14,33), unlike `tasks.contact_id`
  // (ON DELETE CASCADE, 0003_crm_core.sql:109) — so a contact delete alone fails on
  // conversations_contact_id_fkey the moment an inbound text (this spec's Stopper and Holder
  // cases) has given the contact a conversation. Delete this spec's OWN messages, then its OWN
  // conversations, then its OWN contacts — every delete scoped to made.contacts, never a wide
  // delete on either table.
  if (made.contacts.length > 0) {
    const { data: convos, error: convReadErr } = await db.from("conversations")
      .select("id").in("contact_id", made.contacts);
    if (convReadErr) {
      console.error(`consent-texts e2e: conversation lookup failed (the fixture sweep takes it): ${convReadErr.message}`);
    } else {
      const convoIds = (convos ?? []).map((c) => (c as { id: string }).id);
      if (convoIds.length > 0) {
        const { error: msgErr } = await db.from("messages").delete().in("conversation_id", convoIds);
        if (msgErr) console.error(`consent-texts e2e: message cleanup failed (the fixture sweep takes it): ${msgErr.message}`);
        const { error: convDelErr } = await db.from("conversations").delete().in("id", convoIds);
        if (convDelErr) console.error(`consent-texts e2e: conversation cleanup failed (the fixture sweep takes it): ${convDelErr.message}`);
      }
    }
  }
  for (const id of made.contacts) {
    const { error } = await db.from("contacts").delete().eq("id", id);
    if (error) console.error(`consent-texts e2e: contact cleanup failed (the fixture sweep takes it): ${error.message}`);
  }
  if (made.numberId) {
    const { error } = await db.from("phone_numbers").delete().eq("id", made.numberId);
    if (error) console.error(`consent-texts e2e: number cleanup failed: ${error.message}`);
  }
});

async function openDrawer(page: import("@playwright/test").Page, first: string) {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `${first} ${STAMP}` }).first().click();
  return page.getByRole("dialog").getByTestId("texts-row");
}

test("a signed STOP that Telnyx answered stops the contact: the drawer says so, and staff cannot resume it", async ({ page, request }) => {
  const raw = inbound(STOPPER, "STOP", { autoresponse_type: "STOP" });
  const res = await request.post("/api/sms/inbound", { headers: signedHeaders(raw), data: raw });
  expect(res.status()).toBe(200);
  const row = await openDrawer(page, "Stopper");
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(row).toContainText(m["contact.texts.stopped"]);
  await expect(row).toContainText("they texted STOP");
  await expect(row).toContainText(m["contact.texts.customerOnly"]);
  await expect(row.getByRole("button", { name: m["contact.texts.resume"] })).toHaveCount(0);
});

test("staff Stop texts runs at once with Undo and keeps focus in the row; Resume's submit stays disabled with no note, and resumes once one is written", async ({ page }) => {
  const row = await openDrawer(page, "Staff");
  await expect(row).toHaveAttribute("data-state", "allowed");
  await row.getByRole("button", { name: m["contact.texts.stopTexts"] }).click();
  const toast = page.getByText(m["contact.texts.stoppedToast"]);
  await expect(toast).toBeVisible();
  await toast.hover();   // pauses Sonner's timer (PR-1's R3-M5 note); pointer events reach it since #151
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(row).toContainText(m["contact.texts.how.staff"]);
  await expect(page.getByTestId("texts-row-status")).toBeFocused();   // R3-M9
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(row).toHaveAttribute("data-state", "allowed");

  await row.getByRole("button", { name: m["contact.texts.stopTexts"] }).click();
  await expect(row).toHaveAttribute("data-state", "stopped");
  // Review R3-I4: opening the form puts the keyboard in the note; Cancel hands it back to the status.
  await row.getByRole("button", { name: m["contact.texts.resume"] }).click();
  await expect(row.getByLabel(m["contact.texts.resumeNoteLabel"])).toBeFocused();
  await row.getByRole("button", { name: m["contact.texts.resumeCancel"] }).click();
  await expect(page.getByTestId("texts-row-status")).toBeFocused();

  await row.getByRole("button", { name: m["contact.texts.resume"] }).click();
  const submit = row.getByRole("button", { name: m["contact.texts.resumeSubmit"] });
  // NOT the brief's literal "click submit blank, see resumeNoteRequired":
  // task-12-report.md's Fix round 1 #4 (confirmed in texts-row.tsx, the
  // Resume form's submit Button) disables the submit itself while the note
  // is blank (`disabled={pending || !note.trim()}`), pinned in that task's
  // own texts-row.note.wiring.test.ts probes 4a/4b. A disabled button is not
  // actionable, so Playwright's own click() would hang waiting for it to
  // become enabled rather than ever firing the submit handler — the server's
  // `resumeNoteRequired` refusal (staff-actions.ts's own `!text` check) is
  // reached only if that guard is ever bypassed, which is not this suite's
  // job to force. This proves the guard itself, end to end, instead.
  await expect(submit).toBeDisabled();
  await expect(row).toHaveAttribute("data-state", "stopped");
  await row.getByLabel(m["contact.texts.resumeNoteLabel"]).fill("Asked on the phone for texts again");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(row).toHaveAttribute("data-state", "allowed");
});

test("a stop sentence holds texts and makes a To-do; Not a stop on the To-do lifts the hold and closes it", async ({ page, request }) => {
  const raw = inbound(HOLDER, "please stop texting me");
  const res = await request.post("/api/sms/inbound", { headers: signedHeaders(raw), data: raw });
  expect(res.status()).toBe(200);
  const row = await openDrawer(page, "Holder");
  await expect(row).toHaveAttribute("data-state", "held");
  await expect(row).toContainText("please stop texting me");

  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/tasks`);
  const todo = page.getByRole("listitem").filter({ hasText: "may have asked to stop texts" }).filter({ hasText: "please stop texting me" });
  await expect(todo).toHaveCount(1);
  await todo.getByRole("button", { name: m["contact.texts.notAStop"] }).click();
  await expect(page.getByText(m["contact.texts.releasedToast"])).toBeVisible();
  await expect(todo).toHaveCount(0);

  const after = await openDrawer(page, "Holder");
  await expect(after).toHaveAttribute("data-state", "allowed");
});
