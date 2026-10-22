import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, getVoiceProfile, upsertVoiceProfile, assignPhoneNumber,
  startCallRow, finishCallRow, setClientAccess, type VoiceProfileRow,
} from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-47b, plan Task 9: the e2e proof that the Voice page's Trade rules choice (0094) is saved with the
 * profile card's own Save, survives a reload, and that a call's own stamp — written once at
 * `startCallRow` time and never touched by a later profile edit — is the ONLY agency-only line on the
 * call page (spec section 3, SD3; `calls.detail.tradeRules`).
 *
 * FIXTURE DISCIPLINE. Every test here runs on the per-run client fixture (auth.setup.ts /
 * auth.teardown.ts) and never on `Test Client One` or any other live account — mutating the fixture's
 * own voice profile and seeding a call and a phone number is exactly the write `ai-disclosure.spec.ts`
 * already restricts to the fixture for the same reason. `readFixture()` skips the whole file with a
 * clear reason when the fixture is missing, the same local `ClientFixture` shape that file uses.
 *
 * RESTORE. `beforeAll` captures the fixture's voice profile exactly as found (`getVoiceProfile`, a null
 * IS a captured state). `afterAll` deletes the one call and the one phone number this file wrote, then
 * restores the profile column by column (named, not spread, so a column added to `VoiceProfileRow`
 * later is a visible omission here), or deletes the row if there was none, each `error` checked and
 * each restore re-read — the `ai-disclosure.spec.ts` shape (:146-202).
 *
 * THE SEED (service client, one account, one fake number, one finished call): the profile starts with
 * no trade module (`trade_module: null`) so test 1's "None — general rules only" precondition holds
 * regardless of what an earlier run of this file left behind (the restore above already guarantees
 * that too, but the seed does not rely on it). The call is seeded directly through `startCallRow` with
 * its own `tradeModule` stamp, `{ module: "events", version: 1 }` — the same "seed through the real
 * writer, not the live route" shape `ai-disclosure.spec.ts` uses, because the live route decides the
 * module from the profile itself and this file needs a STABLE value to assert against the call page
 * independent of whatever the profile reads at that moment.
 *
 * ORDER (serial; the seed is shared). Tests 1 and 2 move the fixture's `voice_profiles.trade_module`
 * between "events" and null — the call's own `trade_module`/`trade_module_version` columns are
 * independent and never touched by either, so test 3's "Events · v1" assertion holds no matter what
 * tests 1-2 left the profile reading. Test 4 runs last, in its own `describe` on the client's own
 * storage state (A11), and reads the same call again as the fixture's Owner.
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

const ACTOR = "e2e-trade-modules-spec";
const stamp = Date.now();
const numberE164 = `+1557${String(stamp).slice(-7)}`;
const PERSONA = "Sofía";
const GREETING_EN = "Hello from the venue.";
const FACTS = "A test venue for the S-47b e2e spec.";

let fixtureRef: ClientFixture | null = null;
let accountId = "";
let phoneNumberId = "";
let callId = "";

let priorProfile: VoiceProfileRow | null = null;
let priorProfileCaptured = false;

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

  await upsertVoiceProfile(db, accountId, {
    persona_name: PERSONA, greeting_en: GREETING_EN, facts: FACTS,
    languages: "en", enabled: false, trade_module: null,
  }, fixture.clerkUserId);

  const number = await assignPhoneNumber(db, accountId, { e164: numberE164, status: "testing" }, ACTOR);
  phoneNumberId = number.id;

  const { id } = await startCallRow(db, accountId, {
    phoneNumberId, callerE164: null, tradeModule: { module: "events", version: 1 },
  });
  callId = id;
  await finishCallRow(db, accountId, callId, {
    outcome: "booked", endedAt: new Date(), durationSecs: 30, turnCount: 1,
    transcript: [], summary: `S-47b e2e seed call, ref ${stamp}`, language: "en",
  });
});

test.afterAll(async () => {
  if (!fixtureRef) return;
  const fixture = fixtureRef;
  const db = serviceDb();
  // Every failure is logged AND collected; the hook throws at the end, after every step has had its try,
  // so a leftover row or an unrestored profile fails the run by name instead of scrolling past in a log.
  const problems: string[] = [];
  const fail = (line: string) => { console.error(line); problems.push(line); };
  const step = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) fail(`trade-modules e2e cleanup: ${what} failed: ${error.message}`);
  };

  if (callId) await step("calls", () => db.from("calls").delete().eq("account_id", accountId).eq("id", callId));
  if (phoneNumberId) await step("phone_numbers", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", phoneNumberId));

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
        disclosure: p.disclosure, trade_module: p.trade_module,
      }, fixture.clerkUserId);
    } else {
      await step("voice_profiles", () => db.from("voice_profiles").delete().eq("account_id", accountId));
    }
  }

  // Re-read: both seeded rows are actually gone, and the profile (if one existed) is back to its own value.
  const checks: Array<[string, () => Promise<number>]> = [
    ["calls", async () => (await db.from("calls").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("id", callId || "")).count ?? -1],
    ["phone_numbers", async () => (await db.from("phone_numbers").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("id", phoneNumberId || "")).count ?? -1],
  ];
  for (const [table, count] of checks) {
    const n = await count();
    if (n !== 0) fail(`trade-modules e2e cleanup: ${table} still holds ${n} row(s) for this spec's seed`);
  }
  if (priorProfileCaptured) {
    const after = await getVoiceProfile(db, accountId);
    const restored = priorProfile
      ? after?.disclosure === priorProfile.disclosure && after?.persona_name === priorProfile.persona_name
        && after?.trade_module === priorProfile.trade_module
      : after === null;
    if (!restored) fail("trade-modules e2e cleanup: voice_profiles was not restored to its prior state");
  }
  if (problems.length > 0) throw new Error(`trade-modules e2e cleanup left the fixture dirty:\n${problems.join("\n")}`);
});

test("the agency picks Events, saves it, and it holds after a reload", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/dashboard/accounts/${accountId}/voice`);
  const main = page.getByRole("main");

  await expect(main.getByRole("radio", { name: "None — general rules only", exact: true })).toBeChecked();

  await main.getByRole("radio", { name: "Events and venues", exact: true }).check();
  await main.getByRole("button", { name: m["voice.profile.save"], exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["voice.profile.saved"] })).toBeVisible();

  const db = serviceDb();
  await expect.poll(() => getVoiceProfile(db, accountId).then((p) => p?.trade_module)).toBe("events");

  await page.reload();
  await expect(main.getByRole("radio", { name: "Events and venues", exact: true })).toBeChecked();
});

test("the agency resets to None, saves it, and it holds after a reload", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/dashboard/accounts/${accountId}/voice`);
  const main = page.getByRole("main");

  await main.getByRole("radio", { name: "None — general rules only", exact: true }).check();
  await main.getByRole("button", { name: m["voice.profile.save"], exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["voice.profile.saved"] })).toBeVisible();

  const db = serviceDb();
  await expect.poll(() => getVoiceProfile(db, accountId).then((p) => p?.trade_module)).toBeNull();

  await page.reload();
  await expect(main.getByRole("radio", { name: "None — general rules only", exact: true })).toBeChecked();
  await expect(main.getByRole("radio", { name: "Events and venues", exact: true })).not.toBeChecked();
});

test("the agency sees the call's trade rules line", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/dashboard/accounts/${accountId}/calls/${callId}`);

  await expect(page.locator("[data-trade-rules]")).toHaveText("Events · v1");
  await expect(page.getByRole("main").getByText(m["voice.tradeRules.legend"], { exact: true })).toBeVisible();
});

// A client signs in as the fixture's own Clerk user (auth.setup.ts), not the agency admin. The call
// page is shared with clients (`requireAccountAccess`, not the Voice page's agency-only guard), so it
// renders for them too — just without the agency-only trade rules line (spec section 3, SD3).
test.describe("a client Owner never sees a call's trade rules line", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  // `client-access.spec.ts` sorts BEFORE this file alphabetically and leaves `client_access_enabled`
  // false — the same defensive set `ai-disclosure.spec.ts`'s own client describe uses, rather than
  // assuming an ordering this file does not control.
  test.beforeAll(async () => {
    const fixture = readFixture();
    if (fixture) await setClientAccess(serviceDb(), fixture.accountId, true, fixture.clerkUserId);
  });

  test("the call page loads, with no trade rules line", async ({ page }) => {
    const fixture = readFixture();
    test.skip(!fixture, "No client fixture — the setup project creates it; run the full suite.");
    const { accountId: fixtureAccountId } = fixture!;

    await page.goto(`/dashboard/accounts/${fixtureAccountId}/calls/${callId}`);
    await expect(page.locator("[data-trade-rules]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: m["calls.detail.transcript"] })).toBeVisible();
  });
});
