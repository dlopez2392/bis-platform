import { test, expect } from "./fixtures/test";
import type { Locator, Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, assignPhoneNumber, startCallRow, finishCallRow, insertProposal,
  listContactTasks, getVoiceProfile, type TranscriptEvent,
} from "@bis/db";
import { proposalExpiresAt } from "@bis/db/proposal-rules";
import { m, type MessageKey } from "../src/lib/messages";
import { clipFailure } from "./overflow-check";
import { readClientFixture, recordPage } from "./support";

// Same two paths, same reason, as every spec that seeds through the service client from the runner
// process (suggestions.spec.ts, calls.spec.ts, work-queue.spec.ts).
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Item 8b-2 (plan Task 8): the cards 8b-1 built, wherever a suggestion is read. suggestions.spec.ts proves
 * the DECISION path on one call; this file proves the new READING surfaces around it:
 *   1. the To do tray grouped by customer, then by call, newest group first, "No customer yet" among them;
 *   2. the record's "Waiting for you" (flat rows, ghost Accept and Discard, no Edit), its Accept writing
 *      the timeline row "accepted <persona>'s suggestion: Phone ..." under the person mark "You", and Undo
 *      taking both back;
 *   3. the agency Work page's per-account section, accepting for the fixture account;
 *   4. the transcript link ("See it in the transcript · 2:14") and its #turn-{raw index} target;
 *   5. Spanish on the record; 6. 360 px in the pseudo-locale.
 *
 * FIXTURE DISCIPLINE. Every write lands on the per-run CLIENT fixture account, never on `Test Client One`
 * or any live account; `readClientFixture()` skips the file with a reason when the fixture is missing.
 *
 * SESSION. The default chromium session is the agency admin (auth.setup.ts), the one identity that can
 * open both an account's pages and /dashboard/work, and the same `userId` Undo's compare-and-swap checks.
 *
 * STREAMED ROUTES. /tasks, /dashboard/work and the contact record each have a loading.tsx, so every
 * positive locator there is scoped to <main> (the record: `recordPage`, which is inside <main>), never
 * `page`: React's streamed reveal can park a hidden copy of the page outside <main> (support.ts's
 * RECORD_PAGE CONVENTION; suggestions.spec.ts met it in CI run 39283437434). The call page has no
 * loading.tsx in its segment chain; it is scoped to <main> anyway, for one rule. Toasts are portals and
 * every ABSENCE check (toHaveCount(0)) stays page-wide, the stricter reading.
 *
 * EXACT NAMES. Every role-name locator passes `exact: true`: "Accept" is a substring of "Edit and accept",
 * "Aceptar" of "Editar y aceptar".
 *
 * SEED. Two customers, A (no phone on file) and B, one call each, plus a third call with no customer.
 * Each call's transcript has an EMPTY turn at index 2 before the cited caller turn at index 3 (plan A1):
 * the transcript view drops the empty turn but keeps raw indices, so the card's #turn-3 must land on the
 * cited words, not on whatever sits third after filtering. Suggestions through `insertProposal` (the
 * generator's own helper) with `evidenceRef { turn: 3, at }`: A gets a phone and a to-do, B a to-do, the
 * third call a to-do with no customer. Serial: each test starts from the previous one's end state.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const stamp = Date.now();
const ACTOR = "e2e-suggestions-tray-spec";
const tail = String(stamp).slice(-7);
const numberE164 = `+1552${tail}`;
const callerE164 = `+1553${tail}`;
const nameA = { firstName: "E2E", lastName: `Tray A ${stamp}` };
const nameB = { firstName: "E2E", lastName: `Tray B ${stamp}` };
const displayA = `${nameA.firstName} ${nameA.lastName}`;
const displayB = `${nameB.firstName} ${nameB.lastName}`;
/** Ten digits the phone suggestion carries; asserted as the stored phone's tail, not its normalised prefix. */
const phoneDigits = `899${tail}`;
const phoneValue = `899 ${tail.slice(0, 3)} ${tail.slice(3)}`;
const titleA = `Send A the roof quote ${stamp}`;
const titleB = `Call B back about gutters ${stamp}`;
const titleNone = `Return the unknown caller ${stamp}`;
/** The cited caller turn, verbatim the suggestions' evidence, at raw index 3 of each transcript. */
const citedA = `My cell is ${phoneValue}, and please send the roof quote. Ref ${stamp}`;
const citedB = `Can someone call me back about the gutters? Ref ${stamp}`;
const citedNone = `I'll leave my name later, just call me back. Ref ${stamp}`;
/** The cited turn's offset from the call's start: the link reads "· 2:14". */
const CITED_OFFSET_MS = 134_000;

function transcript(startedAt: number, cited: string): TranscriptEvent[] {
  const at = (ms: number) => new Date(startedAt + ms).toISOString();
  return [
    { role: "assistant", text: `Thanks for calling. Ref ${stamp}`, at: at(1_000) },
    { role: "caller", text: `Hi, I have a question. Ref ${stamp}`, at: at(20_000) },
    // Empty: dropped by the transcript view, still counted by evidence_ref.turn (raw index).
    { role: "assistant", text: "", at: at(60_000) },
    { role: "caller", text: cited, at: at(CITED_OFFSET_MS) },
  ];
}

/** `m`'s own `.es` twin, with `{param}` substitution (suggestions.spec.ts's helper). */
function w(key: MessageKey, lang: "en" | "es" = "en", params: Record<string, string | number> = {}): string {
  const raw = (lang === "es" ? (m as Record<string, string>)[`${key}.es`] : undefined) ?? m[key];
  return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), raw);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let accountId = "";
let phoneNumberId = "";
let contactA = "";
let contactB = "";
let callA = "";
let callB = "";
let callNone = "";
let phoneA = "";
let todoA = "";
let todoB = "";
let todoNone = "";
let persona = "Sofía";
let brandName = "";

const tasksUrl = () => `/dashboard/accounts/${accountId}/tasks`;
const recordUrl = (id: string) => `/dashboard/accounts/${accountId}/contacts/${id}`;
const callUrl = (id: string) => `/dashboard/accounts/${accountId}/calls/${id}`;
const groupKey = (contactId: string | null, callId: string) => `${contactId ?? "none"}:call:${callId}`;
const main = (page: Page) => page.getByRole("main");
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
/** The record's "Waiting for you" section, inside the rendered record page. */
const waiting = (page: Page) => recordPage(page).locator("[data-waiting-suggestions]");

async function seedCall(contactId: string | null, cited: string): Promise<string> {
  const db = serviceDb();
  const { id } = await startCallRow(db, accountId, { phoneNumberId, callerE164 });
  const { data, error } = await db.from("calls").select("started_at").eq("account_id", accountId).eq("id", id).single();
  if (error || !data) throw new Error(`suggestions-tray e2e: call read failed: ${error?.message ?? "no row"}`);
  const startedAt = Date.parse((data as { started_at: string }).started_at);
  const turns = transcript(startedAt, cited);
  await finishCallRow(db, accountId, id, {
    outcome: "lead", endedAt: new Date(startedAt + 180_000), durationSecs: 180, turnCount: turns.length,
    transcript: turns, summary: `Recorded: a caller asked for help. Ref ${stamp}`, language: "en",
    ...(contactId ? { contactId } : {}),
  });
  return id;
}

async function seedSuggestion(
  callId: string, contactId: string | null, cited: string,
  body: { kind: "task"; payload: { title: string; dueAt: null } } | { kind: "contact_field"; payload: { field: "phone"; value: string } },
): Promise<string> {
  const db = serviceDb();
  const { data, error } = await db.from("calls").select("started_at").eq("account_id", accountId).eq("id", callId).single();
  if (error || !data) throw new Error(`suggestions-tray e2e: call re-read failed: ${error?.message ?? "no row"}`);
  const at = new Date(Date.parse((data as { started_at: string }).started_at) + CITED_OFFSET_MS).toISOString();
  const row = await insertProposal(db, accountId, {
    callId, contactId, evidence: cited, evidenceRef: { turn: 3, at }, evidenceLang: "en",
    expiresAt: proposalExpiresAt(new Date()), ...body,
  });
  if (!row) throw new Error(`suggestions-tray e2e: insertProposal refused a ${body.kind} — check 0088's CHECK constraints`);
  return row.id;
}

async function proposalStatus(id: string): Promise<string> {
  const { data, error } = await serviceDb()
    .from("proposals").select("status").eq("account_id", accountId).eq("id", id).single();
  if (error) throw new Error(`suggestions-tray e2e: proposal read failed: ${error.message}`);
  return (data as { status: string }).status;
}
async function phoneOf(contactId: string): Promise<string | null> {
  const { data, error } = await serviceDb()
    .from("contacts").select("phone").eq("account_id", accountId).eq("id", contactId).single();
  if (error) throw new Error(`suggestions-tray e2e: contact read failed: ${error.message}`);
  return (data as { phone: string | null }).phone;
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) {
    test.skip(true, "No client fixture — the setup project creates it; run the full suite.");
    return;
  }
  accountId = fixture.accountId;
  const db = serviceDb();

  // Read, not taken from the fixture file: another spec (client-branding) may have renamed the brand.
  const { data: account, error: accountErr } = await db.from("accounts").select("brand_name").eq("id", accountId).single();
  if (accountErr || !account) throw new Error(`suggestions-tray e2e: account read failed: ${accountErr?.message ?? "no row"}`);
  brandName = (account as { brand_name: string | null }).brand_name ?? "";
  if (!brandName) throw new Error("suggestions-tray e2e: the fixture account has no brand_name; the agency section would read 'unbranded'");
  // The record page's own persona read (lib/record/loaders.ts: getVoiceProfile, else "Sofía").
  persona = (await getVoiceProfile(db, accountId))?.persona_name?.trim() || "Sofía";

  phoneNumberId = (await assignPhoneNumber(db, accountId, { e164: numberE164, status: "testing" }, ACTOR)).id;
  contactA = (await createContact(db, accountId, nameA, ACTOR)).id;
  contactB = (await createContact(db, accountId, nameB, ACTOR)).id;

  // Oldest first, so the tray's newest-first group order is: no customer, B, A.
  callA = await seedCall(contactA, citedA);
  phoneA = await seedSuggestion(callA, contactA, citedA, { kind: "contact_field", payload: { field: "phone", value: phoneValue } });
  todoA = await seedSuggestion(callA, contactA, citedA, { kind: "task", payload: { title: titleA, dueAt: null } });
  callB = await seedCall(contactB, citedB);
  todoB = await seedSuggestion(callB, contactB, citedB, { kind: "task", payload: { title: titleB, dueAt: null } });
  callNone = await seedCall(null, citedNone);
  todoNone = await seedSuggestion(callNone, null, citedNone, { kind: "task", payload: { title: titleNone, dueAt: null } });
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  const step = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`suggestions-tray e2e cleanup: ${what} failed: ${error.message}`);
  };
  const calls = [callA, callB, callNone].filter(Boolean);
  const contacts = [contactA, contactB].filter(Boolean);
  const titles = [titleA, titleB, titleNone];
  // FK order: calls (cascading their proposals) before phone_numbers (restrict); tasks (an Accept's rows)
  // before contacts.
  if (calls.length) await step("calls", () => db.from("calls").delete().eq("account_id", accountId).in("id", calls));
  if (phoneNumberId) await step("phone_numbers", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", phoneNumberId));
  await step("tasks", () => db.from("tasks").delete().eq("account_id", accountId).in("title", titles));
  if (contacts.length) await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).in("id", contacts));

  // Re-read. A head count can come back {count: null, error: null} on failure, so null is reported, never 0.
  const count = async (table: string, q: () => PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q();
    if (error || n === null) console.error(`suggestions-tray e2e cleanup: ${table} re-read failed: ${error?.message ?? "null count"}`);
    else if (n !== 0) console.error(`suggestions-tray e2e cleanup: ${table} still holds ${n} row(s) for this spec's seed`);
  };
  const head = { count: "exact" as const, head: true };
  if (calls.length) {
    await count("calls", () => db.from("calls").select("id", head).eq("account_id", accountId).in("id", calls));
    await count("proposals", () => db.from("proposals").select("id", head).eq("account_id", accountId).in("call_id", calls));
  }
  if (phoneNumberId) await count("phone_numbers", () => db.from("phone_numbers").select("id", head).eq("account_id", accountId).eq("id", phoneNumberId));
  await count("tasks", () => db.from("tasks").select("id", head).eq("account_id", accountId).in("title", titles));
  if (contacts.length) await count("contacts", () => db.from("contacts").select("id", head).eq("account_id", accountId).in("id", contacts));
});

test("To do: grouped by customer and call, newest group first, each card under its own heading", async ({ page }) => {
  await page.goto(tasksUrl());
  const list = main(page).locator("[data-suggestion-list]");
  const mine = [groupKey(null, callNone), groupKey(contactB, callB), groupKey(contactA, callA)];
  const expected: Record<string, { name: string; cards: string[] }> = {
    [mine[0]!]: { name: w("suggestions.group.noCustomer"), cards: [todoNone] },
    [mine[1]!]: { name: displayB, cards: [todoB] },
    // Inside a group the read's order: newest first, so the to-do (inserted second) before the phone.
    [mine[2]!]: { name: displayA, cards: [todoA, phoneA] },
  };
  for (const key of mine) {
    const group = list.locator(`[data-suggestion-group="${key}"]`);
    await expect(group).toHaveCount(1);
    // "<name> · from the call on <day>": the day is the account zone's, so only its fixed prefix is pinned.
    const prefix = w("suggestions.group.call", "en", { name: expected[key]!.name, date: "" });
    await expect(group.locator("h3")).toHaveText(new RegExp(`^${escapeRe(prefix)}\\S`));
    expect(await group.locator("[data-suggestion]").evaluateAll((els) => els.map((e) => e.getAttribute("data-suggestion"))))
      .toEqual(expected[key]!.cards);
  }
  // Newest group first, read off the DOM; the fixture account may hold other pending rows, so only ours.
  const order = (await list.locator("[data-suggestion-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-suggestion-group"))))
    .filter((k): k is string => k !== null && mine.includes(k));
  expect(order).toEqual(mine);
});

test("the record's Waiting for you: A's two rows, no Edit; Accept the phone writes the timeline row, Undo takes it back", async ({ page }) => {
  await page.goto(recordUrl(contactA));
  const section = waiting(page);
  await expect(section.getByRole("heading", { name: w("suggestions.waiting.heading"), exact: true })).toBeVisible();
  // The loaded section replaced loading.tsx's two flat skeleton rows.
  await expect(page.locator("[data-waiting-skeleton]")).toHaveCount(0);
  expect(await section.locator("li[data-suggestion]").evaluateAll((els) => els.map((e) => e.getAttribute("data-suggestion"))))
    .toEqual([todoA, phoneA]);
  await expect(section.locator('li[data-suggestion][data-status="pending"]')).toHaveCount(2);
  // A flat row edits nowhere: editing happens in the tray (DESIGN.md rule 8 as amended).
  await expect(section.getByRole("button", { name: m["suggestions.editAccept"], exact: true })).toHaveCount(0);
  await expect(section.getByRole("link", { name: w("suggestions.waiting.seeAll"), exact: true })).toHaveAttribute("href", tasksUrl());

  const row = section.locator(`li[data-suggestion="${phoneA}"]`);
  const accept = row.getByRole("button", { name: m["suggestions.accept"], exact: true });
  await expect(accept).toHaveAttribute("data-suggestion-accept");
  expect(await phoneOf(contactA)).toBeNull();
  await accept.click();
  const saved = toast(page, w("suggestions.toast.field", "en", { field: w("suggestions.field.phone") }));
  await expect(saved).toBeVisible();
  // Decided, it leaves Waiting (pending only).
  await expect(page.locator(`[data-suggestion="${phoneA}"]`)).toHaveCount(0);

  // The timeline row: "accepted <persona>'s suggestion: Phone: (empty) → <value>", by the person mark "You".
  const verb = w("timeline.suggestion", "en", { persona, change: `${w("suggestions.field.phone")}:` });
  const item = recordPage(page).locator('[data-timeline-item="suggestion"]').filter({ hasText: verb });
  await expect(item).toHaveCount(1);
  await expect(item.locator('[data-author-mark="person"]')).toHaveText(w("provenance.you"));

  // The click, not the seed, wrote the phone: the stored form ends with the suggested ten digits.
  const stored = await phoneOf(contactA);
  expect(stored, "Accept must write the customer's phone").not.toBeNull();
  expect(stored!.replace(/\D/g, "").endsWith(phoneDigits)).toBe(true);
  expect(await proposalStatus(phoneA)).toBe("accepted");

  // Undo, inside the toast's 10-second window: the phone is blank again, the row is back, the timeline row gone.
  await saved.getByRole("button", { name: w("common.undo"), exact: true }).click();
  await expect(toast(page, w("suggestions.undone"))).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "pending");
  await expect(row.locator("[data-status-word]")).toHaveText(w("suggestions.status.pending"));
  await expect(page.locator('[data-timeline-item="suggestion"]').filter({ hasText: verb })).toHaveCount(0);
  expect(await proposalStatus(phoneA)).toBe("pending");
  expect(await phoneOf(contactA)).toBeNull();
});

test("the agency Work page: the fixture account's section by brand name, Accept B's to-do there", async ({ page }) => {
  await page.goto("/dashboard/work");
  const section = main(page).locator(`section[data-proposals] [data-suggestion-account="${accountId}"]`);
  await expect(section.getByRole("heading", { level: 3, name: brandName, exact: true })).toBeVisible();
  const group = section.locator(`[data-suggestion-group="${groupKey(contactB, callB)}"]`);
  // Under the account's <h3>, a group is an <h4>.
  await expect(group.locator("h4")).toHaveText(new RegExp(`^${escapeRe(w("suggestions.group.call", "en", { name: displayB, date: "" }))}\\S`));
  const cardB = group.locator(`[data-suggestion="${todoB}"]`);
  await expect(cardB).toHaveAttribute("data-status", "pending");

  await cardB.getByRole("button", { name: m["suggestions.accept"], exact: true }).click();
  await expect(toast(page, w("suggestions.toast.task"))).toBeVisible();
  await expect(page.locator(`[data-suggestion="${todoB}"]`)).toHaveCount(0);

  // Bound to THIS account: the row landed on the fixture account, on B, with the suggested title.
  const made = (await listContactTasks(serviceDb(), accountId, contactB)).filter((t) => t.title === titleB);
  expect(made, "Accept on the Work page must create B's to-do on the fixture account").toHaveLength(1);
  expect(await proposalStatus(todoB)).toBe("accepted");
  // The other customers' suggestions were not touched by it.
  expect(await proposalStatus(todoA)).toBe("pending");
  expect(await proposalStatus(todoNone)).toBe("pending");
});

test("the transcript link: '· 2:14' to #turn-3, and #turn-3 on the call page holds the cited words", async ({ page }) => {
  await page.goto(tasksUrl());
  const phoneCard = main(page).locator(`[data-suggestion="${phoneA}"]`);
  const link = phoneCard.locator("[data-transcript-link]");
  await expect(link).toHaveText(w("suggestions.transcript", "en", { time: "2:14" }));
  await expect(link).toHaveAttribute("href", `${callUrl(callA)}#turn-3`);

  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRe(callUrl(callA))}#turn-3$`));
  const turn = main(page).locator("li#turn-3");
  await expect(turn).toContainText(citedA);
  await expect(turn).toBeInViewport();
  // Raw indices: the empty turn 2 is dropped from the page, and nothing else took its number.
  await expect(page.locator("#turn-2")).toHaveCount(0);
  await expect(main(page).locator("li#turn-1")).toHaveCount(1);
  // On the call page itself the same card's link is the turn's own anchor.
  await expect(main(page).locator(`[data-suggestion="${phoneA}"] [data-transcript-link]`)).toHaveAttribute("href", "#turn-3");
});

test("the record in Spanish: Esperan su respuesta, Aceptar, and the English evidence keeps lang=en", async ({ page }) => {
  await page.goto(`${recordUrl(contactA)}?locale=es`);
  const section = waiting(page);
  await expect(section).toHaveAttribute("lang", "es");
  await expect(section.getByRole("heading", { name: w("suggestions.waiting.heading", "es"), exact: true })).toBeVisible();
  const row = section.locator(`li[data-suggestion="${phoneA}"]`);
  await expect(row.getByRole("button", { name: w("suggestions.accept", "es"), exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: w("suggestions.discard", "es"), exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: w("suggestions.editAccept", "es"), exact: true })).toHaveCount(0);
  await expect(row.locator("q").filter({ hasText: citedA })).toHaveAttribute("lang", "en");
  await expect(section.getByRole("link", { name: w("suggestions.waiting.seeAll", "es"), exact: true })).toBeVisible();
});

test("at 360 px in the pseudo-locale, nothing inside Waiting for you or a tray group overflows", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  const noOverflow = async (el: Locator, what: string) => {
    await expect(el).toBeVisible();
    // A screen-reader-only run is clipped to 1px by design (suggestions.spec.ts, 29d9e51d): not visible overflow.
    const sizes = await el.evaluate((root) => [root, ...root.querySelectorAll("*")]
      .filter((n) => !n.closest(".sr-only"))
      .map((n) => ({ tag: n.tagName.toLowerCase(), sw: (n as HTMLElement).scrollWidth, cw: (n as HTMLElement).clientWidth })));
    // One pixel of sub-pixel rounding allowed, as suggestions.spec.ts allows.
    const failures = sizes.map((s) => clipFailure(s.sw, s.cw + 1, `${what} <${s.tag}>`)).filter((f): f is string => f !== null);
    expect(failures, `${what} overflows at 360px in the pseudo-locale`).toEqual([]);
  };
  await page.goto(`${recordUrl(contactA)}?locale=pseudo`);
  await noOverflow(waiting(page), "Waiting for you");
  await page.goto(`${tasksUrl()}?locale=pseudo`);
  await noOverflow(main(page).locator(`[data-suggestion-group="${groupKey(contactA, callA)}"]`), "the tray group for A");
});
