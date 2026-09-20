import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createForm, updateForm, getVoiceProfile, upsertVoiceProfile,
  enableConcierge, getBranding, setBranding, type VoiceProfileRow, type Branding,
} from "@bis/db";
import { conciergeStrings } from "../src/lib/concierge/strings";
import { signRenderToken, RENDER_TOKEN_FIELD } from "../src/lib/forms/guards";
import { hexOf } from "./support";

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
 * State captured incrementally through `beforeAll`, so `afterAll` can restore
 * exactly what was actually mutated even if a LATER step throws.
 *
 * IMPORTANT (review of commit 129b43f): `afterAll` used to guard its whole
 * body on `if (!widget) return`, and `widget` is assigned only after
 * `enableConcierge` — the LAST call in `beforeAll`. If `enableConcierge`
 * threw, `upsertVoiceProfile` had already overwritten the fixture account's
 * real voice profile, `widget` stayed null, and `afterAll` returned without
 * restoring it — the exact state that turned `setup.spec.ts:537` red once
 * before, on a string diff that pointed nowhere near this file (see the note
 * on `priorProfile` below). The restore must be guarded on what was actually
 * READ and WRITTEN, not on whether the LAST step succeeded.
 * `public-form-theme.spec.ts` (capture, then restore in a real `finally`) is
 * the precedent.
 */
let fixtureRef: ClientFixture | null = null;
let createdFormId: string | null = null;

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
 *
 * `priorProfileCaptured` is the actual restore guard — TRUE the moment the
 * read above succeeds, whether or not a row existed (`priorProfile` staying
 * null IS a captured state: "there was none before").
 */
let priorProfile: VoiceProfileRow | null = null;
let priorProfileCaptured = false;

/**
 * The fixture account's branding EXACTLY as this file found it, restored in
 * `afterAll` — same discipline and the same reason as `priorProfile` above.
 * IMPORTANT 2's assertion 6 needs a brand colour neither half of which the
 * loader's own default (background `#6D28D9`, label `#fff`) can produce, so
 * `beforeAll` overwrites `brandColor` for the fixture account;
 * `priorBrandingCaptured` is the actual restore guard (TRUE
 * the moment the read succeeds), the same shape `priorProfileCaptured` is —
 * a `setBranding` that never ran must not be "restored".
 * `client-branding.spec.ts` and `public-form-theme.spec.ts` are the
 * precedents for the import, the signature, and the restore-in-`finally`
 * shape (mirrored here as an `afterAll` guard instead, matching this file's
 * own convention).
 */
let priorBranding: Branding | null = null;
let priorBrandingCaptured = false;

test.beforeAll(async () => {
  const fixture = readFixture();
  if (!fixture) {
    skipReason = "No client fixture — the setup project creates it; run the full suite.";
    return;
  }
  fixtureRef = fixture;
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
  createdFormId = formId;
  // Published, not draft: the lead the widget files lands through the same
  // pipeline the public form uses, and that refuses anything else.
  await updateForm(db, fixture.accountId, formId, { status: "published" }, fixture.clerkUserId);
  priorProfile = await getVoiceProfile(db, fixture.accountId);
  priorProfileCaptured = true;
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

  // A brand colour whose BOTH halves the loader could never produce on its
  // own: #facc15 resolves through `publicFormTheme`, on this fixture's real
  // (warm / round / serif / dark) branding, to
  // `{ accent: "#facc15", accentForeground: "#111111" }` — verified with a
  // throwaway script against the resolver directly — and neither value is
  // the loader's shipped default (background #6D28D9, label #fff). See the
  // "embedded on a client's page" describe block below, assertion 6.
  priorBranding = await getBranding(db, fixture.accountId);
  priorBrandingCaptured = true;
  await setBranding(db, fixture.accountId, { brandColor: "#facc15" }, fixture.clerkUserId);
});

test.afterAll(async () => {
  // Guarded on what `beforeAll` actually READ, not on `widget` — see the note
  // above. `fixtureRef` is set before anything else runs; if `readFixture()`
  // itself found nothing, there is truly nothing to restore.
  if (!fixtureRef) return;
  const fixture = fixtureRef;
  const db = serviceDb();

  // Best effort, in the order the foreign keys allow. The fixture account is
  // deleted wholesale by auth.teardown, but a run killed before that leaves
  // these behind, and a stray enabled concierge on a stray account is exactly
  // the kind of leftover the sweep exists to stop accumulating. Guarded on
  // `createdFormId` rather than `widget`: `createForm` can succeed even when
  // a LATER step (`enableConcierge`) throws.
  if (createdFormId) {
    await db.from("concierge_conversations").delete().eq("account_id", fixture.accountId);
    await db.from("form_submissions").delete().eq("form_id", createdFormId);
    await db.from("forms").delete().eq("id", createdFormId);
  }

  // Branding restore FIRST, on its OWN flag rather than an early return —
  // fix-round-3 review (Minor 1): the profile restore below can throw, and
  // this restore must not sit behind that other state's guard just because
  // ordering happened to make it safe today.
  if (priorBrandingCaptured) {
    await setBranding(db, fixture.accountId, { brandColor: priorBranding!.brandColor }, fixture.clerkUserId);
  }

  if (!priorProfileCaptured) return;
  if (priorProfile) {
    // Every column of the row, named rather than spread, so a column added to
    // `VoiceProfileRow` later shows up here as a typecheck-visible omission
    // instead of silently not being restored. The concierge flags are part of
    // it, which is why `disableConcierge` is not also called.
    const p = priorProfile;
    await upsertVoiceProfile(db, fixture.accountId, {
      persona_name: p.persona_name, greeting_en: p.greeting_en, greeting_es: p.greeting_es,
      facts: p.facts, services: p.services, languages: p.languages,
      booking_enabled: p.booking_enabled, after_hours: p.after_hours, enabled: p.enabled,
      textback_enabled: p.textback_enabled, textback_body: p.textback_body,
      public_id: p.public_id, concierge_enabled: p.concierge_enabled,
      concierge_form_id: p.concierge_form_id,
    }, fixture.clerkUserId);
  } else {
    // There was no profile before this file ran, so the only faithful restore
    // is for there to be none after. `disableConcierge` is deliberately NOT
    // called first: it throws when it matches no row, and there is about to
    // be no row.
    await db.from("voice_profiles").delete().eq("account_id", fixture.accountId);
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

// Item 5 (Branch 2 hardening) — the one render assertion the repo lacked.
// Two JSX mutations in concierge-chat.tsx pass every unit and route test in
// the repo today and would render the wrong sentence quietly: nothing short
// of reading the actual painted DOM catches them. Needs no OPENAI_API_KEY —
// the expired-token path refuses before any model call — so this runs
// wherever the first test above does.
test("an expired render token renders the route's OWN closing sentence, not a hand-typed fixture", async ({ page }) => {
  test.skip(!widget, skipReason);
  const strings = conciergeStrings("en");

  await page.goto(`/c/${widget!.publicId}`);
  await expect(page.getByText(GREETING)).toBeVisible();
  const assistantBefore = await page.locator(".bis-msg-assistant").count();

  // A render token older than MAX_TOKEN_AGE_MS (30 minutes) cannot be minted
  // by the page itself — it always embeds a fresh one at render time
  // (page.tsx's issueRenderToken). Instead, intercept the browser's OWN
  // turn-1 request and swap its token for one signed 31 minutes ago
  // (signRenderToken(nowMs, publicId) — nowMs FIRST), then send the request
  // for REAL through page.request rather than the browser's own fetch, and
  // hand the actual server response back to the intercepted call. That
  // exercises the real route's refusal AND the actual JSX render path
  // together — not a hand-typed fixture that could drift from either.
  await page.route(`**/api/concierge/${widget!.publicId}/turn`, async (route) => {
    const original = route.request().postDataJSON() as Record<string, unknown>;
    const response = await page.request.post(route.request().url(), {
      data: {
        ...original,
        [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 31 * 60_000, widget!.publicId),
      },
    });
    await route.fulfill({ response });
  });

  await page.locator("#bis-concierge-input").fill("hello");
  await page.getByRole("button", { name: strings.send }).click();

  // This is the assertion that would have caught the two JSX mutations the
  // round-3 review named: one that always rendered `strings.ended` regardless
  // of the server's own `closing` sentence, and one that dropped the
  // paragraph's text entirely.
  await expect(page.locator(".bis-concierge-ended")).toHaveText(strings.expired);
  expect(await page.locator(".bis-msg-assistant").count()).toBe(assistantBefore);
});

// The 5a/5b seam (Step 2b) — the ONE test that catches a future JSX
// regression here. `pickTurnUpdate`'s unit tests prove the pure decision;
// nothing short of reading the actual painted DOM proves `send()` actually
// wires `update.notice` into `.bis-concierge-error`. Same interception
// pattern as the expired-token test above, but the swapped-in token is
// signed NOW rather than 31 minutes ago, so `verifyRenderToken` reports
// `elapsedMs` under `MIN_FILL_MS` (2s) — the first-message-too-fast branch,
// not the expired one — and the route answers 200 with
// `{ reply: "", ended: false, closing: strings.tooFast }`. Needs no
// OPENAI_API_KEY: this branch refuses before any model call.
test("a first message that arrives before the page could truly have been read gets the tooFast notice, not silence", async ({ page }) => {
  test.skip(!widget, skipReason);
  const strings = conciergeStrings("en");

  await page.goto(`/c/${widget!.publicId}`);
  await expect(page.getByText(GREETING)).toBeVisible();
  const assistantBefore = await page.locator(".bis-msg-assistant").count();

  await page.route(`**/api/concierge/${widget!.publicId}/turn`, async (route) => {
    const original = route.request().postDataJSON() as Record<string, unknown>;
    const response = await page.request.post(route.request().url(), {
      data: {
        ...original,
        [RENDER_TOKEN_FIELD]: signRenderToken(Date.now(), widget!.publicId),
      },
    });
    await route.fulfill({ response });
  });

  await page.locator("#bis-concierge-input").fill("hello");
  await page.getByRole("button", { name: strings.send }).click();

  // Rendered as a transient notice, NOT the fixed closing paragraph — this
  // is the exact element the 429 path also renders through.
  await expect(page.locator(".bis-concierge-error")).toHaveText(strings.tooFast);
  // Not ended: the composer stays open and the visitor can just send again.
  await expect(page.locator("#bis-concierge-input")).toBeEnabled();
  await expect(page.locator(".bis-concierge-ended")).toHaveCount(0);
  expect(await page.locator(".bis-msg-assistant").count()).toBe(assistantBefore);
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

/**
 * IMPORTANT 2 of the fix-round-2 review: `no_brand_post`, `close_btn_noop`,
 * `no_keydown_effect` and `esc_wrong_key` all ship green today at the unit
 * level — the pure helpers (`shouldCloseOnKey`, `brandMessage`, the loader's
 * own hand-built-fake tests) are tested, but nobody proves the PRODUCER side
 * actually calls them from a real browser against the real `/embed.js`. This
 * block is that proof: a fixture host page serves the real script via
 * `data-concierge`, and every control a visitor would actually touch —
 * launcher, ×, Esc, a stray keystroke, the brand colour — is driven for real.
 *
 * Same fixture, same `beforeAll`/`afterAll` above (including the branding
 * capture/restore) and the same `test.skip(!widget, skipReason)` on every
 * test, rather than a second file that duplicates that 80-line setup/restore
 * discipline. None of these steps sends a turn, so none needs
 * OPENAI_API_KEY.
 */
test.describe("embedded on a client's page", () => {
  const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

  test("a direct link to the chat page renders no close button (IMPORTANT 1)", async ({ page }) => {
    test.skip(!widget, skipReason);
    const strings = conciergeStrings("en");

    await page.goto(`/c/${widget!.publicId}`);
    await expect(page.getByText(GREETING)).toBeVisible();
    // MUTATION (a): remove the `framed` gate around the header row — this
    // FAILS, and a visitor who followed the direct link the snippet card
    // hands out sees a × that posts to a `window.parent` that is itself.
    await expect(page.getByRole("button", { name: strings.close })).toHaveCount(0);
  });

  test(
    "opens from the launcher, resists a stray key, closes on Esc and on its own ×, "
      + "and paints the tenant's own brand colour",
    async ({ page }) => {
      test.skip(!widget, skipReason);
      const strings = conciergeStrings("en");

      // The loader's `event.origin !== origin` check and the chat page's
      // `window.parent !== window` gate both key off the IFRAME's origin
      // (`http://localhost:3000`, from `script.src`), which is real and
      // cross-origin from this host document either way — so what matters is
      // that this page is never itself that origin, not which exact address
      // it sits at.
      //
      // DEVIATION from the brief's first choice: `page.route("http://host.
      // test/**", …)` + `page.goto` puts the host document at a real
      // (unresolvable) address, but this Playwright's Chromium then refuses
      // the embed.js fetch — Private Network Access blocks a "public"
      // address space (host.test, unresolvable) from fetching a script off
      // a "loopback" one (localhost:3000): "the request client is not a
      // secure context and the resource is in more-private address space
      // `loopback`". That is a byproduct of this dev/build server living on
      // localhost, not a real client's, so `page.setContent` is the
      // documented fallback — same fixture markup, no navigation, and the
      // real script tag still runs a real fetch against the real server.
      const body = `<!doctype html><html><head><title>Host</title></head><body>
        <h1>A client's own website</h1>
        <script src="${BASE}/embed.js" data-concierge="${widget!.publicId}"></script>
      </body></html>`;
      await page.setContent(body);

      const launcher = page.getByRole("button", { name: "Chat" });
      const iframeEl = page.locator('iframe[title="Chat"]');
      const frame = page.frameLocator('iframe[title="Chat"]');

      // Step 2: framed, × present.
      await expect(launcher).toBeVisible();
      // Preloaded, hidden — Step 3b of the loader, must stay true before the
      // first click.
      await expect(iframeEl).toBeHidden();
      await launcher.click();
      await expect(iframeEl).toBeVisible();
      await expect(launcher).toHaveAttribute("aria-expanded", "true");
      const closeBtn = frame.getByRole("button", { name: strings.close });
      await expect(closeBtn).toBeVisible();

      // Step 3: a character does not close it. Opening moved focus into the
      // iframe (the loader's own `iframe.focus()`), so this keydown lands in
      // the chat page's own document, where its window listener runs.
      await page.keyboard.type("a");
      // Sink the race before asserting: a fresh `toBeVisible()` retries and
      // can pass on its FIRST poll, before the frame's keydown handler and
      // the host's message handler have necessarily run at all.
      await frame.locator("body").evaluate(() => 0);
      await page.evaluate(() => 0);
      // MUTATION (e): `shouldCloseOnKey` → `!== "Escape"` — this FAILS, and
      // any keystroke while the visitor is typing closes the conversation
      // on them.
      await expect(iframeEl).toBeVisible();
      await expect(launcher).toHaveAttribute("aria-expanded", "true");

      // Step 4: Esc closes. Precondition made explicit: the loader has its
      // OWN host-window Esc listener (embed-script.ts:174-176), so Esc alone
      // would prove that producer rather than the chat page's — asserting
      // focus is inside the iframe first pins which listener is on trial.
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
      await page.keyboard.press("Escape");
      // MUTATION (d): remove the keydown effect in concierge-chat.tsx — this
      // FAILS, and Esc does nothing once focus has moved into the iframe
      // (the host page's OWN Esc listener is dead the moment that happens —
      // see embed-script.ts's own comment on this).
      await expect(iframeEl).toBeHidden();
      await expect(launcher).toHaveAttribute("aria-expanded", "false");

      // Step 5: × closes.
      await launcher.click();
      await expect(iframeEl).toBeVisible();
      await frame.getByRole("button", { name: strings.close }).click();
      // MUTATION (c): make `closeChat` a no-op — this FAILS, and the header
      // close button IMPORTANT 1 just made conditional does nothing once it
      // is actually visible.
      await expect(iframeEl).toBeHidden();

      // Step 6: launcher = tenant accent. The composer's own send button
      // paints from the same `--form-accent` the chat page posts
      // (`bis-concierge-brand`), so it is the ground truth to poll against
      // rather than a literal this fixture's derived colour would have to
      // duplicate (a fixture-equal assertion is this repo's catalogued
      // vacuous shape). Reopen first — the panel was just closed by step 5.
      await launcher.click();
      await expect(iframeEl).toBeVisible();
      const sendBtn = frame.locator(".bis-concierge-composer button[type='submit']");
      const sendBg = hexOf(await sendBtn.evaluate((el) => getComputedStyle(el).backgroundColor));
      const sendColor = hexOf(await sendBtn.evaluate((el) => getComputedStyle(el).color));
      // The fixture's own brand colour (#facc15, set in beforeAll) resolves
      // to a background AND a foreground that both differ from the loader's
      // shipped default (#6D28D9 / #fff) — every "painted value equals
      // measured ground truth" assertion needs a not-the-default guard on
      // EVERY property it compares, not just the first, or the mutation this
      // block exists for can stay invisible on that one property.
      expect(sendBg, "the fixture's brand colour must not be the loader's own default")
        .not.toBe("#6d28d9");
      expect(sendColor, "the fixture's brand label colour must not be the loader's own default label colour")
        .not.toBe("#ffffff");

      // MUTATION (b): remove the `bis-concierge-brand` postMessage effect in
      // concierge-chat.tsx — this FAILS (times out), and the launcher never
      // moves off #6D28D9/#fff no matter how long the poll waits.
      await expect.poll(
        async () => hexOf(await launcher.evaluate((el) => getComputedStyle(el).backgroundColor)),
        { message: "launcher background never picked up the tenant's brand colour" },
      ).toBe(sendBg);
      await expect.poll(
        async () => hexOf(await launcher.evaluate((el) => getComputedStyle(el).color)),
        { message: "launcher label colour never picked up the tenant's brand colour" },
      ).toBe(sendColor);
    },
  );
});
