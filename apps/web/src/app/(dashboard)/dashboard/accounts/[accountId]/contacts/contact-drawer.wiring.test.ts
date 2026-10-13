import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContactRow } from "./contacts-table";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pins the drawer's USE of the summary parser (`lib/contacts/drawer-summary.ts`, S-03 part 3):
 * what its fetch effect stores for a body the parser refuses, and how the drawer draws each
 * section's load. `drawerLoadFrom`'s own tests cannot see the drawer going back to
 * `(await res.json()) as DrawerSummary`; this can.
 *
 * No DOM renderer in apps/web, so the effect is captured rather than run by
 * React (the server renderer never runs effects), and `useState` records its
 * setters (the retired 0049 switch's own wiring test used this idiom). The Sheet is
 * stubbed: closed by default (the fetch effect lives in ContactDrawer itself), opened by
 * the harness for the blocks that read what the drawer draws.
 */
const effects: Array<() => void | (() => void)> = [];
const states: { initial: unknown; set: ReturnType<typeof vi.fn> }[] = [];
/**
 * Opt-in for the blocks that must reach a given load: when set, the `fetched` state (the drawer's
 * first state starting at null) answers this value instead of null, and the Sheet renders its
 * children. Every other block leaves both off.
 */
const harness: { readyFetched: unknown; openSheet: boolean } = { readyFetched: undefined, openSheet: false };
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => { effects.push(fn); },
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      const firstNull = initial === null && !states.some((s) => s.initial === null);
      states.push({ initial, set });
      return [firstNull && harness.readyFetched !== undefined ? harness.readyFetched : initial, set];
    },
  };
});
vi.mock("@/components/ui/sheet", () => {
  const pass = ({ children }: { children?: unknown }) => (harness.openSheet ? children : null);
  const none = () => null;
  // SheetTitle passes its child through: the header's h2 is wrapped by it (wrapHeading), and must render.
  return { Sheet: pass, SheetContent: pass, SheetDescription: none, SheetHeader: pass, SheetTitle: pass };
});
// RecordSection's boundary and the facts' Try again read the router; there is no app router here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Recorded, not run: the body's locale is what the drawer hands its provider (C1).
const localeProps: unknown[] = [];
vi.mock("@/components/locale-provider", () => ({
  useLocale: () => "en",
  LocaleProvider: (p: { locale: unknown; children?: unknown }) => { localeProps.push(p.locale); return p.children; },
}));
const nextUpProps: unknown[] = [];
vi.mock("./[contactId]/next-up-card", () => ({ NextUpBody: (p: unknown) => { nextUpProps.push(p); return null; } }));
vi.mock("./actions", () => ({ updateContactFieldAction: vi.fn(), undoInlinePhoneEditAction: vi.fn(), setContactBusinessAction: vi.fn(), undoContactBusinessAction: vi.fn(), setContactLanguageAction: vi.fn(), restoreContactLanguageAction: vi.fn(), keepContactLanguageHintAction: vi.fn() }));
vi.mock("./email-actions", () => ({ stopEmailsAction: vi.fn(), undoStopEmailsAction: vi.fn(), resumeEmailsAction: vi.fn() }));
vi.mock("./[contactId]/actions", () => ({ addTagAction: vi.fn(), removeTagAction: vi.fn() }));

const { ContactDrawer } = await import("./contact-drawer");

const ROW: ContactRow = {
  id: "c1", first_name: "Maria", last_name: "Garcia", email: null, phone: null,
  company_name: null, created_at: "2026-09-01T00:00:00+00:00",
};

const GOOD = {
  locale: "en",
  header: { name: "Maria Garcia", subtitle: null, subtitleHref: null, actions: [
    { id: "call", label: "Call", href: "tel:+15512345678", ariaLabel: "Call Maria Garcia", primary: true, external: false },
  ] },
  facts: { status: "error", text: "Couldn't load the summary." },
  nextUp: { status: "ready", view: { rows: [], undated: null }, emptyText: "Nothing coming up." },
  recent: { status: "ready", rows: [
    { key: "note-n1", kind: "note", mark: { kind: "person", label: "You" }, verb: "added a note", status: null, detail: null,
      time: "Sep 1, 2026, 5:00 AM", dateTime: "2026-09-01T10:00:00+00:00", excerpt: { text: "Prefers mornings", lang: "", done: false } },
    { key: "booking-b1", kind: "booking", mark: { kind: "customer", label: "Customer" }, verb: "booked an appointment for Fri, Oct 16, 10:00 AM",
      status: { tone: "accent", word: "Booked" }, detail: null, time: "Aug 30, 2026, 5:00 AM", dateTime: "2026-08-30T10:00:00+00:00", excerpt: null },
  ], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline" },
  who: { source: null, sourceHint: null, assignedTo: null,
    fields: { first_name: "Maria", last_name: "Garcia", email: null, phone: null, company_name: null },
    tags: { status: "ready", tags: [{ id: "t1", name: "vip" }] },
    language: { value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null } },
};
const PARSED = { ...GOOD, who: { status: "ready", ...GOOD.who } };

function omit(key: keyof typeof GOOD): Record<string, unknown> {
  const body: Record<string, unknown> = JSON.parse(JSON.stringify(GOOD));
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

describe("ContactDrawer: the summary body is parsed, one section at a time (S-03 part 3 §7.4)", () => {
  it("a body without a header stores the whole drawer's error (mutation: cast the body -> FAILS)", async () => {
    expect(await load(omit("header"))).toEqual({ contactId: "c1", result: { status: "error" } });
  });
  it("a good body stores the PARSED body, extra keys dropped", async () => {
    expect(await load({ ...JSON.parse(JSON.stringify(GOOD)), zone: "UTC" })).toEqual({ contactId: "c1", result: { status: "ready", body: PARSED } });
  });
  it("a non-OK response stores the error state, even with a body that would parse", async () => {
    expect(await load(GOOD, false)).toEqual({ contactId: "c1", result: { status: "error" } });
  });
  it("a malformed Recent is Recent's error only; the rest still load (mutation: refuse the body -> FAILS)", async () => {
    const body = { ...JSON.parse(JSON.stringify(GOOD)), recent: { status: "ready", rows: 3 } };
    const stored = await load(body) as { result: { status: string; body: { recent: { status: string }; nextUp: { status: string } } } };
    expect(stored.result.status).toBe("ready");
    expect([stored.result.body.recent.status, stored.result.body.nextUp.status]).toEqual(["error", "ready"]);
  });
});

describe("ContactDrawer: the fetch URL (C9)", () => {
  async function fetchedUrl(search: string | null): Promise<string> {
    effects.length = 0;
    states.length = 0;
    if (search !== null) vi.stubGlobal("window", { location: { search } });
    const f = vi.fn(async () => ({ ok: true, json: async () => GOOD }));
    vi.stubGlobal("fetch", f);
    renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
    effects[0]!();
    // `vi.fn` with no parameters types its calls as `[]`; the URL is the call's first argument.
    return (f.mock.calls[0] as unknown[])[0] as string;
  }
  it("today's exact path with no ?locale= on the list (mutation: always append -> e2e's route glob stops matching, FAILS)", async () => {
    expect(await fetchedUrl(null)).toBe("/api/accounts/a1/contacts/c1/summary");
    expect(await fetchedUrl("?q=Retry&peek=c1")).toBe("/api/accounts/a1/contacts/c1/summary");
  });
  it("the list's QA locale rides along (mutation: drop it -> the pseudo overflow check measures English, FAILS)", async () => {
    expect(await fetchedUrl("?peek=c1&locale=pseudo")).toBe("/api/accounts/a1/contacts/c1/summary?locale=pseudo");
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

  it("a name or email save re-reads the route so the header follows (mutation: drop the bump → FAILS)", () => {
    expect(drawer).toMatch(
      /if \(saved\.ok && \(field === "first_name" \|\| field === "last_name" \|\| field === "email"\)\) setRetryNonce\(\(n\) => n \+ 1\);/,
    );
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

  it("inline-field.tsx hands the SAVE's own undo payload to the Undo planner, never a client-captured flag (mutation: capture phoneUnconfirmed client-side again → FAILS)", () => {
    // S-02 Task 3c moved the Undo decision into planInlineUndo
    // (lib/contacts/inline-save.ts); the component still hands it THIS
    // save's own payload, and the planner routes phone to commitInlineUndo.
    expect(inlineField).toMatch(/planInlineUndo\(\{[^}]*phoneUndo: result\.undo,/);
    expect(inlineField).not.toMatch(/phoneUnconfirmed/);
  });

  /** #9: the phone field's Undo is offered when "the save handed back a
   *  payload", never the generic "does the prior value pass validation" —
   *  offering Undo without a payload is offering a button whose only
   *  possible outcome is commitInlineUndo's own "failed" refusal. Since
   *  S-02 Task 3c that rule is pinned BY BEHAVIOUR in inline-save.test.ts
   *  ("phone with no payload offers no Undo, even when the prior
   *  validates"); here, the component offers Undo only when one is planned. */
  it("inline-field.tsx offers Undo only when planInlineUndo planned one (the phone rule itself: inline-save.test.ts)", () => {
    expect(inlineField).toMatch(/const undo = planInlineUndo\(/);
    expect(inlineField).toMatch(/action: undo\s*\?/);
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

/**
 * Review round 1, I4: nothing proved the Source line's two props actually
 * come from the summary/contact read rather than a stubbed-out literal.
 * `renderToStaticMarkup` under THIS file's own `useState`/`useEffect`
 * interceptor (see `load()` above) can never reach the drawer's "ready"
 * branch — the mock never actually re-renders after an effect's `set` call
 * — so the drawer's half has to be a source pin, the same tool this file
 * already uses for the Texts/Email row wiring above. The full page's half
 * is proven by a REAL render instead (page.test.ts), since
 * `ContactFieldsPanel` takes `contact` as a synchronous prop with no fetch
 * of its own to dodge.
 */
describe("the Source line's props come from the real read, not a stub (review round 1, I4)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const panel = strip(readFileSync(path.join(here, "[contactId]", "contact-fields-panel.tsx"), "utf8"));

  it("the drawer passes the route's own source/sourceHint, never a literal null (mutation: source={null} sourceHint={null} → FAILS)", () => {
    expect(drawer).toMatch(/<SourceField[\s\S]{0,250}?source=\{who\.source\}[\s\S]{0,150}?sourceHint=\{who\.sourceHint\}/);
  });

  it("the full page passes the real contact's source and the computed hint, never a literal null (mutation: source={null} sourceHint={null} → FAILS)", () => {
    expect(panel).toMatch(/<SourceField[\s\S]{0,250}?source=\{contact\.source \?\? null\}[\s\S]{0,150}?sourceHint=\{sourceHint\}/);
  });

  it("the drawer keys SourceField by contact id, like FIELDS' own rows (mutation: drop the key → a contact switch could reuse InlineField's stale edit state, FAILS)", () => {
    expect(drawer).toMatch(/<SourceField\s+key=\{row\.id\}/);
  });
});

/**
 * F-085 part 1 (spec §9): the drawer's "Assigned to" line. The drawer's
 * ready branch cannot be reached under this file's useState interceptor (see
 * the Source line's block above), so the drawer's half is a source pin; the
 * save itself (assignContactsAction(acct, [contactId], next), and its Undo
 * through undoAssignContactsAction with the returned array whole) is run for
 * real in components/assign/assign.test.ts, and ContactAssigneeField's use
 * of it is pinned there.
 */
describe("the drawer's Assigned to line (F-085)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const table = strip(readFileSync(path.join(here, "contacts-table.tsx"), "utf8"));

  it("renders ContactAssigneeField for THIS contact with the route's holder, the team as options, and readOnly = !canAssign (mutation: readOnly={false} -> FAILS)", () => {
    expect(drawer).toMatch(/<ContactAssigneeField[\s\S]{0,300}?contactId=\{row\.id\}[\s\S]{0,200}?value=\{who\.assignedTo\}[\s\S]{0,200}?options=\{members\}[\s\S]{0,200}?readOnly=\{!canAssign\}/);
  });

  it("sits in the 92px label column, labelled 'Assigned to', and only when the server said who holds the customer (mutation: render it for an undefined holder -> FAILS)", () => {
    expect(drawer).toMatch(/who\.assignedTo !== undefined \? \(\s*<div className="grid grid-cols-\[92px_minmax\(0,1fr\)\][^"]*"[^>]*>\s*<dt[^>]*>\{t\(m, "assign\.field\.label", locale\)\}<\/dt>/);
  });

  it("the table hands the drawer and the bulk bar canAssign and the team (mutation: drop either prop -> FAILS)", () => {
    expect(table).toMatch(/<BulkActionBar[\s\S]{0,400}?canAssign=\{canAssign\}[\s\S]{0,100}?members=\{members\}/);
    expect(table).toMatch(/<ContactDrawer[\s\S]{0,400}?canAssign=\{canAssign\}[\s\S]{0,100}?members=\{members\}/);
  });

  it("the drawer hands the field the viewer's own person, and the table hands it to the drawer (fix round 1, I1; mutation: drop either -> FAILS)", () => {
    expect(drawer).toMatch(/<ContactAssigneeField[\s\S]{0,400}?viewerId=\{viewerId\}/);
    expect(table).toMatch(/<ContactDrawer[\s\S]{0,500}?viewerId=\{viewerId\}/);
  });

  it("an unauthorised default: with no canAssign passed the drawer is read-only (mutation: default canAssign to true -> FAILS)", () => {
    expect(drawer).toMatch(/accountId, row, onClose, canAssign = false, members = \[\],/);
    expect(table).toMatch(/canAssign = false,\s*members = \[\],/);
  });
});

/** Renders the drawer with the Sheet open and `fetched` as its load (undefined: still loading). */
function renderOpen(fetched: unknown, row: ContactRow = ROW): string {
  effects.length = 0;
  states.length = 0;
  harness.readyFetched = fetched;
  harness.openSheet = true;
  return renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row, onClose: () => {} }));
}
/** The element tree the drawer returns when CALLED (not rendered), so its props can be read. */
function treeOf(fetched: unknown) {
  effects.length = 0;
  states.length = 0;
  harness.readyFetched = fetched;
  harness.openSheet = true;
  const found: { type: unknown; props: Record<string, unknown> }[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!isValidElement(n)) return;
    const el = n as unknown as { type: unknown; props: Record<string, unknown> };
    found.push(el);
    walk(el.props.children);
  };
  walk(ContactDrawer({ accountId: "a1", row: ROW, onClose: () => {} }));
  return found;
}
const READY = { contactId: "c1", result: { status: "ready", body: PARSED } };
const drawerSrc = () => readFileSync(fileURLToPath(new URL("./contact-drawer.tsx", import.meta.url)), "utf8");

describe("ContactDrawer on the record kit (S-03 part 3)", () => {
  afterEach(() => { harness.readyFetched = undefined; harness.openSheet = false; nextUpProps.length = 0; });

  it("Groups, Properties and Related people have left the drawer (D7; mutation: keep one -> FAILS)", () => {
    expect(drawerSrc()).not.toMatch(/GroupsCard|PlacesCard|RelationshipsCard/);
  });

  it("the sections in the spec's order: facts, Next up, Recent, who they are, then the way to the full record (§9; mutation: move Recent below who -> FAILS)", () => {
    const src = drawerSrc();
    const order = ["facts", "next-up", "recent", "who"].map((id) => src.indexOf(`data-drawer-section="${id}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(src.indexOf('"drawer.moreOnRecord"')).toBeGreaterThan(order[3]!);
  });

  it("Next up has no Add a To-do: there is no composer in the drawer (D4; mutation: pass the label -> FAILS)", () => {
    renderOpen(READY);
    expect(nextUpProps).toHaveLength(1);
    expect((nextUpProps[0] as { addTodoLabel: unknown }).addTodoLabel).toBeNull();
  });

  it("a section's Try again re-reads without blanking the drawer (C3; mutation: setFetched(null) first -> FAILS)", async () => {
    const { RecordSection } = await import("@/components/record/record-section");
    const facts = treeOf(READY).find((e) => e.type === RecordSection && e.props.id === "facts");
    expect(facts?.props.state).toBe("error");
    const nonce = states.filter((s) => s.initial === 0);
    const fetched = states.filter((s) => s.initial === null);
    expect([nonce.length, fetched.length]).toEqual([1, 1]);
    (facts!.props.onRetry as () => void)();
    expect(nonce[0]!.set).toHaveBeenCalledTimes(1);
    expect(fetched[0]!.set).not.toHaveBeenCalled();
  });

  it("the body is wrapped in a provider of the BODY's locale, not the page's (C1; mutation: wrap with useLocale() -> FAILS)", async () => {
    const { LocaleProvider } = await import("@/components/locale-provider");
    const tree = treeOf({ contactId: "c1", result: { status: "ready", body: { ...PARSED, locale: "es" } } });
    expect(tree.find((e) => e.type === LocaleProvider)?.props.locale).toBe("es");
    expect(tree.find((e) => e.props.lang === "es")).toBeDefined();
  });

  it("each recent row is a marked TimelineItem with the e2e's hook, and See all opens the record's timeline (C10, D5; mutation: drop the testid -> FAILS)", () => {
    const html = renderOpen(READY);
    expect(html.match(/data-testid="drawer-recent-item"/g)).toHaveLength(2);
    expect(html).toMatch(/data-testid="drawer-recent-item"[\s\S]*?data-author-mark="customer"/);
    expect(html).toContain('href="/dashboard/accounts/a1/contacts/c1#record-timeline"');
    expect(html).toMatch(/<p lang=""[^>]*>Prefers mornings<\/p>/);
  });

  it("the header is the route's: Call the only primary, the name an h2 (D2; mutation: render the list row's name -> FAILS)", () => {
    const html = renderOpen({ contactId: "c1", result: { status: "ready", body: { ...PARSED, header: { ...PARSED.header, name: "Maria G. Garcia" } } } });
    expect(html).toMatch(/<h2[^>]*>Maria G\. Garcia<\/h2>/);
    const header = html.slice(html.indexOf("data-record-header"), html.indexOf("data-drawer-section"));
    expect(header.match(/data-variant="default"/g)).toHaveLength(1);
    expect(header).toMatch(/data-variant="default"[^>]*data-record-action="call"|data-record-action="call"[^>]*data-variant="default"/);
  });

  it("while loading, every section is a skeleton carrying the e2e's hook (rule 7, C10; mutation: drop the hook from a section -> FAILS)", () => {
    const html = renderOpen(undefined);
    expect((html.match(/data-testid="drawer-skeleton"/g) ?? []).length).toBe(6);
    expect(html).toMatch(/data-drawer-section="recent" data-state="loading"/);
  });

  it("a ?peek= stub row shows skeleton fields until the route's arrive (Q1; mutation: render the stub's blanks -> FAILS)", () => {
    const stub = { ...ROW, first_name: null, last_name: null, created_at: "" };
    expect(renderOpen(undefined, stub)).toContain("data-drawer-fields-skeleton");
    const ready = renderOpen(READY, stub);
    expect(ready).not.toContain("data-drawer-fields-skeleton");
    expect(ready).toMatch(/First name: Maria/);
  });

  it("a ?peek= stub row whose route answered without its fields shows the who section's error and Try again, never skeletons forever (M6; mutation: draw skeletons whenever the fields row is null -> FAILS)", () => {
    const stub = { ...ROW, first_name: null, last_name: null, created_at: "" };
    const whoFailed = renderOpen({ contactId: "c1", result: { status: "ready", body: { ...PARSED, who: { status: "error", text: "Couldn't load Contact Details." } } } }, stub);
    expect(whoFailed).not.toContain("data-drawer-fields-skeleton");
    expect(whoFailed).toMatch(/data-drawer-who-error[^>]*>[\s\S]*?Couldn&#x27;t load Contact Details\.[\s\S]*?Try again/);
    // Said once: the error in place of the fields is the who section's one error, not a second below it.
    expect(whoFailed.match(/data-drawer-who-error/g)).toHaveLength(1);
    // The whole drawer's error: the stub's fields never arrive either, so they say so too.
    const loadFailed = renderOpen({ contactId: "c1", result: { status: "error" } }, stub);
    expect(loadFailed).not.toContain("data-drawer-fields-skeleton");
    expect(loadFailed).toContain("data-drawer-who-error");
  });
});

/** Task 6 review: each section's own branches, the pairing guard, the rules between sections, Esc. */
describe("ContactDrawer: every section's own state, and the chrome around them (Task 6 review)", () => {
  afterEach(() => { harness.readyFetched = undefined; harness.openSheet = false; nextUpProps.length = 0; });
  const ready = (body: unknown) => ({ contactId: "c1", result: { status: "ready", body } });
  const WHO_ERR = { ...PARSED, who: { status: "error", text: "Couldn't load Contact Details." } };
  const TAGS_ERR = { ...PARSED, who: { ...PARSED.who, tags: { status: "error" } } };
  const FACTS_MISSING = { ...PARSED, facts: { status: "ready", view: { line: ["On your list since Sep 2026"], missing: "Couldn't count bookings.", allFailed: false } } };
  const RECENT_PARTIAL = { ...PARSED, recent: { ...PARSED.recent, failedText: "Couldn't load the calls." } };
  const RECENT_EMPTY = { ...PARSED, recent: { ...PARSED.recent, rows: [], emptyText: "Nothing here yet." } };

  it("I1: a --line rule sits between sections, never above the first (mutation: drop the wrapper's rule -> FAILS)", () => {
    const html = renderOpen(READY);
    const wrappers = [...html.matchAll(/<div data-drawer-section="([\w-]+)"[^>]*class="([^"]*)"/g)].map((x) => ({ id: x[1], cls: x[2]!.split(/\s+/) }));
    expect(wrappers.map((w) => w.id)).toEqual(["facts", "next-up", "recent", "who"]);
    for (const w of wrappers) expect(w.cls).toEqual(expect.arrayContaining(["border-t", "border-[var(--line)]", "pt-3", "first:border-t-0", "first:pt-0"]));
    // The first wrapper is the scroller's first child, so `first:` drops its rule; the rest are not, so they keep it.
    expect(html).toMatch(/data-testid="drawer-scroll"[^>]*><div data-drawer-section="facts"/);
  });

  it("I2: a body fetched for another contact is never shown: skeletons and the row's own name (mutation: drop the contactId pairing -> FAILS)", () => {
    const other = { ...PARSED, header: { ...PARSED.header, name: "Somebody Else" }, who: { ...PARSED.who, tags: { status: "ready", tags: [{ id: "t0", name: "c0-only-tag" }] } } };
    const html = renderOpen({ contactId: "c0", result: { status: "ready", body: other } });
    expect(html).not.toContain("Somebody Else");
    expect(html).not.toContain("c0-only-tag");
    expect(html).toMatch(/<h2[^>]*>Maria Garcia<\/h2>/);
    expect((html.match(/data-testid="drawer-skeleton"/g) ?? []).length).toBe(6);
  });

  it("I3: who failed on an ordinary list row says so with Try again, under fields that stay editable (mutation: drop the lower who error -> FAILS)", () => {
    const html = renderOpen(ready(WHO_ERR));
    expect(html).toMatch(/data-drawer-who-error[^>]*>[\s\S]*?Couldn&#x27;t load Contact Details\.[\s\S]*?Try again/);
    expect(html).toMatch(/First name: Maria/);
  });

  it("I3: tags failed says so with Try again (mutation: render nothing for a tags error -> FAILS)", () => {
    const html = renderOpen(ready(TAGS_ERR));
    expect(html).toMatch(/data-drawer-tags-error[^>]*>[\s\S]*?Couldn&#x27;t load Tags\.[\s\S]*?Try again/);
  });

  it("I3: Recent with a partial failure keeps its rows and says what failed (mutation: drop the failedText line -> FAILS)", () => {
    const html = renderOpen(ready(RECENT_PARTIAL));
    expect(html).toMatch(/data-timeline-failed[^>]*>[\s\S]*?Couldn&#x27;t load the calls\.[\s\S]*?Try again/);
    expect(html.match(/data-testid="drawer-recent-item"/g)).toHaveLength(2);
  });

  it("I3: an empty Recent says its empty words (mutation: drop the emptyText line -> FAILS)", () => {
    const html = renderOpen(ready(RECENT_EMPTY));
    expect(html).toContain("Nothing here yet.");
    expect(html).not.toContain('data-testid="drawer-recent-item"');
  });

  it("I3: every Try again in the drawer is the drawer's own section retry, never undefined, which would refresh the list (mutation: drop onRetry from SummaryBody, the Recent partial Retry, the tags or the who error -> FAILS)", async () => {
    const { RecordCardRetry } = await import("@/components/record/record-card");
    const { RecordSection } = await import("@/components/record/record-section");
    const { SummaryBody } = await import("./[contactId]/summary-card");
    const seen = new Set<unknown>();
    let sites = 0;
    for (const body of [{ ...FACTS_MISSING, recent: RECENT_PARTIAL.recent, who: TAGS_ERR.who }, { ...FACTS_MISSING, who: WHO_ERR.who }]) {
      const tree = treeOf(ready(body));
      const retry = tree.find((e) => e.type === RecordSection && e.props.id === "facts")!.props.onRetry;
      expect(typeof retry).toBe("function");
      for (const u of tree.filter((e) => e.type === RecordCardRetry || e.type === SummaryBody || e.type === RecordSection)) {
        expect(u.props.onRetry).toBe(retry);
        seen.add(u.type === RecordSection ? `section:${String(u.props.id)}` : u.type);
        if (u.type === RecordCardRetry) sites += 1;
      }
    }
    // Every kind was reached: the facts' SummaryBody, the four sections, and the three RecordCardRetry
    // sites (Recent's partial failure, tags, who).
    expect(seen).toContain(SummaryBody);
    expect([...seen].filter((s) => typeof s === "string").sort()).toEqual(["section:facts", "section:next-up", "section:recent", "section:who"]);
    expect(sites).toBe(3);
  });

  it("m1: Escape with an input focused inside the sheet cancels the field, not the drawer; otherwise the drawer closes (mutation: drop preventDefault -> FAILS)", () => {
    class FakeNode { constructor(private inside: unknown) {} contains(el: unknown) { return el === this.inside; } }
    class FakeInput {}
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("HTMLInputElement", FakeInput);
    const onEsc = treeOf(READY).find((e) => typeof e.props.onEscapeKeyDown === "function")!.props.onEscapeKeyDown as (e: unknown) => void;
    const press = (active: unknown, inside: unknown) => {
      vi.stubGlobal("document", { activeElement: active });
      const preventDefault = vi.fn();
      onEsc({ currentTarget: new FakeNode(inside), preventDefault });
      return preventDefault.mock.calls.length;
    };
    const input = new FakeInput();
    expect(press(input, input)).toBe(1);
    expect(press(null, input)).toBe(0);
    expect(press(input, null)).toBe(0);
  });

  it("m2/m3: the whole drawer's Try again (the sections' word) drops the failed load and re-reads (mutation: delete both setters -> FAILS)", async () => {
    const { Button } = await import("@/components/ui/button");
    const tree = treeOf({ contactId: "c1", result: { status: "error" } });
    const retry = tree.find((e) => e.type === Button && typeof e.props.onClick === "function")!;
    expect(retry.props.children).toBe("Try again");
    (retry.props.onClick as () => void)();
    const fetched = states.find((s) => s.initial === null)!;
    const nonce = states.find((s) => s.initial === 0)!;
    expect(fetched.set).toHaveBeenCalledWith(null);
    expect(nonce.set).toHaveBeenCalledTimes(1);
  });

  it("m10: exactly two links named Open full record in every state, the bottom one carrying the e2e's hook (mutation: keep the error Notice's own link -> FAILS)", () => {
    for (const fetched of [undefined, READY, { contactId: "c1", result: { status: "error" } }]) {
      const html = renderOpen(fetched);
      expect(html.match(/aria-label="Open full record"|>Open full record<\/a>/g)).toHaveLength(2);
      expect(html).toMatch(/<a [^>]*data-drawer-open-full[^>]*>Open full record<\/a>/);
    }
  });

  it("m8: a tag shows as typed (lang=''), and See all and the bottom link are ghost, never a second primary (mutation: make either link default -> FAILS)", () => {
    expect(renderOpen(READY)).toContain('<span lang="">vip</span>');
    const tree = treeOf(READY);
    for (const hook of ["data-drawer-see-all", "data-drawer-open-full"]) {
      const cls = String(tree.find((e) => hook in e.props)?.props.className ?? "");
      expect(cls).toContain("hover:bg-[var(--surface-3)]");
      expect(cls).not.toContain("btn-primary");
    }
  });

  it("the tag-add Input is a real tap target on a phone (min-h-11 md:min-h-8), matching its twin on the full record page (mutation: revert to h-7 -> FAILS)", () => {
    const html = renderOpen(READY);
    const input = html.match(/<input[^>]*name="tag"[^>]*>/)?.[0] ?? "";
    expect(input).toContain("min-h-11");
    expect(input).toContain("md:min-h-8");
    expect(input).not.toMatch(/(?<!file:)\bh-7\b/);
  });

  it("the Language line is the route's view, keyed by contact, and re-reads the route when it changes (S-09 §8.1; mutation: onChanged router.refresh -> FAILS)", async () => {
    const { LanguageField } = await import("./language-field");
    const el = treeOf(READY).find((e) => e.type === LanguageField);
    expect(el?.props.view).toEqual(GOOD.who.language);
    expect(el?.props.contactId).toBe("c1");
    const nonce = states.filter((s) => s.initial === 0);
    (el!.props.onChanged as () => void)();
    expect(nonce[0]!.set).toHaveBeenCalledTimes(1);
  });
});
