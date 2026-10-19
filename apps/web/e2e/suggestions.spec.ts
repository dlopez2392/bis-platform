import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, assignPhoneNumber, startCallRow, finishCallRow,
  insertProposal, ensureDefaultPipeline, createOpportunity, listContactTasks,
  type TranscriptEvent,
} from "@bis/db";
import { proposalExpiresAt } from "@bis/db/proposal-rules";
import { m, type MessageKey } from "../src/lib/messages";
import { readClientFixture } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request (calls.spec.ts, work-queue.spec.ts,
// record-summary.spec.ts).
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Item 8b-1 (spec 8.4): the e2e proof that a suggestion card changes nothing until a human clicks — and
 * only that. There is no jsdom in this repo (plan Global Constraints), so this is the ONLY place the
 * card's effect behaviour (the toast, its 10-second Undo, focus following the edit, the refused-then-
 * saved phone, the Spanish reader) is proven against a real browser and a real database.
 *
 * FIXTURE DISCIPLINE. Every write here lands on the per-run CLIENT fixture account (auth.setup.ts /
 * auth.teardown.ts) and NEVER on `Test Client One` (a real account with a real report recipient) or any
 * other live account. `readClientFixture()` skips the whole file with a clear reason when the fixture
 * is missing (a filtered run that bypassed the `setup` project) — the same guard every other mutating
 * spec in this suite uses.
 *
 * SESSION. No `test.use` override: the default chromium project session (`e2e/.auth/state.json`) is the
 * agency admin `auth.setup.ts` signs in as. `requireAccountAccess` admits the agency for any account, so
 * this session both seeds through the service client AND decides through the UI as the same `userId`
 * Undo's compare-and-swap checks (`decidedBy === userId`) — the same session `calls.spec.ts`'s "as the
 * agency" block reads the SAME route with.
 *
 * SEED. One call (outcome "lead", a two-language transcript) and three suggestions, inserted directly
 * through `insertProposal` — the SAME `@bis/db` helper the generator calls — deliberately bypassing the
 * (separately tested) generator itself: this file's job is the DECISION path, not the model pass that
 * would normally produce these rows. A to-do with no due date (English evidence), a phone (Spanish
 * evidence — `evidenceLang: "es"`, a Spanish caller turn) and a stage move from stage 0 ("New Lead") to
 * stage 2 ("Appointment") on a 5-stage pipeline `ensureDefaultPipeline` makes.
 *
 * ONE run through the three cards, in order: tests share the seed (test.describe.configure("serial")) so
 * each test's starting state is the previous test's ending state (Accept → Undo; Edit and accept refused
 * then saved; Discard → Undo; the call page; Spanish; 360 px pseudo).
 *
 * TWO SURFACES, TWO BEHAVIOURS (final review I-1, and CI run 39267488188). The To do tray lists PENDING
 * suggestions only and a decision revalidates it, so a decided card LEAVES the tray (and Undo brings it
 * back); its status after a decision is read on the call page, which lists every status in place. After
 * test 2 the phone card is edited, so the Spanish and 360 px tests read it on the call page.
 *
 * EXACT NAMES. Every role-name locator passes `exact: true`: Playwright matches a name as a substring by
 * default, so "Accept" also matched "Edit and accept" (the strict-mode failure in that CI run), and
 * "Aceptar" would match "Editar y aceptar".
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const stamp = Date.now();
const ACTOR = "e2e-suggestions-spec";
const callerFirstName = "E2E";
const callerLastName = `Suggestion ${stamp}`;
const numberE164 = `+1558${String(stamp).slice(-7)}`;
const callerE164 = `+1559${String(stamp).slice(-7)}`;
const taskTitle = `Call back about the quote ${stamp}`;

// The evidence IS this exact string: seeded verbatim into the transcript as the caller's own turn, then
// seeded again, verbatim, as the matching proposal's `evidence` — proving "shown as the caller's own
// words" means this literal span reached the screen, not a paraphrase of it. Same discipline as the
// deleted call-proposals.spec.ts.
const CALLER_TURN_EN = `Can you add a to-do to call back about the quote? Ref ${stamp}`;
const ASSISTANT_TURN_1 = `Of course — I'll note that down. Ref ${stamp}`;
// A real Spanish sentence a caller could say, not a machine paraphrase of the English one: the Spanish
// reader test asserts THIS text's own `lang="es"` on the evidence <q>.
const CALLER_TURN_ES = `Mi número de teléfono es 899 000 0000. Ref ${stamp}`;
const ASSISTANT_TURN_2 = `Gracias, anoto el número. Ref ${stamp}`;

const TRANSCRIPT: TranscriptEvent[] = [
  { role: "caller", text: CALLER_TURN_EN, at: new Date(stamp).toISOString() },
  { role: "assistant", text: ASSISTANT_TURN_1, at: new Date(stamp + 5_000).toISOString() },
  { role: "caller", text: CALLER_TURN_ES, at: new Date(stamp + 10_000).toISOString() },
  { role: "assistant", text: ASSISTANT_TURN_2, at: new Date(stamp + 15_000).toISOString() },
];

/** `m`'s own `.es` twin, with `{param}` substitution — same tiny helper record-summary.spec.ts uses. */
function w(key: MessageKey, lang: "en" | "es" = "en", params: Record<string, string | number> = {}): string {
  const raw = (lang === "es" ? (m as Record<string, string>)[`${key}.es`] : undefined) ?? m[key];
  return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), raw);
}

let accountId = "";
let phoneNumberId = "";
let contactId = "";
let callId = "";
let opportunityId = "";
let stage0Id = "";
let stage2Id = "";
let stage2Name = "";
let taskProposalId = "";
let phoneProposalId = "";
let stageProposalId = "";
/** Set once the to-do's Accept creates a real row; cleared on Undo. Read by afterAll's defensive sweep. */
let liveTaskId: string | null = null;

const tasksUrl = () => `/dashboard/accounts/${accountId}/tasks`;

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) {
    test.skip(true, "No client fixture — the setup project creates it; run the full suite.");
    return;
  }
  accountId = fixture.accountId;
  const db = serviceDb();

  const number = await assignPhoneNumber(
    db, accountId, { e164: numberE164, status: "testing" }, "e2e-suggestions-spec",
  );
  phoneNumberId = number.id;

  const contact = await createContact(
    db, accountId, { firstName: callerFirstName, lastName: callerLastName }, "e2e-suggestions-spec",
  );
  contactId = contact.id;

  const { pipelineId } = await ensureDefaultPipeline(db, accountId);
  const { data: stages, error: stagesErr } = await db.from("pipeline_stages")
    .select("id, name, position").eq("account_id", accountId).eq("pipeline_id", pipelineId).order("position");
  if (stagesErr || !stages || stages.length < 4) {
    throw new Error(`suggestions e2e: expected >=4 pipeline stages, got ${stages?.length ?? 0} (${stagesErr?.message ?? "no error"})`);
  }
  stage0Id = (stages[0] as { id: string }).id;
  stage2Id = (stages[2] as { id: string }).id;
  stage2Name = (stages[2] as { name: string }).name;

  const opp = await createOpportunity(
    db, accountId, { contactId, pipelineId, name: `Deal ${stamp}` }, ACTOR,
  );
  opportunityId = opp.id;

  const started = await startCallRow(db, accountId, { phoneNumberId, callerE164 });
  callId = started.id;

  await finishCallRow(db, accountId, callId, {
    outcome: "lead", endedAt: new Date(), durationSecs: 110, turnCount: TRANSCRIPT.length,
    transcript: TRANSCRIPT, summary: `Recorded: caller asked for a callback and gave a number. Ref ${stamp}`,
    language: "en", contactId,
  });

  const now = new Date();
  const taskProposal = await insertProposal(db, accountId, {
    callId, contactId, evidence: CALLER_TURN_EN, evidenceRef: {}, evidenceLang: "en",
    expiresAt: proposalExpiresAt(now), kind: "task", payload: { title: taskTitle, dueAt: null },
  });
  const phoneProposal = await insertProposal(db, accountId, {
    callId, contactId, evidence: CALLER_TURN_ES, evidenceRef: {}, evidenceLang: "es",
    expiresAt: proposalExpiresAt(now), kind: "contact_field", payload: { field: "phone", value: "899 000 0000" },
  });
  const stageProposal = await insertProposal(db, accountId, {
    callId, contactId, evidence: CALLER_TURN_EN, evidenceRef: {}, evidenceLang: "en",
    expiresAt: proposalExpiresAt(now), kind: "opportunity_stage",
    payload: { opportunityId, fromStageId: stage0Id, toStageId: stage2Id },
  });
  if (!taskProposal || !phoneProposal || !stageProposal) {
    throw new Error("suggestions e2e: insertProposal returned null — check 0088's CHECK constraints against this seed");
  }
  taskProposalId = taskProposal.id;
  phoneProposalId = phoneProposal.id;
  stageProposalId = stageProposal.id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  const step = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`suggestions e2e cleanup: ${what} failed: ${error.message}`);
  };
  // FK order: calls (cascades its proposals, 0088's call_id FK) before phone_numbers (calls -> phone_numbers
  // restrict); opportunities before contacts (opportunities.contact_id carries no cascade, the default
  // restrict blocks deleting a contact with an open deal); tasks is a defensive sweep by title in case
  // Undo in the first test did not run or did not land (deleting the contact would otherwise cascade it,
  // but by then the contact delete has already been attempted below).
  if (callId) await step("calls", () => db.from("calls").delete().eq("account_id", accountId).eq("id", callId));
  if (phoneNumberId) await step("phone_numbers", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", phoneNumberId));
  await step("tasks (defensive)", () => db.from("tasks").delete().eq("account_id", accountId).eq("title", taskTitle));
  if (opportunityId) await step("opportunities", () => db.from("opportunities").delete().eq("account_id", accountId).eq("id", opportunityId));
  if (contactId) await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).eq("id", contactId));

  // Re-read to prove each is gone (record-summary.spec.ts's own cleanup discipline).
  const checks: Array<[string, () => Promise<number>]> = [
    ["calls", async () => (await db.from("calls").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("id", callId)).count ?? -1],
    ["proposals", async () => (await db.from("proposals").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("call_id", callId)).count ?? -1],
    ["tasks", async () => (await db.from("tasks").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("title", taskTitle)).count ?? -1],
    ["opportunities", async () => (await db.from("opportunities").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("id", opportunityId)).count ?? -1],
    ["contacts", async () => (await db.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("id", contactId)).count ?? -1],
  ];
  for (const [table, count] of checks) {
    const n = callId || table !== "calls" ? await count() : 0;
    if (n !== 0) console.error(`suggestions e2e cleanup: ${table} still holds ${n} row(s) for this spec's seed`);
  }
});

function card(page: import("@playwright/test").Page, id: string) {
  return page.locator(`[data-suggestion="${id}"]`);
}
const callUrl = () => `/dashboard/accounts/${accountId}/calls/${callId}`;
/** The call page's Suggestions section: labelled by its #call-proposals heading (the agency links' anchor). */
const callSection = (page: import("@playwright/test").Page) => page.locator('section[aria-labelledby="call-proposals"]');
async function dealStage(): Promise<string> {
  const { data, error } = await serviceDb()
    .from("opportunities").select("stage_id").eq("account_id", accountId).eq("id", opportunityId).single();
  if (error) throw new Error(`suggestions e2e: deal read failed: ${error.message}`);
  return (data as { stage_id: string }).stage_id;
}
async function proposalStatus(id: string): Promise<string> {
  const { data, error } = await serviceDb()
    .from("proposals").select("status").eq("account_id", accountId).eq("id", id).single();
  if (error) throw new Error(`suggestions e2e: proposal read failed: ${error.message}`);
  return (data as { status: string }).status;
}

test("Accept the to-do, then Undo from the toast", async ({ page }) => {
  await page.goto(tasksUrl());
  const taskCard = card(page, taskProposalId);
  await expect(taskCard).toBeVisible();
  await expect(taskCard).toHaveAttribute("data-status", "pending");

  await taskCard.getByRole("button", { name: m["suggestions.accept"], exact: true }).click();
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: w("suggestions.toast.task") });
  await expect(toast).toBeVisible();
  // Decided, it leaves the tray (pending only); its status is the call page's to show (test 4).
  await expect(taskCard).toHaveCount(0);

  // The click, not the seed, made this row (the seed made no task at all): the containment this file
  // exists to prove.
  const after = await listContactTasks(serviceDb(), accountId, contactId);
  const made = after.find((t) => t.title === taskTitle);
  expect(made, "Accept must create a real tasks row with this exact title").toBeTruthy();
  liveTaskId = made!.id;
  expect(made!.due_at).toBeNull();
  expect(await proposalStatus(taskProposalId)).toBe("accepted");

  // Undo, within the toast's 10-second window.
  await toast.getByRole("button", { name: w("common.undo"), exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: w("suggestions.undone") })).toBeVisible();

  const afterUndo = await listContactTasks(serviceDb(), accountId, contactId);
  expect(afterUndo.some((t) => t.id === liveTaskId), "Undo must delete the row Accept created").toBe(false);
  liveTaskId = null;

  // Pending again, it is back in the tray.
  await expect(taskCard).toHaveAttribute("data-status", "pending");
  await expect(taskCard.locator("[data-status-word]")).toHaveText(w("suggestions.status.pending"));
});

test("Edit and accept the phone: Esc cancels, a bad value is refused, a good one is saved", async ({ page }) => {
  await page.goto(tasksUrl());
  const phoneCard = card(page, phoneProposalId);
  await expect(phoneCard).toBeVisible();
  const editButton = phoneCard.getByRole("button", { name: m["suggestions.editAccept"], exact: true });
  const valueField = phoneCard.locator('input[name="value"]');

  // Esc in the field cancels the edit and hands focus back to Edit and accept (design review minor 6).
  await editButton.click();
  await expect(valueField).toBeFocused(); // focus follows the edit into the first field
  await valueField.press("Escape");
  await expect(valueField).toHaveCount(0);
  await expect(editButton).toBeFocused();

  await editButton.click();
  await expect(valueField).toBeFocused();
  await valueField.fill("abc");
  await phoneCard.getByRole("button", { name: m["suggestions.saveAccept"], exact: true }).click();
  await expect(phoneCard.getByText(w("suggestions.edit.phoneInvalid"))).toBeVisible();

  const { data: stillBlank, error: blankErr } = await serviceDb()
    .from("contacts").select("phone").eq("account_id", accountId).eq("id", contactId).single();
  if (blankErr) throw new Error(`suggestions e2e: contact read failed: ${blankErr.message}`);
  expect((stillBlank as { phone: string | null }).phone).toBeNull();

  // A number different from the suggested 899 000 0000: an edit that changes nothing is recorded as
  // accepted, not edited (the orchestrator ruling in Task 5), so it would not prove the edited path.
  await valueField.fill("899 000 1111");
  await phoneCard.getByRole("button", { name: m["suggestions.saveAccept"], exact: true }).click();
  // Edited, it leaves the tray; focus goes to the next card's Accept, never to <body> (design review
  // minor 5). The tray is newest first: stage, phone, to-do; the card after the phone is the to-do.
  await expect(phoneCard).toHaveCount(0);
  await expect(card(page, taskProposalId).getByRole("button", { name: m["suggestions.accept"], exact: true })).toBeFocused();
  expect(await proposalStatus(phoneProposalId)).toBe("edited");

  const { data: saved, error: savedErr } = await serviceDb()
    .from("contacts").select("phone").eq("account_id", accountId).eq("id", contactId).single();
  if (savedErr) throw new Error(`suggestions e2e: contact re-read failed: ${savedErr.message}`);
  // What "899 000 1111" normalises to (packages/db's phoneFields, under its own tests) — typed out, not
  // computed here from the function under test.
  expect((saved as { phone: string | null }).phone).toBe("+528990001111");
});

test("Discard the stage move, then Undo", async ({ page }) => {
  await page.goto(tasksUrl());
  const stageCard = card(page, stageProposalId);
  await expect(stageCard).toBeVisible();

  await stageCard.getByRole("button", { name: m["suggestions.discard"], exact: true }).click();
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: w("suggestions.toast.dismissed") });
  await expect(toast).toBeVisible();
  await expect(stageCard).toHaveCount(0);
  expect(await proposalStatus(stageProposalId)).toBe("dismissed");
  expect(await dealStage()).toBe(stage0Id);

  await toast.getByRole("button", { name: w("common.undo"), exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: w("suggestions.undone") })).toBeVisible();
  await expect(stageCard).toHaveAttribute("data-status", "pending");
  await expect(stageCard.locator("[data-status-word]")).toHaveText(w("suggestions.status.pending"));
  expect(await proposalStatus(stageProposalId)).toBe("pending");
  expect(await dealStage()).toBe(stage0Id);
});

// Final review I-1: the call page's own section (calls/[callId]/page.tsx: listProposalsForCall,
// readSuggestionStages, listPeopleNames, pending first), never visited by tests 1-3.
test("the call page: every suggestion in its #call-proposals section, pending first; Accept and Undo in place", async ({ page }) => {
  await page.goto(callUrl());
  await expect(page.locator("#call-proposals")).toBeVisible();
  const section = callSection(page);
  for (const id of [taskProposalId, phoneProposalId, stageProposalId]) {
    await expect(section.locator(`[data-suggestion="${id}"]`)).toHaveCount(1);
  }
  // Pending first (the two still pending: the stage move, newest, then the to-do), then the edited phone.
  expect(await section.locator("[data-suggestion]").evaluateAll((els) => els.map((e) => e.getAttribute("data-suggestion"))))
    .toEqual([stageProposalId, taskProposalId, phoneProposalId]);
  await expect(card(page, phoneProposalId).locator("[data-status-word]")).toHaveText(w("suggestions.status.edited"));

  // Accept the stage move here: on this page the card stays, decided, and its status line takes focus.
  const stageCard = section.locator(`[data-suggestion="${stageProposalId}"]`);
  await stageCard.getByRole("button", { name: m["suggestions.accept"], exact: true }).click();
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: w("suggestions.toast.stage", "en", { stage: stage2Name }) });
  await expect(toast).toBeVisible();
  await expect(stageCard).toHaveAttribute("data-status", "accepted");
  await expect(stageCard.locator("[data-status-word]")).toHaveText(w("suggestions.status.accepted"));
  await expect(stageCard.locator("[data-status-line]")).toBeFocused();
  expect(await dealStage()).toBe(stage2Id);
  expect(await proposalStatus(stageProposalId)).toBe("accepted");

  await toast.getByRole("button", { name: w("common.undo"), exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: w("suggestions.undone") })).toBeVisible();
  await expect(stageCard).toHaveAttribute("data-status", "pending");
  expect(await dealStage()).toBe(stage0Id);
  expect(await proposalStatus(stageProposalId)).toBe("pending");
});

test("the reader in Spanish", async ({ page }) => {
  await page.goto(`${tasksUrl()}?locale=es`);

  await expect(page.getByRole("heading", { name: w("suggestions.heading", "es"), exact: true })).toBeVisible();

  const taskCard = card(page, taskProposalId);
  await expect(taskCard.getByRole("button", { name: w("suggestions.accept", "es"), exact: true })).toBeVisible();
  await expect(taskCard.locator("[data-status-word]")).toHaveText(w("suggestions.status.pending", "es"));
  // The model's own English title keeps its own `lang`, inside an otherwise-Spanish sentence (P18).
  await expect(taskCard.locator('[lang="en"]').filter({ hasText: taskTitle })).toHaveCount(1);

  // The phone card is edited (test 2), so it is the call page's: the caller's Spanish words keep lang="es".
  await page.goto(`${callUrl()}?locale=es`);
  const phoneCard = card(page, phoneProposalId);
  await expect(phoneCard.locator("[data-status-word]")).toHaveText(w("suggestions.status.edited", "es"));
  await expect(phoneCard.locator("q").filter({ hasText: CALLER_TURN_ES })).toHaveAttribute("lang", "es");
});

test("at 360 px in the pseudo-locale, no element inside a suggestion card overflows", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  const noOverflow = async (id: string) => {
    const el = card(page, id);
    await expect(el).toBeVisible();
    const over = await el.evaluate((root) => [root, ...root.querySelectorAll("*")]
      .filter((n) => (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth + 1).length);
    expect(over, `suggestion card ${id} overflows at 360px in the pseudo-locale`).toBe(0);
  };
  // The tray holds the two still pending; the call page holds all three, the edited phone included.
  await page.goto(`${tasksUrl()}?locale=pseudo`);
  for (const id of [taskProposalId, stageProposalId]) await noOverflow(id);
  await page.goto(`${callUrl()}?locale=pseudo`);
  for (const id of [taskProposalId, phoneProposalId, stageProposalId]) await noOverflow(id);
});
