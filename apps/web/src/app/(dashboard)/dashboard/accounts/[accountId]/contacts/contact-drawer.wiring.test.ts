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
 * setters (the marketing-optout-switch.wiring.test.ts idiom). The Sheet is
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
vi.mock("./actions", () => ({ updateContactFieldAction: vi.fn(), setMarketingEmailOptOutAction: vi.fn() }));
vi.mock("./[contactId]/actions", () => ({ addTagAction: vi.fn(), removeTagAction: vi.fn() }));

const { ContactDrawer } = await import("./contact-drawer");

const ROW: ContactRow = {
  id: "c1", first_name: "Maria", last_name: "Garcia", email: null, phone: null,
  company_name: null, created_at: "2026-09-01T00:00:00+00:00",
};

const GOOD = {
  tags: [{ id: "t1", name: "vip" }],
  recent: [{ kind: "note", label: "Note", at: "2026-09-01T10:00:00+00:00" }],
  marketing_email_opted_out_at: "2026-09-23T12:00:00+00:00",
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
  expect(effects).toHaveLength(1);
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

  it("a body without the opt-out stamp stores the error state, not an unticked box", async () => {
    expect(await load(omit("marketing_email_opted_out_at"))).toEqual({ contactId: "c1", result: { status: "error" } });
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
    expect(effects).toHaveLength(1);
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
 * Review R3-I2: the Check number row must follow the number, not its first
 * render. Source pins (no DOM renderer here); the e2e spec proves the
 * behaviour in a browser.
 */
describe("the Check number row follows a phone edit", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const panel = strip(readFileSync(path.join(here, "[contactId]", "contact-fields-panel.tsx"), "utf8"));

  it("the drawer keys the row by the summary's flag (mutation: key by the contact alone → FAILS)", () => {
    expect(drawer).toContain("key={`phone-${row.id}-${load.summary.phone_country_unconfirmed}`}");
  });

  it("the drawer re-reads its summary after a phone save (mutation: drop the nonce bump → FAILS)", () => {
    expect(drawer).toMatch(/if \(field === "phone"\) setRetryNonce\(\(n\) => n \+ 1\);/);
  });

  it("the drawer re-reads its summary after a pick and after an Undo, and the row hands that on (re-review minor 1; mutation: drop the onChanged prop, or stop passing it to pickPhoneCountry → FAILS)", () => {
    const row = strip(readFileSync(path.join(here, "phone-country-row.tsx"), "utf8"));
    // Anchored on the row's own prop: TagsRow carries the same onChanged text.
    expect(drawer).toMatch(/unconfirmed=\{load\.summary\.phone_country_unconfirmed\}\s*onChanged=\{\(\) => setRetryNonce\(\(n\) => n \+ 1\)\}/);
    expect(row).toMatch(/run,\s*onChanged,\s*\)\);/);
  });

  it("the full page keys the row by the page's flag (mutation: key by the contact alone → FAILS)", () => {
    expect(panel).toContain("key={`phone-${contactId}-${phoneUnconfirmed}`}");
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
  const row = strip(readFileSync(path.join(here, "phone-country-row.tsx"), "utf8"));
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const panel = strip(readFileSync(path.join(here, "[contactId]", "contact-fields-panel.tsx"), "utf8"));

  it("the row passes ITS OWN phone prop to setPhoneCountryAction, never a literal \"\" (mutation: setPhoneCountryAction(accountId, contactId, c) → FAILS)", () => {
    expect(row).toContain("setPhoneCountryAction(accountId, contactId, c, phone)");
  });

  it("the drawer's phone prop comes from the SUMMARY, never row.phone (the peek stub) or a literal \"\" (mutation: phone={row.phone ?? \"\"} → FAILS)", () => {
    expect(drawer).toContain('phone={load.summary.phone ?? ""}');
    expect(drawer).not.toMatch(/<PhoneCountryRow[\s\S]{0,400}?phone=\{row\.phone/);
  });

  it("the panel's phone prop comes from the real contact record, never a literal \"\" (mutation: phone={\"\"} → FAILS)", () => {
    expect(panel).toContain('phone={contact.phone ?? ""}');
  });
});
