import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createForm, updateForm, getVoiceProfile, upsertVoiceProfile,
  enableConcierge, type VoiceProfileRow,
} from "@bis/db";
import { conciergeStrings } from "../src/lib/concierge/strings";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process directly: this file calls serviceDb() itself,
// not through a Next request, so nothing auto-loads the env for it. It is also
// what puts OPENAI_API_KEY (when a machine has one) into this process's env,
// so the skip below reads the same configuration the server will.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The website concierge, end to end: switch it on for an account, open the
 * address the snippet would point at, and hold one exchange.
 *
 * FIXTURE DISCIPLINE. Enabling the concierge WRITES to `voice_profiles` and
 * creates a form, so this runs on the per-run client fixture
 * (auth.setup.ts / auth.teardown.ts) and never on `Test Client One` or any
 * other live account — there is one Supabase project, so an e2e write to a
 * seeded account IS a production write.
 *
 * WHY THE SECOND TEST IS CONDITIONAL. Answering a turn costs a real model
 * call. Without OPENAI_API_KEY the route refuses with 503 by design, so the
 * assertion would be about the refusal rather than about the product; the
 * skip says so out loud rather than passing quietly. The first test needs no
 * key and therefore runs everywhere: it is the only end-to-end proof that
 * `enableConcierge`'s public id resolves to a page that renders this client's
 * own greeting.
 */
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

type ClientFixture = { accountId: string; clerkUserId: string; brandName: string };

function readFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  if (!parsed.accountId || !parsed.clerkUserId) return null;
  return parsed as ClientFixture;
}

/** The tenant's OWN words, so "the greeting rendered" cannot be satisfied by
 *  anything the platform supplies. */
const GREETING = "Hi — ask me anything about the workshop.";

// A real build, a real database round trip per step, and one model call.
test.describe.configure({ timeout: 120_000 });

let widget: {
  publicId: string; accountId: string; formId: string; actorId: string;
} | null = null;
let skipReason = "";

/**
 * The fixture account's voice profile EXACTLY as this file found it, restored
 * in afterAll.
 *
 * Not hygiene — a correctness requirement, learned the hard way on the first
 * full run of this spec. `enableConcierge` needs a `voice_profiles` row to
 * attach to, and a row carrying a greeting and facts is what makes the setup
 * wizard's `voice_profile` step DONE (lib/setup/setup-status.ts). setup.spec.ts
 * runs on this same per-run fixture account and asserts the exact blocker list
 * a locked step names — ["Voice profile", "Phone number"] — so writing a
 * profile here and leaving it turned that spec red with a string diff that
 * pointed nowhere near this file. Playwright runs files alphabetically, so
 * `concierge` lands before `setup` and the leak was guaranteed, not likely.
 * public-form-theme.spec.ts restores the fixture's branding in a `finally`
 * for exactly this reason.
 */
let priorProfile: VoiceProfileRow | null = null;

test.beforeAll(async () => {
  const fixture = readFixture();
  if (!fixture) {
    skipReason = "No client fixture — the setup project creates it; run the full suite.";
    return;
  }
  const db = serviceDb();
  const stamp = Date.now();
  const { id: formId } = await createForm(db, fixture.accountId, {
    name: `E2E Concierge ${stamp}`,
    fields: [
      { key: "name", kind: "core.first_name", label: "Name", required: true },
      { key: "email", kind: "core.email", label: "Email", required: false },
      { key: "message", kind: "message", label: "What do you need?", required: false },
    ],
  }, fixture.clerkUserId);
  // Published, not draft: the lead the widget files lands through the same
  // pipeline the public form uses, and that refuses anything else.
  await updateForm(db, fixture.accountId, formId, { status: "published" }, fixture.clerkUserId);
  priorProfile = await getVoiceProfile(db, fixture.accountId);
  await upsertVoiceProfile(db, fixture.accountId, {
    persona_name: "Sofía", greeting_en: GREETING, greeting_es: GREETING,
    facts: "The workshop builds custom tables and benches. Open weekdays 8am-5pm.",
    services: "Custom tables, benches, repairs.",
    languages: "en",
    // The PHONE line stays off. Switching the widget on must never imply a
    // receptionist is answering a number.
    enabled: false,
  }, fixture.clerkUserId);
  const { publicId } = await enableConcierge(db, fixture.accountId, formId);
  widget = {
    publicId, accountId: fixture.accountId, formId, actorId: fixture.clerkUserId,
  };
});

test.afterAll(async () => {
  if (!widget) return;
  const db = serviceDb();
  // Best effort, in the order the foreign keys allow. The fixture account is
  // deleted wholesale by auth.teardown, but a run killed before that leaves
  // these behind, and a stray enabled concierge on a stray account is exactly
  // the kind of leftover the sweep exists to stop accumulating.
  await db.from("concierge_conversations").delete().eq("account_id", widget.accountId);
  await db.from("form_submissions").delete().eq("form_id", widget.formId);
  await db.from("forms").delete().eq("id", widget.formId);

  if (priorProfile) {
    // Every column of the row, named rather than spread, so a column added to
    // `VoiceProfileRow` later shows up here as a typecheck-visible omission
    // instead of silently not being restored. The concierge flags are part of
    // it, which is why `disableConcierge` is not also called.
    const p = priorProfile;
    await upsertVoiceProfile(db, widget.accountId, {
      persona_name: p.persona_name, greeting_en: p.greeting_en, greeting_es: p.greeting_es,
      facts: p.facts, services: p.services, languages: p.languages,
      booking_enabled: p.booking_enabled, after_hours: p.after_hours, enabled: p.enabled,
      textback_enabled: p.textback_enabled, textback_body: p.textback_body,
      public_id: p.public_id, concierge_enabled: p.concierge_enabled,
      concierge_form_id: p.concierge_form_id,
    }, widget.actorId);
  } else {
    // There was no profile before this file ran, so the only faithful restore
    // is for there to be none after. `disableConcierge` is deliberately NOT
    // called first: it throws when it matches no row, and there is about to
    // be no row.
    await db.from("voice_profiles").delete().eq("account_id", widget.accountId);
  }
});

test("the address the snippet points at renders this client's own greeting", async ({ page }) => {
  test.skip(!widget, skipReason);
  await page.goto(`/c/${widget!.publicId}`);

  await expect(page.getByText(GREETING)).toBeVisible();
  // The composer is open for business: `ended` has not been set by anything.
  await expect(page.locator("#bis-concierge-input")).toBeEnabled();
  await expect(page.getByRole("button", { name: conciergeStrings("en").send })).toBeVisible();
});

test("a visitor's message comes back with a reply", async ({ page }) => {
  test.skip(!widget, skipReason);
  test.skip(
    !process.env.OPENAI_API_KEY,
    "OPENAI_API_KEY is not set here, so /api/concierge/[publicId]/turn refuses by design "
      + "and there is no reply to assert. Set it in apps/web/.env.local to run this.",
  );
  const strings = conciergeStrings("en");
  await page.goto(`/c/${widget!.publicId}`);
  await expect(page.getByText(GREETING)).toBeVisible();

  await page.locator("#bis-concierge-input").fill("Do you build dining tables?");
  // The fill-time floor (MIN_FILL_MS, 2s from the render token's mint) is a
  // real guard on the first turn, and a browser driven by a robot trips it
  // every time. forms.spec.ts waits it out for the same reason.
  await page.waitForTimeout(2_500);
  await page.getByRole("button", { name: strings.send }).click();

  // Two assistant messages: the greeting, and an answer. The skeleton carries
  // the same class while the turn is in flight, so it is excluded — counting
  // it would let "still thinking" pass as "answered".
  const replies = page.locator(".bis-concierge-log li.bis-msg-assistant:not(.bis-msg-skeleton)");
  await expect(replies).toHaveCount(2, { timeout: 60_000 });

  // The model's WORDING is not asserted — it is a model. What is asserted is
  // that the words are not one of the route's own refusals, which is what a
  // 503 or a spent cap would have put on screen instead.
  const answer = (await replies.last().textContent())?.trim() ?? "";
  expect(answer.length).toBeGreaterThan(0);
  expect(answer).not.toBe(strings.unavailable);
  expect(answer).not.toBe(strings.ended);
  await expect(page.locator(".bis-concierge-error")).toHaveCount(0);
});
