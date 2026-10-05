import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, getVoiceProfile, upsertVoiceProfile, setForwardCalls,
  getTransferPhone, setTransferPhone, setClientAccess, type VoiceProfileRow,
} from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that calls serviceDb() from
// the Playwright runner process itself rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * "Send calls straight to a person": the agency's switch on the Voice page
 * (operational-floor spec section 5, e2e).
 *
 * FIXTURE DISCIPLINE. The switch WRITES `voice_profiles.forward_calls` and the
 * transfer number beside it WRITES `accounts.transfer_phone`, so every test
 * here runs on the per-run client fixture (auth.setup.ts / auth.teardown.ts)
 * and never on `Test Client One` or any live account. A fake number that
 * reached a live account's transfer field would be ringing a stranger the next
 * time a customer called.
 *
 * LEAVES THE ACCOUNT AS IT CAME. setup.spec.ts runs on this same fixture and
 * asserts the exact blocker list its wizard names, one of which depends on
 * whether a voice profile row EXISTS (the leak concierge.spec.ts documents).
 * `afterAll` therefore restores exactly what `beforeAll` captured: the
 * transfer number, the switch, and whether a profile row existed at all.
 * "There was none before" is a captured state, so the restore deletes the row
 * this file created rather than leaving an empty one behind.
 *
 * The `voice.forward_changed` events this file causes are not deleted: events
 * reference `accounts` and go with the account's own cascade at teardown, and
 * the assertions below read only the rows written AFTER `baseline`, so earlier
 * rows (a retried attempt's) cannot satisfy them.
 */
type ClientFixture = { accountId: string; clerkUserId: string };

const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

function readFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  if (!parsed.accountId || !parsed.clerkUserId) return null;
  return parsed as ClientFixture;
}

/** Clearly fake, valid E.164 (normalisePhone keeps a `+` number as given). The
 *  fixture account owns no numbers of its own; beforeAll checks that rather
 *  than assuming it, because the save refuses the account's own numbers. */
const TRANSFER = "+15555550142";

test.describe.configure({ timeout: 60_000 });

let fixtureRef: ClientFixture | null = null;
let skipReason = "";
/** What `beforeAll` found, so `afterAll` can put it back. `priorProfileCaptured`
 *  is the restore guard (a null profile IS a captured state), the same shape
 *  concierge.spec.ts uses. */
let priorProfile: VoiceProfileRow | null = null;
let priorProfileCaptured = false;
let priorTransfer: string | null = null;
let priorTransferCaptured = false;
/** How many `voice.forward_changed` rows existed before this file's first click. */
let baseline = 0;

type ForwardChange = { payload: { forwardCalls?: boolean } };

/** This account's forward-switch history, oldest first, from AFTER `baseline`. */
async function changesSinceBaseline(accountId: string): Promise<boolean[]> {
  const { data, error } = await serviceDb().from("events")
    .select("payload")
    .eq("account_id", accountId).eq("type", "voice.forward_changed")
    .order("id", { ascending: true });
  if (error) throw new Error(`forward-calls spec: events read failed: ${error.message}`);
  return ((data ?? []) as ForwardChange[]).slice(baseline).map((e) => e.payload.forwardCalls === true);
}

async function countChanges(accountId: string): Promise<number> {
  const { count, error } = await serviceDb().from("events")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("type", "voice.forward_changed");
  if (error) throw new Error(`forward-calls spec: events count failed: ${error.message}`);
  return count ?? 0;
}

test.beforeAll(async () => {
  const fixture = readFixture();
  if (!fixture) {
    skipReason = "No client fixture — the setup project creates it; run the full suite.";
    return;
  }
  fixtureRef = fixture;
  const db = serviceDb();

  // The save refuses a number the account owns (the call would ring straight
  // back to Sofía), so a collision would fail the first test for a reason that
  // has nothing to do with the switch. Say so rather than fail confusingly.
  const { data: owned, error: ownedErr } = await db.from("phone_numbers")
    .select("e164").eq("account_id", fixture.accountId);
  if (ownedErr) throw new Error(`forward-calls spec: phone_numbers read failed: ${ownedErr.message}`);
  if ((owned ?? []).some((n: { e164: string }) => n.e164 === TRANSFER)) {
    skipReason = `The fixture account owns ${TRANSFER}, so it cannot be its transfer number.`;
    return;
  }

  priorProfile = await getVoiceProfile(db, fixture.accountId);
  priorProfileCaptured = true;
  priorTransfer = await getTransferPhone(db, fixture.accountId);
  priorTransferCaptured = true;

  // The switch needs a profile row to land on (setForwardCalls throws without
  // one) and the card locks without one. Defaults only — no greeting or facts,
  // so the setup wizard's voice_profile step is not made "done" by this file.
  if (!priorProfile) {
    await upsertVoiceProfile(db, fixture.accountId, { persona_name: "Sofía", enabled: false }, fixture.clerkUserId);
  } else if (priorProfile.forward_calls) {
    await setForwardCalls(db, fixture.accountId, false, fixture.clerkUserId);
  }
  // The first test starts from "no transfer number", the state every account
  // begins in.
  if (priorTransfer) await setTransferPhone(db, fixture.accountId, null, fixture.clerkUserId);

  baseline = await countChanges(fixture.accountId);
});

test.afterAll(async () => {
  if (!fixtureRef) return;
  const { accountId, clerkUserId } = fixtureRef;
  const db = serviceDb();

  // Each restore on its own flag and its own try, so one failing cannot leave
  // the next un-restored (public-form-theme.spec.ts's precedent). The switch
  // goes first: it must be off before the profile row it lives on can be
  // judged "as it was".
  const failures: string[] = [];
  const attempt = async (what: string, run: () => Promise<unknown>) => {
    try { await run(); } catch (e) { failures.push(`${what}: ${String(e)}`); }
  };

  if (priorProfileCaptured) {
    await attempt("forward_calls", async () => {
      const now = await getVoiceProfile(db, accountId);
      const wanted = priorProfile?.forward_calls ?? false;
      if (now && now.forward_calls !== wanted) await setForwardCalls(db, accountId, wanted, clerkUserId);
    });
  }
  if (priorTransferCaptured) {
    await attempt("transfer_phone", async () => {
      if ((await getTransferPhone(db, accountId)) !== priorTransfer) {
        await setTransferPhone(db, accountId, priorTransfer, clerkUserId);
      }
    });
  }
  if (priorProfileCaptured && !priorProfile) {
    // There was no profile before this file ran, so the only faithful restore
    // is for there to be none after.
    await attempt("voice_profiles row", async () => {
      const { error } = await db.from("voice_profiles").delete().eq("account_id", accountId);
      if (error) throw new Error(error.message);
    });
  }
  if (failures.length) throw new Error(`forward-calls spec: restore failed — ${failures.join("; ")}`);
});

// One account, one switch, and each step reads what the one before it wrote.
test.describe("the agency's forward-calls switch", () => {
  test.describe.configure({ mode: "serial" });

  const checkbox = (page: Page) =>
    page.getByRole("checkbox", { name: m["voice.forward.toggleLabel"] });

  test("is locked until a transfer number is saved, then enables and says where calls will ring", async ({ page }) => {
    test.skip(!fixtureRef || !!skipReason, skipReason || "No client fixture.");
    await page.goto(`/dashboard/accounts/${fixtureRef!.accountId}/voice`);

    // `getByRole` rather than the title text: the card's title and the
    // switch's label are the same words, so the title alone would match both.
    await expect(checkbox(page)).toBeVisible();
    await expect(checkbox(page)).toBeDisabled();
    await expect(checkbox(page)).not.toBeChecked();
    await expect(page.getByText(m["voice.forward.needsTransfer"])).toBeVisible();
    // The "calls ring <number>" line is absent until a number exists; matched
    // on the catalogue's own words before the placeholder, never a literal.
    await expect(page.getByText(m["voice.forward.rings"].split("{number}")[0]!.trim())).toHaveCount(0);

    await page.locator("#transfer_phone").fill(TRANSFER);
    await page.getByRole("button", { name: m["voice.transfer.save"] }).click();
    await expect(page.getByText(m["voice.transfer.saved"])).toBeVisible();

    // The save's revalidatePath re-renders the server component with the new
    // number; the web-first assertions retry until it lands.
    await expect(checkbox(page)).toBeEnabled();
    await expect(page.getByText(m["voice.forward.rings"].replace("{number}", TRANSFER))).toBeVisible();
    await expect(page.getByText(m["voice.forward.needsTransfer"])).toHaveCount(0);
    expect(await getTransferPhone(serviceDb(), fixtureRef!.accountId)).toBe(TRANSFER);
  });

  test("turning it on says so, survives a reload, and is recorded in the row and the account's history", async ({ page }) => {
    test.skip(!fixtureRef || !!skipReason, skipReason || "No client fixture.");
    const { accountId } = fixtureRef!;
    await page.goto(`/dashboard/accounts/${accountId}/voice`);

    await expect(checkbox(page)).toBeEnabled();
    await expect(checkbox(page)).not.toBeChecked();
    await checkbox(page).click();
    await expect(page.getByText(m["voice.forward.onToast"].replace("{number}", TRANSFER))).toBeVisible();
    await expect(checkbox(page)).toBeChecked();

    // `expect.poll`: the toast is the action's own return value, so it can
    // paint a beat before a read of the row is guaranteed to see it.
    await expect.poll(
      async () => (await getVoiceProfile(serviceDb(), accountId))?.forward_calls,
      { message: "forward_calls never reached true in the database" },
    ).toBe(true);
    await expect.poll(() => changesSinceBaseline(accountId)).toEqual([true]);

    // The UI's own persisted state, not the click's: a reload re-reads the row.
    await page.reload();
    await expect(checkbox(page)).toBeChecked();
    await expect(page.getByText(m["voice.forward.rings"].replace("{number}", TRANSFER))).toBeVisible();
  });

  test("turning it off says so, and Undo on the on-toast puts the phones back with Sofía", async ({ page }) => {
    test.skip(!fixtureRef || !!skipReason, skipReason || "No client fixture.");
    const { accountId } = fixtureRef!;
    await page.goto(`/dashboard/accounts/${accountId}/voice`);

    // Off first (the state the previous test left is ON), so the next click is
    // a fresh ON whose toast carries the Undo this test exists for.
    await expect(checkbox(page)).toBeChecked();
    await checkbox(page).click();
    await expect(page.getByText(m["voice.forward.offToast"])).toBeVisible();
    await expect(checkbox(page)).not.toBeChecked();
    await expect.poll(
      async () => (await getVoiceProfile(serviceDb(), accountId))?.forward_calls,
      { message: "forward_calls never reached false after turning it off" },
    ).toBe(false);

    await checkbox(page).click();
    const onToastText = m["voice.forward.onToast"].replace("{number}", TRANSFER);
    const onToast = page.locator("[data-sonner-toast]").filter({ hasText: onToastText });
    await expect(onToast).toBeVisible();
    // Hovering pauses Sonner's 4 s timer so the Undo outlives the DB read
    // (consent-phone-country.spec.ts, review R3-M5). The off-toast above may
    // still be on screen with an Undo of its own, so the button is scoped to
    // THIS toast; a bare getByRole("button", Undo) would be a strict-mode
    // violation, or worse, press the wrong one.
    await onToast.hover();
    await expect.poll(
      async () => (await getVoiceProfile(serviceDb(), accountId))?.forward_calls,
      { message: "forward_calls never reached true before the Undo" },
    ).toBe(true);

    await onToast.getByRole("button", { name: m["common.undo"] }).click();
    await expect(checkbox(page)).not.toBeChecked();
    await expect.poll(
      async () => (await getVoiceProfile(serviceDb(), accountId))?.forward_calls,
      { message: "Undo never put forward_calls back to false" },
    ).toBe(false);

    await page.reload();
    await expect(checkbox(page)).not.toBeChecked();
    // Off again, but the number it would ring is still on the account: Undo
    // flips the switch, not the transfer number.
    await expect(checkbox(page)).toBeEnabled();
    await expect(page.getByText(m["voice.forward.rings"].replace("{number}", TRANSFER))).toBeVisible();

    // The whole history, in order: on (test 2), off, on, undo. An Undo that
    // wrote the column without the event would leave this one short.
    await expect.poll(() => changesSinceBaseline(accountId)).toEqual([true, false, true, false]);
  });
});

// A client signs in as the fixture's own Clerk user (auth.setup.ts), not the
// agency admin. The Voice page is agency-only (`requireAgencyOnlyAccountAccess`
// in voice/page.tsx), and that guard REDIRECTS a client to their own account
// dashboard rather than rendering a refusal — the same shape automations.spec.ts
// asserts for its agency-only page.
test.describe("a client cannot reach the forward-calls switch", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  // client-access.spec.ts deliberately leaves the fixture's client access OFF
  // and sorts BEFORE this file. With it off the client lands on /no-access,
  // which would make the "never saw the card" assertions below pass for the
  // wrong reason; establish the precondition here, as automations.spec.ts does.
  test.beforeAll(async () => {
    const fixture = readFixture();
    if (fixture) await setClientAccess(serviceDb(), fixture.accountId, true, fixture.clerkUserId);
  });

  test("is sent to their own dashboard, and the card is nowhere on it", async ({ page }) => {
    const fixture = readFixture();
    test.skip(!fixture, "No client fixture — the setup project creates it; run the full suite.");
    const { accountId } = fixture!;

    await page.goto(`/dashboard/accounts/${accountId}/voice`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/dashboard$`));
    // The positive half, or every absence below passes against a client who
    // can read nothing at all (a 404 or an error page): the dashboard's own
    // hero KPI proves a real page rendered. Asserted via `data-hero`, not
    // the fixed `kpi-calls-answered` testid: this file's own top-level
    // `beforeAll` just above writes `voice_profiles.enabled: false` for
    // this fixture, so the hero is "Leads captured" (`kpi-leads-captured` —
    // the same definition the Monday weekly report sends, owner decision),
    // not "Calls answered" (F-076's now slice, crm-features.md §2.3/§6.3) —
    // `kpi-calls-answered` would not even render here.
    await expect(page.locator('[data-hero="true"]')).toHaveText(/^\d+$/);

    await expect(page.locator("#forward-calls")).toHaveCount(0);
    await expect(page.locator("#forward_calls")).toHaveCount(0);
    await expect(page.getByText(m["voice.forward.title"], { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: m["nav.voice"], exact: true })).toHaveCount(0);
  });
});
