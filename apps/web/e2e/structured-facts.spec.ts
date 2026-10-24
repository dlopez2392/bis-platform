import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, getVoiceProfile, upsertVoiceProfile, getOrCreateCalendar, updateCalendarSettings,
  listVoiceServices, getLatestKnowledgeVersion, saveVoiceKnowledge, readAccountTimezone,
  type VoiceProfileRow, type VoiceServiceRow, type VoiceServiceInput,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { buildKnowledgePayload } from "../src/lib/voice/knowledge/payload";

// Same two paths, same reason, as every other spec that talks to Supabase from the Playwright runner
// process directly (seeding, cleanup), not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-47c, plan Task 10: the e2e proof that the Voice page's two new cards (business hours, services &
 * prices — 0095) each save through the real knowledge path, survive a reload, and that a save stamps a
 * new numbered snapshot (spec §7 e2e; `voice-knowledge.ts`'s `saveVoiceKnowledge`).
 *
 * FIXTURE DISCIPLINE. Every test here runs on the per-run client fixture (auth.setup.ts /
 * auth.teardown.ts) and never on `Test Client One` or any other live account — both cards write
 * `voice_profiles.business_hours` and `voice_services`, the same account `ai-disclosure.spec.ts` and
 * `trade-modules.spec.ts` already restrict their own voice-profile writes to. `readFixture()` skips the
 * whole file with a clear reason when the fixture is missing, the same local `ClientFixture` shape those
 * two files use.
 *
 * RESTORE. `beforeAll` captures the fixture's voice profile (`getVoiceProfile`, a null IS a captured
 * state), its calendar's `open_hours` (`getOrCreateCalendar`), its price list (`listVoiceServices`) and
 * its latest knowledge version, in that order, BEFORE writing anything. `afterAll` restores
 * `business_hours` and the price list through `saveVoiceKnowledge` — the real writer; `service_role` has
 * no write on `voice_services`, and a snapshot is never removed, so this file's own snapshots stay on the
 * fixture account and leave with it at `auth.teardown` — retried once on `stale` the same way
 * `…/knowledge/save.ts`'s `saveKnowledgeParts` retries, restores the calendar's `open_hours`, then
 * restores the rest of the profile column by column (named, not spread) or deletes the row if there was
 * none, each step's error checked and each restore re-read — the `ai-disclosure.spec.ts` shape (:146-202).
 *
 * THE SEED (service client): ensures a profile exists (`persona_name: "Sofía"`, `languages: "en"`,
 * `enabled: false` — never `business_hours`, which `upsertVoiceProfile` refuses at run time) and sets the
 * fixture's calendar to Monday-Friday 09:00-17:00 so test 1's "Copy from calendar" has rows to copy.
 *
 * ORDER (serial; the seed and the saved state are shared). First, the 360px measure (fills the grid, saves
 * nothing). Then test 1 saves business hours, test 2 adds and saves one price-list row, test 3 clears both —
 * each depends on the state the one before it left.
 *
 * SELECTOR ASSUMPTIONS (Task 8's cards are not committed as this file is written; each is pinned to the
 * plan's own description of the markup, §Task 8, and is a finding for the final review if Task 8's real
 * markup differs):
 *   - Each card's root carries its plan-given id (`#business-hours`, `#services-prices`).
 *   - The hours grid renders its seven day rows Monday first, each open day's two `Input type="time"`
 *     fields labelled with their day (`m["voice.hours.from"]`, "Opens on {day}", and `m["voice.hours.to"]`,
 *     "Closes on {day}"; the fix round named the day in every label), so Monday's pair is addressed by
 *     "Opens on Monday" / "Closes on Monday" directly. Each span group carries `data-hours-span`.
 *   - The services card's kind control is a `combobox` whose accessible name is `m["voice.services.kind"]`
 *     ("How it's priced"), opening options in a portal reached from `page`, not the card (Radix's own
 *     pattern, as `calendar-meeting-settings.spec.ts`'s "Meeting type" select).
 *   - "Add a service" opens its new row inline, in edit mode, immediately — there is no separate "Edit"
 *     click on a row that has nothing yet to collapse-display.
 *   - The per-row "Remove" button sits on the collapsed (non-editing) row, per the plan's "ghost Move
 *     up / Move down / Edit / Remove" on each row, not only inside its edit view. Each row button's
 *     accessible name carries the service ("Edit Catering", "Remove Catering"; the fix round).
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

const ACTOR = "e2e-structured-facts-spec";

/** Monday-Friday, 09:00-17:00: what test 1's "Copy from calendar" expects to find. */
const CALENDAR_HOURS: Record<string, [string, string][]> = {
  mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]],
};
/** What `voice_profiles.business_hours` holds once test 1 saves: a closed day is an absent key
 *  (`hoursFromForm`, SD17), so Saturday and Sunday never appear here. */
const SAVED_BUSINESS_HOURS = CALENDAR_HOURS;

let fixtureRef: ClientFixture | null = null;
let accountId = "";

let priorProfile: VoiceProfileRow | null = null;
let priorProfileCaptured = false;
let priorOpenHours: Record<string, [string, string][]> = {};
let priorServices: VoiceServiceRow[] = [];
let priorVersion = 0;

/** `VoiceServiceRow` minus its row-only columns (id, account_id, position, created_at) — the shape
 *  `saveVoiceKnowledge`'s `parts.services` takes, named field by field rather than spread (the
 *  `ai-disclosure.spec.ts` profile-restore convention), so a column added to one type and not the other
 *  is a visible omission here. */
function toServiceInputs(rows: readonly VoiceServiceRow[]): VoiceServiceInput[] {
  return rows.map((r) => ({
    name_en: r.name_en, name_es: r.name_es, description_en: r.description_en, description_es: r.description_es,
    price_kind: r.price_kind, amount_cents: r.amount_cents, amount_max_cents: r.amount_max_cents,
    unit_en: r.unit_en, unit_es: r.unit_es,
  }));
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

  const calendar = await getOrCreateCalendar(db, accountId, fixture.clerkUserId);
  priorOpenHours = calendar.open_hours;

  priorServices = await listVoiceServices(db, accountId);
  priorVersion = await getLatestKnowledgeVersion(db, accountId);

  await upsertVoiceProfile(db, accountId, {
    persona_name: "Sofía", languages: "en", enabled: false,
  }, fixture.clerkUserId);

  await updateCalendarSettings(db, accountId, { openHours: CALENDAR_HOURS }, ACTOR);
});

test.afterAll(async () => {
  if (!fixtureRef) return;
  const fixture = fixtureRef;
  const db = serviceDb();
  // Every failure is logged AND collected; the hook throws at the end, after every step has had its try,
  // so a leftover row or an unrestored value fails the run by name instead of scrolling past in a log.
  const problems: string[] = [];
  const fail = (line: string) => { console.error(line); problems.push(line); };

  const priorServiceInputs = toServiceInputs(priorServices);
  const priorBusinessHours = priorProfile?.business_hours ?? null;

  // Restore through the REAL writer (service_role has no write on voice_services, and a snapshot is
  // never removed): saveVoiceKnowledge, laying business_hours and the price list back over whatever is
  // CURRENTLY stored for facts/services text/timezone, retried once on `stale` — `…/knowledge/save.ts`'s
  // own retry shape, because a call or another save could have landed on this account meanwhile.
  let knowledgeRestored = false;
  for (let attempt = 1; attempt <= 2 && !knowledgeRestored; attempt++) {
    const [profile, timezone, baseVersion] = await Promise.all([
      getVoiceProfile(db, accountId), readAccountTimezone(db, accountId), getLatestKnowledgeVersion(db, accountId),
    ]);
    if (!profile || !timezone) {
      fail("structured-facts e2e cleanup: no profile/timezone to restore knowledge against");
      break;
    }
    const payload = buildKnowledgePayload({
      facts: profile.facts, servicesText: profile.services, timezone,
      businessHours: priorBusinessHours, services: priorServiceInputs,
      // S-47d (plan Task 10): required on every call; this restore never touched closed days, so none here.
      closedDays: [], today: "2026-01-01",
    });
    const r = await saveVoiceKnowledge(db, accountId, {
      actor: ACTOR,
      parts: { business_hours: priorBusinessHours, services: priorServiceInputs },
      payload, baseVersion,
    });
    if (r.status === "ok") {
      knowledgeRestored = true;
    } else if (r.status !== "stale") {
      fail(`structured-facts e2e cleanup: saveVoiceKnowledge restore failed: ${r.status}`);
      break;
    }
  }
  if (!knowledgeRestored && problems.length === 0) {
    fail("structured-facts e2e cleanup: saveVoiceKnowledge restore failed: stale after retry");
  }

  try {
    await updateCalendarSettings(db, accountId, { openHours: priorOpenHours }, ACTOR);
  } catch (e) {
    fail(`structured-facts e2e cleanup: calendar open_hours restore failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (priorProfileCaptured) {
    if (priorProfile) {
      const p = priorProfile;
      try {
        await upsertVoiceProfile(db, accountId, {
          persona_name: p.persona_name, greeting_en: p.greeting_en, greeting_es: p.greeting_es,
          facts: p.facts, services: p.services, languages: p.languages,
          booking_enabled: p.booking_enabled, after_hours: p.after_hours, enabled: p.enabled,
          textback_enabled: p.textback_enabled, textback_body: p.textback_body,
          textback_body_es: p.textback_body_es, textback_body_es_basis: p.textback_body_es_basis,
          public_id: p.public_id, concierge_enabled: p.concierge_enabled, concierge_form_id: p.concierge_form_id,
          disclosure: p.disclosure, trade_module: p.trade_module,
        }, fixture.clerkUserId);
      } catch (e) {
        fail(`structured-facts e2e cleanup: voice_profiles restore failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      const { error } = await db.from("voice_profiles").delete().eq("account_id", accountId);
      if (error) fail(`structured-facts e2e cleanup: voice_profiles delete failed: ${error.message}`);
    }
  }

  // Re-read: every restore actually landed.
  const afterProfile = await getVoiceProfile(db, accountId);
  const profileRestored = !priorProfileCaptured ? true : priorProfile
    ? afterProfile?.disclosure === priorProfile.disclosure && afterProfile?.persona_name === priorProfile.persona_name
      && afterProfile?.trade_module === priorProfile.trade_module
      && JSON.stringify(afterProfile?.business_hours ?? null) === JSON.stringify(priorBusinessHours)
    : afterProfile === null;
  if (!profileRestored) fail("structured-facts e2e cleanup: voice_profiles was not restored to its prior state");

  const afterServiceInputs = toServiceInputs(await listVoiceServices(db, accountId));
  if (JSON.stringify(afterServiceInputs) !== JSON.stringify(priorServiceInputs)) {
    fail("structured-facts e2e cleanup: voice_services was not restored to its prior rows");
  }

  const afterCalendar = await getOrCreateCalendar(db, accountId, fixture.clerkUserId);
  if (JSON.stringify(afterCalendar.open_hours) !== JSON.stringify(priorOpenHours)) {
    fail("structured-facts e2e cleanup: calendar open_hours was not restored to its prior value");
  }

  if (problems.length > 0) throw new Error(`structured-facts e2e cleanup left the fixture dirty:\n${problems.join("\n")}`);
});

/** Monday's two time fields, by the labels that name their day (see SELECTOR ASSUMPTIONS). */
const MONDAY_OPENS = m["voice.hours.from"].replace("{day}", m["voice.hours.day.mon"]);
const MONDAY_CLOSES = m["voice.hours.to"].replace("{day}", m["voice.hours.day.mon"]);

/**
 * The fix round's measure (design review I1): on a 360px phone the open grid's span groups (two 8rem time
 * fields, the "to" and the remove button) must wrap inside the card, never push the page sideways. Source review
 * could only read the classes; this reads the laid-out boxes. Saves nothing: Copy from calendar only fills
 * the grid, so the serial tests below start from the state the seed left.
 */
test("Business hours at 360px wide: the open grid stays inside its card and the page never scrolls sideways", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/dashboard/accounts/${accountId}/voice`);
  const hoursCard = page.locator("#business-hours");

  await hoursCard.getByRole("button", { name: m["voice.hours.copyFromCalendar"], exact: true }).click();
  const spans = hoursCard.locator("[data-hours-span]");
  // Monday to Friday, one span each: the seeded calendar.
  await expect(spans).toHaveCount(5);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "the page scrolls sideways at 360px").toBeLessThanOrEqual(clientWidth);

  const cardRight = await hoursCard.evaluate((el) => el.getBoundingClientRect().right);
  const spanRights = await spans.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  expect(spanRights.length).toBe(5);
  for (const right of spanRights) expect(right, "a span group sticks out of the hours card").toBeLessThanOrEqual(cardRight);
});

test("Business hours: Copy from calendar, save, reload, see the rows", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/dashboard/accounts/${accountId}/voice`);
  const hoursCard = page.locator("#business-hours");

  await hoursCard.getByRole("button", { name: m["voice.hours.copyFromCalendar"], exact: true }).click();

  await expect(hoursCard.getByLabel(MONDAY_OPENS, { exact: true })).toHaveValue("09:00");
  await expect(hoursCard.getByLabel(MONDAY_CLOSES, { exact: true })).toHaveValue("17:00");

  await hoursCard.getByRole("button", { name: m["voice.hours.save"], exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["voice.hours.saved"] })).toBeVisible();

  const db = serviceDb();
  await expect.poll(() => getVoiceProfile(db, accountId).then((p) => p?.business_hours)).toEqual(SAVED_BUSINESS_HOURS);
  await expect.poll(() => getLatestKnowledgeVersion(db, accountId)).toBe(priorVersion + 1);

  await page.reload();
  await expect(hoursCard.getByLabel(MONDAY_OPENS, { exact: true })).toHaveValue("09:00");
  await expect(hoursCard.getByLabel(MONDAY_CLOSES, { exact: true })).toHaveValue("17:00");
});

test("Services: add a per_unit row, see both preview sentences, save, reload, see it", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/dashboard/accounts/${accountId}/voice`);
  const servicesCard = page.locator("#services-prices");

  await servicesCard.getByRole("button", { name: m["voice.services.add"], exact: true }).click();

  await servicesCard.getByLabel(m["voice.services.nameEn"], { exact: true }).fill("Catering");
  await servicesCard.getByLabel(m["voice.services.nameEs"], { exact: true }).fill("Banquete");

  await servicesCard.getByRole("combobox", { name: m["voice.services.kind"], exact: true }).click();
  await page.getByRole("option", { name: m["voice.services.kind.per_unit"], exact: true }).click();

  await servicesCard.getByLabel(m["voice.services.amount"], { exact: true }).fill("35");
  await servicesCard.getByLabel(m["voice.services.unitEn"], { exact: true }).fill("guest");
  await servicesCard.getByLabel(m["voice.services.unitEs"], { exact: true }).fill("invitado");

  // Typed-out literals, never built by priceSentence() itself (memory "Test vacuity").
  await expect(servicesCard.getByText("The price for Catering is $35 per guest.", { exact: true })).toBeVisible();
  await expect(servicesCard.getByText("El precio de Banquete es $35 por invitado.", { exact: true })).toBeVisible();

  await servicesCard.getByRole("button", { name: m["voice.services.save"], exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["voice.services.saved"] })).toBeVisible();

  const db = serviceDb();
  await expect.poll(async () => {
    const rows = await listVoiceServices(db, accountId);
    if (rows.length !== 1) return null;
    const row = rows[0]!;
    return { price_kind: row.price_kind, amount_cents: row.amount_cents, unit_en: row.unit_en, unit_es: row.unit_es };
  }).toEqual({ price_kind: "per_unit", amount_cents: 3500, unit_en: "guest", unit_es: "invitado" });

  await page.reload();
  await expect(servicesCard.getByText("Catering", { exact: true })).toBeVisible();

  // The fix round (design review I5): Edit puts the focus in that row's English name, and Done puts it back
  // on that row's Edit — measured in the browser, which source review could not do.
  const edit = servicesCard.getByRole("button", { name: m["voice.services.editNamed"].replace("{name}", "Catering"), exact: true });
  await edit.click();
  await expect(servicesCard.getByLabel(m["voice.services.nameEn"], { exact: true })).toBeFocused();
  await servicesCard.getByRole("button", { name: m["voice.services.done"], exact: true }).click();
  await expect(edit).toBeFocused();
});

test("Clear both: hours and the service", async ({ page }) => {
  test.skip(!fixtureRef, "No client fixture — the setup project creates it; run the full suite.");
  await page.goto(`/dashboard/accounts/${accountId}/voice`);
  const hoursCard = page.locator("#business-hours");
  const servicesCard = page.locator("#services-prices");
  const db = serviceDb();

  await hoursCard.getByRole("button", { name: m["voice.hours.clear"], exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["voice.hours.cleared"] })).toBeVisible();
  await expect.poll(() => getVoiceProfile(db, accountId).then((p) => p?.business_hours)).toBeNull();

  await servicesCard.getByRole("button", { name: m["voice.services.removeNamed"].replace("{name}", "Catering"), exact: true }).click();
  await expect(servicesCard.getByText(m["voice.services.removing"], { exact: true })).toBeVisible();

  await servicesCard.getByRole("button", { name: m["voice.services.save"], exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["voice.services.saved"] })).toBeVisible();
  await expect.poll(() => listVoiceServices(db, accountId)).toEqual([]);
});
