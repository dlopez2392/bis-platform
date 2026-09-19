import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, assignPhoneNumber, startCallRow, finishCallRow,
  insertProposal, listContactTasks, type TranscriptEvent,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly (seeding, cleanup below), not
// through a Next request. calls.spec.ts and work-queue.spec.ts both do this.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * The design's own load-bearing claim (2026-09-18-call-proposals-design.md,
 * "Testing"): "a proposal must never become a record without a human
 * action." Every unit test around this feature proves a piece of that in
 * isolation — grounding, the allow-list, the stage-equality re-read — but
 * none of them clicks a real button in a real browser against a real
 * database. This spec is the one place that does: it seeds a proposal
 * exactly the way the (separately tested) generator would, through the
 * SAME `@bis/db` helpers the voice route itself calls
 * (`assignPhoneNumber` -> `startCallRow` -> `finishCallRow`, `calls.spec.ts`'s
 * own precedent), then proves — by querying `tasks` before AND after a real
 * click — that the click is what created the row, not the seeding.
 *
 * FIXTURE DISCIPLINE. Accepting a proposal calls `addTask`, a real CRM
 * write. Per CLAUDE.md and this suite's own standing rule, anything that
 * mutates account state runs on the per-run client fixture
 * (auth.setup.ts/auth.teardown.ts) and NEVER on `Test Client One` — a real
 * account with a real report recipient — or any other live account
 * (`956 Woodworks`, a real business taking real calls). `readClientFixture`
 * skips the whole spec with a clear reason if that fixture is missing
 * (e.g. a filtered run that bypassed the `setup` project), the same guard
 * `weekly-report.spec.ts` uses.
 *
 * SESSION. No `test.use` override: the default `chromium` project session
 * (`e2e/.auth/state.json`) is the agency admin auth.setup.ts signs in as,
 * and `acceptProposal`/the call-detail page both gate on
 * `requireAccountAccess`, which admits the agency for any account — the
 * same session `calls.spec.ts`'s "as the agency" block reads the SAME
 * route with.
 */
test.describe.configure({ timeout: 60_000 });

test("a proposal becomes a task only when a human clicks Accept", async ({ page }) => {
  const fixture = readClientFixture();
  if (!fixture) {
    test.skip(true, "No client fixture — the setup project creates it; run the full suite.");
    return;
  }
  const { accountId } = fixture;
  const db = serviceDb();

  const stamp = Date.now();
  const callerFirstName = "E2E";
  const callerLastName = `Proposal ${stamp}`;
  // Fictional 555-adjacent exchanges, timestamp-unique so they can never
  // collide with a leftover row or a real Telnyx number — same shape
  // calls.spec.ts uses, on a different prefix so a same-millisecond run of
  // both files could never collide either.
  const numberE164 = `+1558${String(stamp).slice(-7)}`;
  const callerE164 = `+1559${String(stamp).slice(-7)}`;

  // The evidence IS this exact string: seeded into the transcript as the
  // caller's own turn, then seeded again, verbatim, as the proposal's
  // `evidence` — proving "shown as the caller's words" means this literal
  // span reached the screen, not a paraphrase of it.
  const CALLER_TURN = `Can you call me back Tuesday about the roof quote? Ref ${stamp}`;
  const ASSISTANT_TURN = `Of course — someone will call you back Tuesday. Ref ${stamp}`;
  const TRANSCRIPT: TranscriptEvent[] = [
    { role: "caller", text: CALLER_TURN, at: new Date(stamp).toISOString() },
    { role: "assistant", text: ASSISTANT_TURN, at: new Date(stamp + 9_000).toISOString() },
  ];
  const taskTitle = `Call back about the roof quote ${stamp}`;

  let phoneNumberId = "";
  let contactId = "";
  let callId = "";

  try {
    const number = await assignPhoneNumber(
      db, accountId, { e164: numberE164, status: "testing" }, "e2e-call-proposals-spec",
    );
    phoneNumberId = number.id;

    const contact = await createContact(
      db, accountId, { firstName: callerFirstName, lastName: callerLastName },
      "e2e-call-proposals-spec",
    );
    contactId = contact.id;

    const started = await startCallRow(db, accountId, { phoneNumberId, callerE164 });
    callId = started.id;

    // "an account with a call that has a transcript" — a `lead` outcome
    // (one of the three the real generator's own eligibility check admits:
    // booked/lead/message), so this seed is a shape the pass could have
    // produced, even though the pass itself never runs in this spec.
    await finishCallRow(db, accountId, callId, {
      outcome: "lead",
      endedAt: new Date(),
      durationSecs: 96,
      turnCount: TRANSCRIPT.length,
      transcript: TRANSCRIPT,
      summary: `Recorded: caller asked for a callback. Ref ${stamp}`,
      language: "en",
      contactId,
    });

    // "and a pending `task` proposal whose evidence is a verbatim caller
    // turn from that transcript" — through the service client, deliberately
    // bypassing the (separately tested) generator: this spec's job is the
    // ACCEPT path, not the model pass that would normally produce this row.
    const proposal = await insertProposal(db, accountId, {
      callId, contactId, evidence: CALLER_TURN,
      kind: "task", payload: { title: taskTitle, dueAt: null },
    });
    if (!proposal) {
      throw new Error(
        "insertProposal returned null — check call_proposals' CHECK constraints (0040) " +
        "against this seed",
      );
    }

    // --- Containment: before the click, no task exists ----------------
    // The only things this spec has done to the database so far are seed a
    // call, a transcript and a PENDING proposal — nothing has been clicked.
    // If generating (or merely seeding) a proposal ever wrote a task on its
    // own — the exact defect this whole feature exists to prevent — this is
    // where it would show, and it must show as a genuinely empty read, not
    // an assumption.
    const before = await listContactTasks(db, accountId, contactId);
    expect(before, "seeding a pending proposal must not itself create a task").toHaveLength(0);

    await page.goto(`/dashboard/accounts/${accountId}/calls/${callId}`);

    // --- The proposal renders, evidence shown as the caller's own words --
    await expect(page.getByRole("heading", { name: m["proposals.heading"] })).toBeVisible();
    const taskLabel = m["proposals.task.label"].replace("{title}", () => taskTitle);
    await expect(page.getByText(taskLabel)).toBeVisible();
    // Prefixed AND visually quoted with a real <q> — same structural check
    // proposals.test.ts's own unit test makes, now against a real page.
    await expect(page.getByText(m["proposals.evidence"])).toBeVisible();
    await expect(page.locator("q").filter({ hasText: CALLER_TURN })).toBeVisible();
    // Still pending — the dot-plus-word status chip, not yet "Accepted".
    await expect(page.getByText(m["proposals.status.pending"], { exact: true })).toBeVisible();

    // --- Click Accept ------------------------------------------------
    await page.getByRole("button", { name: m["proposals.accept"] }).click();
    await expect(page.getByText(m["proposals.accepted.toast"])).toBeVisible();

    // --- The proposal reads Accepted, and there is nothing left to click -
    await expect(page.getByText(m["proposals.status.accepted"], { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: m["proposals.accept"] })).toHaveCount(0);

    // --- A real task now exists — created by the click, not the seed -----
    // `before` (checked above, BEFORE the click) was already empty, so this
    // row's existence is attributable to the click alone.
    const after = await listContactTasks(db, accountId, contactId);
    expect(after).toHaveLength(1);
    expect(after[0]?.title).toBe(taskTitle);
    expect(after[0]?.due_at).toBeNull();
  } finally {
    // FK-child-first, each step independently logged rather than thrown —
    // calls.spec.ts's own cleanup shape, for the same reason: a row left
    // behind here makes auth.teardown.ts's account delete fail (calls and
    // phone_numbers both reference accounts ON DELETE RESTRICT, migration
    // 0019), and that failure is only logged, silently leaking a real Clerk
    // user, a real org and real rows into the shared dev environment.
    //
    // No explicit delete for `call_proposals` or the task `addTask` created:
    // deleting `calls` cascades `call_proposals` (0040's `call_id` FK, `on
    // delete cascade`), and deleting `contacts` cascades both the task
    // (0003's `contact_id` FK, `on delete cascade`) and any `call_proposals`
    // row that survived the first delete (its OWN `contact_id` FK, also
    // cascade) — so by the time this loop reaches `contacts`, nothing of
    // this spec's is left to name.
    const deletes: [string, string, string][] = [
      ["calls", "id", callId],
      ["phone_numbers", "id", phoneNumberId],
      ["contacts", "id", contactId],
    ];
    for (const [table, column, value] of deletes) {
      if (!value) continue;
      const { error } = await db.from(table).delete().eq(column, value);
      if (error) console.error(`call-proposals e2e cleanup: ${table} delete failed: ${error.message}`);
    }
  }
});
