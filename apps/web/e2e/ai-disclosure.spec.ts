import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, getVoiceProfile, upsertVoiceProfile, createForm, updateForm, enableConcierge,
  assignPhoneNumber, startCallRow, finishCallRow, setClientAccess, type VoiceProfileRow,
} from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-47a, plan Task 8: the e2e proof that Sofía's AI disclosure (0093, decision 20) reaches both
 * surfaces the plan names — the website chat (label + first message, on Trial/On, in English and
 * Spanish, and silent on Off) and the agency's Voice page (the Off/Trial/On setting, saved with the
 * profile card's own Save, and the results card comparing the two TRIAL halves cell by cell) — and
 * that a client Owner never reaches the setting at all (A5/A6).
 *
 * FIXTURE DISCIPLINE. Enabling the concierge and seeding calls WRITES `voice_profiles` and `calls`,
 * so every test here runs on the per-run client fixture (auth.setup.ts / auth.teardown.ts) and never
 * on `Test Client One` or any other live account. `readFixture()` skips the whole file with a clear
 * reason when the fixture is missing — the same local `ClientFixture` shape `forward-calls.spec.ts`
 * (:40-48) and `concierge.spec.ts` use, because `support.ts`'s own `readClientFixture()` carries no
 * `clerkUserId` and `upsertVoiceProfile`/`createForm` both need an actor id.
 *
 * RESTORE. `beforeAll` captures the fixture's voice profile exactly as found (`getVoiceProfile`, a
 * null IS a captured state — `concierge.spec.ts`'s own lesson: `setup.spec.ts` runs on this same
 * fixture and reads whether a voice-profile row exists at all). `afterAll` deletes every row this
 * file wrote — four calls, one phone number, one form — then restores the profile column by column
 * (named, not spread, so a column added to `VoiceProfileRow` later is a visible omission here), or
 * deletes the row if there was none, each `error` checked and each restore re-read.
 *
 * THE SEED (service client, one account, one fake number): four FINISHED calls (`ended_at` set by
 * `finishCallRow`) — two said-it/Trial (one booked, one that asked for a person via
 * `handoff_requested_at`), one didn't-say-it/Trial (hung up early), one On (outside the trial, D5).
 * `getDisclosureResults` (packages/db/src/voice.ts) counts only `disclosure_setting = 'trial'` calls
 * into the two halves; the On call lands in its `notCounted` bucket — one call, the exact footnote
 * the agency test reads.
 *
 * ORDER (serial; the seed is shared). Tests 1-3 read the chat page (English, Spanish, then Off);
 * test 3 restores `disclosure` to "on" at its own end so test 4's "the radio is checked" assertion
 * (profile still reads "on" at that point) holds regardless of test order inside the file. Test 4
 * then moves the setting to Trial and saves, so the profile is left "trial" afterwards — `afterAll`'s
 * restore is what returns it to whatever the fixture actually carried before this file ran, not test
 * 4's own undo.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

function readFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  if (!parsed.accountId || !parsed.clerkUserId) return null;
  return parsed as ClientFixture;
}

const ACTOR = "e2e-ai-disclosure-spec";
const stamp = Date.now();
const numberE164 = `+1556${String(stamp).slice(-7)}`;
const PERSONA = "Sofía";
const GREETING_EN = "Hello from the workshop.";
const GREETING_ES = "Hola desde el taller.";

let fixtureRef: ClientFixture | null = null;
let accountId = "";
let publicId = "";
let createdFormId: string | null = null;
let phoneNumberId = "";
const callIds: string[] = [];

let priorProfile: VoiceProfileRow | null = null;
let priorProfileCaptured = false;

/** One finished call, seeded directly rather than through the live voice route (which decides the
 *  coin and the greeting itself): `startCallRow`'s own `disclosure` field writes `disclosed` and
 *  `disclosure_setting` together (0093's pairing), `finishCallRow` writes `outcome` and `ended_at`,
 *  and a asked-for-a-person call gets one extra raw stamp of `handoff_requested_at` (D6) — there is
 *  no helper for that beyond `markHandoffRequested`, which also rewrites `language`; a direct update
 *  of the one column this seed cares about avoids that side effect. */
async function seedCall(
  db: ReturnType<typeof serviceDb>,
  disclosure: { disclosed: boolean; setting: "trial" | "on" },
  outcome: "booked" | "abandoned",
  askedForPerson: boolean,
): Promise<string> {
  const { id: callId } = await startCallRow(db, accountId, { phoneNumberId, callerE164: null, disclosure });
  await finishCallRow(db, accountId, callId, {
    outcome, endedAt: new Date(), durationSecs: 30, turnCount: 1,
    transcript: [], summary: `S-47a e2e seed call, ref ${stamp}`, language: "en",
  });
  if (askedForPerson) {
    const { error } = await db.from("calls").update({ handoff_requested_at: new Date().toISOString() }).eq("id", callId);
    if (error) throw new Error(`ai-disclosure e2e: stamping handoff_requested_at failed: ${error.message}`);
  }
  return callId;
}

test.beforeAll(async () => {
  const fixture = readFixture();
  if (!fixture) {
    test.skip(true, "No client fixture — the setup project creates it; run the full suite.");
    return;
  }
  fixtureRef = fixture;
  accountId = fixture.accountId;
  const db = serviceDb();

  priorProfile = await getVoiceProfile(db, accountId);
  priorProfileCaptured = true;

  const { id: formId } = await createForm(db, accountId, {
    name: `E2E Disclosure ${stamp}`,
    fields: [{ key: "name", kind: "core.first_name", label: "Name", required: true }],
  }, fixture.clerkUserId);
  createdFormId = formId;
  await updateForm(db, accountId, formId, { status: "published" }, fixture.clerkUserId);

  // `facts` is not named in the plan's own patch literal, but `enableConcierge` refuses a profile
  // `assistantProfileGap` still finds incomplete (packages/db/src/profile-ready.ts) — with
  // `languages: "en"` that means a non-blank `greeting_en` (given) and a non-blank `facts` (not
  // given), so one is added here to let the seed's own `enableConcierge` call succeed.
  await upsertVoiceProfile(db, accountId, {
    persona_name: PERSONA, greeting_en: GREETING_EN, greeting_es: GREETING_ES,
    facts: "A test workshop for the S-47a e2e spec.", languages: "en", enabled: false, disclosure: "on",
  }, fixture.clerkUserId);
  const enabled = await enableConcierge(db, accountId, formId);
  publicId = enabled.publicId;

  const number = await assignPhoneNumber(db, accountId, { e164: numberE164, status: "testing" }, ACTOR);
  phoneNumberId = number.id;

  callIds.push(
    await seedCall(db, { disclosed: true, setting: "trial" }, "booked", false),
    await seedCall(db, { disclosed: true, setting: "trial" }, "abandoned", true),
    await seedCall(db, { disclosed: false, setting: "trial" }, "abandoned", false),
    await seedCall(db, { disclosed: true, setting: "on" }, "booked", false),
  );
});

test.afterAll(async () => {
  if (!fixtureRef) return;
  const fixture = fixtureRef;
  const db = serviceDb();
  const step = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`ai-disclosure e2e cleanup: ${what} failed: ${error.message}`);
  };

  if (callIds.length > 0) await step("calls", () => db.from("calls").delete().eq("account_id", accountId).in("id", callIds));
  if (phoneNumberId) await step("phone_numbers", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", phoneNumberId));
  if (createdFormId) {
    // Defensive, matching concierge.spec.ts: nothing here submits the form, but a stray
    // conversation or submission from a retried run must not survive this file either.
    await step("concierge_conversations", () => db.from("concierge_conversations").delete().eq("account_id", accountId));
    await step("form_submissions", () => db.from("form_submissions").delete().eq("form_id", createdFormId!));
    await step("forms", () => db.from("forms").delete().eq("id", createdFormId!));
  }

  if (priorProfileCaptured) {
    if (priorProfile) {
      const p = priorProfile;
      await upsertVoiceProfile(db, accountId, {
        persona_name: p.persona_name, greeting_en: p.greeting_en, greeting_es: p.greeting_es,
        facts: p.facts, services: p.services, languages: p.languages,
        booking_enabled: p.booking_enabled, after_hours: p.after_hours, enabled: p.enabled,
        textback_enabled: p.textback_enabled, textback_body: p.textback_body,
        textback_body_es: p.textback_body_es, textback_body_es_basis: p.textback_body_es_basis,
        public_id: p.public_id, concierge_enabled: p.concierge_enabled, concierge_form_id: p.concierge_form_id,
        disclosure: p.disclosure,
      }, fixture.clerkUserId);
    } else {
      await step("voice_profiles", () => db.from("voice_profiles").delete().eq("account_id", accountId));
    }
  }

  // Re-read: every deletion actually landed, and the profile (if one existed) is back to its own value.
  const checks: Array<[string, () => Promise<number>]> = [
    ["calls", async () => (await db.from("calls").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("id", callIds.length > 0 ? callIds : [""])).count ?? -1],
    ["phone_numbers", async () => (await db.from("phone_numbers").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("id", phoneNumberId || "")).count ?? -1],
  ];
  for (const [table, count] of checks) {
    const n = await count();
    if (n !== 0) console.error(`ai-disclosure e2e cleanup: ${table} still holds ${n} row(s) for this spec's seed`);
  }
  if (priorProfileCaptured) {
    const after = await getVoiceProfile(db, accountId);
    const restored = priorProfile
      ? after?.disclosure === priorProfile.disclosure && after?.persona_name === priorProfile.persona_name
      : after === null;
    if (!restored) console.error("ai-disclosure e2e cleanup: voice_profiles was not restored to its prior state");
  }
});

test("Chat, English: the AI label and the disclosed first message", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/c/${publicId}`);
  await expect(page.locator("[data-ai-label]")).toHaveText("Sofía · AI assistant");
  await expect(page.locator(".bis-msg-assistant").first()).toHaveText(
    "Hello from the workshop. I'm Sofía, an AI assistant. This chat is saved so the team can follow up.",
  );
});

test("Chat, Spanish: the AI label and the disclosed first message", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/c/${publicId}?locale=es`);
  await expect(page.locator("[data-ai-label]")).toHaveText("Sofía · asistente de IA");
  await expect(page.locator(".bis-msg-assistant").first()).toHaveText(
    "Hola desde el taller. Soy Sofía, una asistente de inteligencia artificial. Este chat se guarda para que el equipo te dé seguimiento.",
  );
});

test("Chat, Off: no label, the greeting alone", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  const db = serviceDb();
  await upsertVoiceProfile(db, accountId, { disclosure: "off" }, fixtureRef!.clerkUserId);
  await page.goto(`/c/${publicId}`);
  await expect(page.locator("[data-ai-label]")).toHaveCount(0);
  await expect(page.locator(".bis-msg-assistant").first()).toHaveText("Hello from the workshop.");
  // Left "on" for test 4's own "the radio is checked" assertion.
  await upsertVoiceProfile(db, accountId, { disclosure: "on" }, fixtureRef!.clerkUserId);
});

test("Agency: the setting is On, the results card reads cell by cell, and Trial saves", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/dashboard/accounts/${accountId}/voice`);
  const main = page.getByRole("main");

  await expect(main.getByRole("radio", { name: "On", exact: true })).toBeChecked();

  const results = main.locator("[data-disclosure-results]");
  await expect(results.locator('[data-half="said"] [data-cell="counted"]')).toHaveText("2");
  await expect(results.locator('[data-half="said"] [data-cell="booked"]')).toHaveText("50%");
  await expect(results.locator('[data-half="said"] [data-cell="hungUp"]')).toHaveText("0%");
  await expect(results.locator('[data-half="said"] [data-cell="askedPerson"]')).toHaveText("50%");
  await expect(results.locator('[data-half="didnt"] [data-cell="counted"]')).toHaveText("1");
  await expect(results.locator('[data-half="didnt"] [data-cell="booked"]')).toHaveText("0%");
  await expect(results.locator('[data-half="didnt"] [data-cell="hungUp"]')).toHaveText("100%");
  await expect(results.locator('[data-half="didnt"] [data-cell="askedPerson"]')).toHaveText("0%");
  await expect(results).toContainText("Not enough calls yet to tell.");
  await expect(results).toContainText("1 call not counted (spam, or outside the trial)");

  await main.getByRole("radio", { name: "Trial", exact: true }).check();
  await main.getByRole("button", { name: m["voice.profile.save"], exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["voice.profile.saved"] })).toBeVisible();

  const db = serviceDb();
  await expect.poll(() => getVoiceProfile(db, accountId).then((p) => p?.disclosure)).toBe("trial");
});

// A client signs in as the fixture's own Clerk user (auth.setup.ts), not the agency admin. The Voice
// page is agency-only (`requireAgencyOnlyAccountAccess` in voice/page.tsx), and that guard REDIRECTS
// a client to their own account dashboard rather than rendering a refusal (A5/A6) — the same shape
// `forward-calls.spec.ts` asserts for the same page.
test.describe("a client Owner never reaches the setting", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  // `client-access.spec.ts` sorts AFTER this file (alphabetically "ai-" < "client-"), so it has not
  // yet turned client access off — but the defensive set mirrors `forward-calls.spec.ts`'s own
  // precondition rather than assuming an ordering this file does not control.
  test.beforeAll(async () => {
    const fixture = readFixture();
    if (fixture) await setClientAccess(serviceDb(), fixture.accountId, true, fixture.clerkUserId);
  });

  test("is sent to their own dashboard, and the setting is nowhere on it", async ({ page }) => {
    const fixture = readFixture();
    test.skip(!fixture, "No client fixture — the setup project creates it; run the full suite.");
    const { accountId: fixtureAccountId } = fixture!;

    const db = serviceDb();
    const before = await getVoiceProfile(db, fixtureAccountId);

    await page.goto(`/dashboard/accounts/${fixtureAccountId}/voice`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${fixtureAccountId}/dashboard$`));
    await expect(page.getByText("Tell callers", { exact: false })).toHaveCount(0);

    const after = await getVoiceProfile(db, fixtureAccountId);
    expect(after?.disclosure).toBe(before?.disclosure);
  });
});
