import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContactRow } from "./contacts-table";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pins the drawer's USE of the summary parser: what its fetch effect stores
 * for a body the parser refuses. `summaryLoadFrom`'s own tests
 * (lib/contacts/summary.test.ts) cannot see the drawer going back to
 * `(await res.json()) as ContactSummary` — this can.
 *
 * No DOM renderer in apps/web, so the effect is captured rather than run by
 * React (the server renderer never runs effects), and `useState` records its
 * setters (the retired 0049 switch's own wiring test used this idiom). The Sheet is
 * stubbed out: the fetch effect lives in ContactDrawer itself, and nothing
 * under the Sheet is what this pins.
 */
const effects: Array<() => void | (() => void)> = [];
const states: { initial: unknown; set: ReturnType<typeof vi.fn> }[] = [];
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => { effects.push(fn); },
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      states.push({ initial, set });
      return [initial, set];
    },
  };
});
vi.mock("@/components/ui/sheet", () => {
  const none = () => null;
  return { Sheet: none, SheetContent: none, SheetDescription: none, SheetHeader: none, SheetTitle: none };
});
vi.mock("./actions", () => ({ updateContactFieldAction: vi.fn() }));
vi.mock("./email-actions", () => ({ stopEmailsAction: vi.fn(), undoStopEmailsAction: vi.fn(), resumeEmailsAction: vi.fn() }));
vi.mock("./[contactId]/actions", () => ({ addTagAction: vi.fn(), removeTagAction: vi.fn() }));

const { ContactDrawer } = await import("./contact-drawer");

const ROW: ContactRow = {
  id: "c1", first_name: "Maria", last_name: "Garcia", email: null, phone: null,
  company_name: null, created_at: "2026-09-01T00:00:00+00:00",
};

const GOOD = {
  tags: [{ id: "t1", name: "vip" }],
  recent: [{ kind: "note", label: "Note", at: "2026-09-01T10:00:00+00:00" }],
  phone_country_unconfirmed: false,
  phone: "+15512345678",
  zone: { zone: "UTC", guessed: false, label: "UTC" },
};

function omit(key: keyof typeof GOOD): Record<string, unknown> {
  const body: Record<string, unknown> = { ...GOOD };
  delete body[key];
  return body;
}

/** Mounts the drawer, runs its fetch effect against `body`, and answers what
 *  the effect stored in `fetched`. */
async function load(body: unknown, ok = true): Promise<unknown> {
  effects.length = 0;
  states.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));
  renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
  // `fetched` is the one piece of state that starts at null (`retryNonce`
  // starts at 0) — found by starting value, not hook order.
  const fetched = states.filter((s) => s.initial === null);
  expect(fetched).toHaveLength(1);
  // Three effects since consent chain PR-3: the summary fetch (declared
  // first, effects[0], the one this helper drives), the Texts row's own
  // fetch (effects[1], driven by its own describe block below) and the Email
  // row's own fetch (effects[2], consent PR-3).
  expect(effects).toHaveLength(3);
  effects[0]!();
  await vi.waitFor(() => expect(fetched[0]!.set).toHaveBeenCalled());
  expect(fetched[0]!.set).toHaveBeenCalledTimes(1);
  return fetched[0]!.set.mock.calls[0]![0];
}

// A spy, not fake timers: `vi.waitFor` advances faked timers by its poll
// interval, which would move a faked Date under the assertion.
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ContactDrawer: the summary body is parsed, not cast", () => {
  it("a body without tags stores the error state, not a summary that would throw in render", async () => {
    expect(await load(omit("tags"))).toEqual({ contactId: "c1", result: { status: "error" } });
  });

  it("a good body stores the PARSED summary, extra keys dropped, with the clock read in the callback", async () => {
    expect(await load({ ...GOOD, timezone: "UTC" })).toEqual({
      contactId: "c1", result: { status: "ready", summary: GOOD, nowMs: 1_700_000_000_000 },
    });
  });

  it("a body from before #124 (no zone) is still ready, with zone undefined", async () => {
    const stored = await load(omit("zone")) as { result: { status: string; summary: { zone?: unknown } } };
    expect(stored.result.status).toBe("ready");
    expect(stored.result.summary.zone).toBeUndefined();
  });

  it("a non-OK response stores the error state, even with a body that would parse", async () => {
    expect(await load(GOOD, false)).toEqual({ contactId: "c1", result: { status: "error" } });
  });

  it("a recent item of a kind this bundle does not know is dropped, and the rest still loads", async () => {
    const body = { ...GOOD, recent: [{ kind: "booking", label: "Booked", at: "2026-09-02T10:00:00+00:00" }, ...GOOD.recent] };
    expect(await load(body)).toEqual({
      contactId: "c1", result: { status: "ready", summary: GOOD, nowMs: 1_700_000_000_000 },
    });
  });
});

/**
 * The effect's cleanup (the contact changed, or a retry refired the fetch)
 * must stop THIS fetch writing, including when the response has already
 * landed and only its body is still being read. Otherwise a switched-away
 * contact's result overwrites the current one, or an older retry's body
 * overwrites a newer one.
 */
describe("ContactDrawer: a fetch cleaned up while its body is still being read never writes", () => {
  /** Mounts the drawer, runs its effect, and waits until the response's
   *  `json()` has been CALLED, i.e. the callback is past any check made
   *  before the body is read. Settling `json()` is left to the test. */
  async function mountPendingBody() {
    effects.length = 0;
    states.length = 0;
    let settle!: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
    const json = vi.fn(() => new Promise<unknown>((resolve, reject) => { settle = { resolve, reject }; }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json })));
    renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
    const fetched = states.filter((s) => s.initial === null);
    expect(fetched).toHaveLength(1);
    // Three effects since consent chain PR-3 (see `load()`'s own comment above).
    expect(effects).toHaveLength(3);
    const cleanup = effects[0]!();
    expect(typeof cleanup).toBe("function");
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    return { set: fetched[0]!.set, cleanup: cleanup as () => void, settle };
  }

  /** Enough macrotask turns for fetch → then → json → parse → setFetched
   *  (and the .catch hop) to have run. The control below proves this flush
   *  is enough to see a write that happens. */
  async function flush() {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  }

  it("control: with no cleanup, the same flush sees the write", async () => {
    const { set, settle } = await mountPendingBody();
    expect(set).not.toHaveBeenCalled();
    settle.resolve(GOOD);
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("a body that parses after the cleanup is not stored", async () => {
    const { set, cleanup, settle } = await mountPendingBody();
    cleanup();
    settle.resolve(GOOD);
    await flush();
    expect(set).not.toHaveBeenCalled();
  });

  it("a body that fails to read after the cleanup does not store the error state either", async () => {
    const { set, cleanup, settle } = await mountPendingBody();
    cleanup();
    settle.reject(new SyntaxError("Unexpected token < in JSON"));
    await flush();
    expect(set).not.toHaveBeenCalled();
  });
});

/**
 * Fix round 1 #5: `effects[1]` — the Texts row's own fetch effect, added by
 * consent chain PR-2 alongside the summary's — driven directly, the same
 * shape as `load()` above but against the state shaped
 * `{ contactId, load: { status } }` rather than the summary's `null`.
 */
describe("ContactDrawer: the Texts row's own fetch effect (effects[1])", () => {
  const LOADING_SHAPE = JSON.stringify({ contactId: "", load: { status: "loading" } });
  const GOOD_TEXTS = { view: { kind: "allowed", newestId: null }, zone: "America/Chicago", phone: "+15512345678" };

  /** Mounts the drawer and runs ITS texts effect against `body`; answers
   *  what it stored on the one state shaped like `{ contactId, load }`. */
  async function loadTexts(body: unknown, ok = true): Promise<unknown> {
    effects.length = 0;
    states.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));
    renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
    const texts = states.filter((s) => JSON.stringify(s.initial) === LOADING_SHAPE);
    expect(texts).toHaveLength(1);
    expect(effects).toHaveLength(3);
    effects[1]!();
    await vi.waitFor(() => expect(texts[0]!.set).toHaveBeenCalled());
    expect(texts[0]!.set).toHaveBeenCalledTimes(1);
    return texts[0]!.set.mock.calls[0]![0];
  }

  it("a good body stores the ready state", async () => {
    expect(await loadTexts(GOOD_TEXTS)).toEqual({ contactId: "c1", load: { status: "ready", ...GOOD_TEXTS } });
  });

  it("a non-OK response stores the error state, even with a body that would parse", async () => {
    expect(await loadTexts(GOOD_TEXTS, false)).toEqual({ contactId: "c1", load: { status: "error" } });
  });

  it("a rejected fetch (network failure) stores the error state too (mutation: swallow the catch → the answer never arrives, FAILS)", async () => {
    effects.length = 0;
    states.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
    const texts = states.filter((s) => JSON.stringify(s.initial) === LOADING_SHAPE);
    effects[1]!();
    await vi.waitFor(() => expect(texts[0]!.set).toHaveBeenCalled());
    expect(texts[0]!.set).toHaveBeenCalledWith({ contactId: "c1", load: { status: "error" } });
  });

  it("a stale answer (cleanup ran first) is ignored, never written", async () => {
    effects.length = 0;
    states.length = 0;
    let settle!: (v: unknown) => void;
    const json = vi.fn(() => new Promise<unknown>((resolve) => { settle = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json })));
    renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
    const texts = states.filter((s) => JSON.stringify(s.initial) === LOADING_SHAPE);
    const cleanup = effects[1]!();
    expect(typeof cleanup).toBe("function");
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    (cleanup as () => void)();
    settle(GOOD_TEXTS);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(texts[0]!.set).not.toHaveBeenCalled();
  });
});

/**
 * Review R3-I2: the Check number row must follow the number, not its first
 * render. Source pins (no DOM renderer here); the e2e spec proves the
 * behaviour in a browser.
 */
describe("the Texts row follows the contact (consent chain PR-2)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const panel = strip(readFileSync(path.join(here, "[contactId]", "contact-fields-panel.tsx"), "utf8"));
  const row = strip(readFileSync(path.join(here, "texts-row.tsx"), "utf8"));

  it("the drawer reads the Texts row on its own, again on every summary re-read: a phone save, a pick, an Undo (mutation: drop retryNonce from the texts effect's deps → FAILS)", () => {
    expect(drawer).toMatch(/\/texts`\)[\s\S]{0,900}?\}, \[accountId, contactId, retryNonce\]\);/);
  });

  it("the drawer re-reads its summary after a phone save (mutation: drop the nonce bump → FAILS)", () => {
    expect(drawer).toMatch(/if \(field === "phone"\) setRetryNonce\(\(n\) => n \+ 1\);/);
  });

  it("a row action or a pick makes the drawer re-read, and the row hands onChanged to the pick (re-review minor 1; mutation: drop the onChanged prop, or stop passing it to pickPhoneCountry → FAILS)", () => {
    expect(drawer).toMatch(/<TextsRow[\s\S]{0,400}?onChanged=\{\(\) => setRetryNonce\(\(n\) => n \+ 1\)\}/);
    expect(row).toMatch(/run,\s*onChanged,\s*\)\);/);
  });

  it("the full page hands the row the page's own Texts load and refreshes on change (mutation: pass a constant load → FAILS)", () => {
    expect(panel).toMatch(/<TextsRow[\s\S]{0,300}?load=\{texts\}/);
    expect(panel).toMatch(/onChanged=\{\(\) => router\.refresh\(\)\}/);
  });

  it("the drawer reads the Email row on its own and renders it under the Texts row, and no longer renders the 0049 switch (consent PR-3; mutation: keep MarketingOptOutSwitch → FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./contact-drawer.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/fetch\(`\/api\/accounts\/\$\{accountId\}\/contacts\/\$\{contactId\}\/email`\)/);
    expect(src.indexOf("<EmailRow")).toBeGreaterThan(src.indexOf("<TextsRow"));
    expect(src).not.toMatch(/MarketingOptOutSwitch|marketing_email_opted_out_at/);
  });
});

/**
 * Coordinator review of the first version (I1/C1): the inline phone Undo is
 * server-authoritative — the SAVE hands back what the server itself read and
 * wrote (`PhoneInlineUndo`), never a value the client captures. Source pins
 * for the three wiring sites and the post-Undo nonce bump.
 */
describe("the inline phone Undo is server-authoritative", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const inlineField = strip(readFileSync(path.join(here, "..", "..", "..", "..", "..", "..", "components", "inline-field.tsx"), "utf8"));
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const panel = strip(readFileSync(path.join(here, "[contactId]", "contact-fields-panel.tsx"), "utf8"));

  it("inline-field.tsx hands the SAVE's own undo payload to commitInlineUndo, never a client-captured flag (mutation: capture phoneUnconfirmed client-side again → FAILS)", () => {
    expect(inlineField).toContain("const phoneUndo = result.undo;");
    expect(inlineField).toMatch(/commitInlineUndo\(field, prior, phoneUndo, save, undoPhone\)/);
    expect(inlineField).not.toMatch(/phoneUnconfirmed/);
  });

  /** #9: the phone field's `undoable` is "did the save hand back a
   *  payload", never the generic "does the prior value pass validation" —
   *  offering Undo without a payload is offering a button whose only
   *  possible outcome is commitInlineUndo's own "failed" refusal. */
  it("inline-field.tsx's phone undoable check is 'has a payload', never the generic prior-validates check (mutation: undoable = normalize(prior).ok for phone too → FAILS)", () => {
    expect(inlineField).toContain('const undoable = field === "phone" ? phoneUndo !== undefined : normalize(prior).ok;');
  });

  it("the drawer's phone Undo calls the dedicated action and bumps retryNonce on success (mutation: drop the nonce bump after Undo → FAILS)", () => {
    expect(drawer).toMatch(/undoPhone: async \(undo: PhoneInlineUndo\) => \{\s*const r = await undoInlinePhoneEditAction\(accountId, row\.id, undo\);\s*[\s\S]*?if \(r\.ok\) setRetryNonce\(\(n\) => n \+ 1\);\s*return r;\s*\}/);
  });

  it("the panel's phone Undo calls the dedicated action too", () => {
    expect(panel).toMatch(/undoPhone: \(undo: PhoneInlineUndo\) => undoInlinePhoneEditAction\(accountId, contactId, undo\)/);
  });

  /**
   * #24/#25: the prior pins only checked `undoPhone:` EXISTS somewhere in
   * the file — `field === "phone"` flipped to `false` (so `undoPhone` is
   * NEVER actually attached to any field's props) left them green. These
   * anchor the guard and the prop in ONE match, so severing that link is
   * what fails them.
   */
  it("the drawer attaches undoPhone to InlineField ONLY when field is phone (mutation: field === \"phone\" → false → FAILS)", () => {
    expect(drawer).toMatch(/\{\.\.\.\(field === "phone" \? \{\s*undoPhone: async \(undo: PhoneInlineUndo\)/);
  });

  it("the panel attaches undoPhone to InlineField ONLY when field is phone (mutation: field === \"phone\" → false → FAILS)", () => {
    expect(panel).toMatch(/\{\.\.\.\(field === "phone" \? \{\s*undoPhone: \(undo: PhoneInlineUndo\)/);
  });
});

/**
 * Round 4, review I3: the wiring that gets `seenPhone` to the pick at all —
 * three probes (the row sending `""`, the drawer sending `row.phone` or
 * `""`, the panel sending `""`) survived round 3's runtime tests because
 * none of them exercise the ROW itself with a real `phone` prop distinct
 * from `""`/`row.phone`. Source pins close that gap.
 */
describe("the pick is judged against the phone the operator SAW (review I3, round 4)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const row = strip(readFileSync(path.join(here, "texts-row.tsx"), "utf8"));
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const page = strip(readFileSync(path.join(here, "[contactId]", "page.tsx"), "utf8"));

  it("the row passes ITS OWN phone to setPhoneCountryAction, never a literal \"\" (mutation: setPhoneCountryAction(accountId, contactId, c) → FAILS)", () => {
    expect(row).toContain("setPhoneCountryAction(accountId, contactId, c, phone)");
  });

  it("that phone is the one the server read with the view (the Texts load), never the peek stub row.phone (mutation: phone={row.phone ?? \"\"} → FAILS)", () => {
    expect(row).toContain('const phone = load.phone ?? "";');
    expect(drawer).not.toMatch(/<TextsRow[\s\S]{0,400}?row\.phone/);
  });

  it("the full page's load carries the real contact record's phone (mutation: phone: null → FAILS)", () => {
    expect(page).toContain("phone: contact.phone ?? null");
  });
});
