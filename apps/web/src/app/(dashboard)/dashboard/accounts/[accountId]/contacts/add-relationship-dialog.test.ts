import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RelationshipView } from "@/lib/contacts/relationship-view";

/**
 * The add dialog's own markup in the states the final review named (item 7): the flag hint and the
 * "saved" line are polite live regions, never role="alert", and a result list never outlives the
 * term it answered. No DOM renderer in apps/web, so the dialog is rendered on the server with its
 * Radix parts passed through (a closed Radix dialog portals nothing) and its useState calls answered
 * by position (contact-drawer.wiring.test.ts's idiom). The position of each state is pinned by the
 * count check below: a state added or moved in the dialog reds that check first, by name, instead
 * of silently answering the wrong state.
 */
const STATE = {
  open: 0, mode: 1, term: 2, answer: 3, picked: 4, fresh: 5, failed: 6, choice: 7, customLabel: 8, otherForm: 9, subjectForm: 10,
} as const;
const STATE_COUNT = 11;
const harness: { overrides: Map<number, unknown>; calls: number } = { overrides: new Map(), calls: 0 };
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => {},
    useState: (init: unknown) => {
      const i = harness.calls++;
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      return [harness.overrides.has(i) ? harness.overrides.get(i) : initial, vi.fn()];
    },
  };
});
vi.mock("@/components/ui/dialog", () => {
  const pass = ({ children }: { children?: unknown }) => children;
  return { Dialog: pass, DialogClose: pass, DialogContent: pass, DialogFooter: pass, DialogHeader: pass, DialogTitle: pass, DialogTrigger: pass };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("./relationship-actions", () => ({ addRelationshipAction: vi.fn(), searchRelatableContactsAction: vi.fn() }));

const { AddRelationshipDialog } = await import("./add-relationship-dialog");
const { LocaleProvider } = await import("@/components/locale-provider");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

const S = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const ana = { id: ANA, firstName: "Ana", lastName: "Ramírez", phone: null };
const mother: RelationshipView = {
  id: "r1", labelKey: "parent", customLabel: null, namedSide: "a", person: { id: ANA, firstName: "Ana", lastName: "Ramírez" },
  namedForm: "f", subjectForm: null, canPickUp: false, isEmergency: false, lockedFlag: null,
};

function render(state: Partial<Record<keyof typeof STATE, unknown>>, views: RelationshipView[] = []) {
  harness.calls = 0;
  harness.overrides = new Map(Object.entries(state).map(([k, v]) => [STATE[k as keyof typeof STATE], v]));
  return renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
    createElement(AddRelationshipDialog, { accountId: "a1", contactId: S, subject: { firstName: "Sofía", lastName: "Ramírez" }, views, onAdded: () => {} })));
}

/** The element carrying `data-relationship-note="<kind>"`, as markup, through its closing tag. */
function note(html: string, kind: string): string {
  const match = html.match(new RegExp(`<div[^>]*data-relationship-note="${kind}"[^>]*>(?:(?!</div>).)*</div>`));
  return match?.[0] ?? "";
}

beforeEach(() => { harness.overrides = new Map(); harness.calls = 0; });

describe("AddRelationshipDialog's markup (final review item 7)", () => {
  it("the dialog has exactly the states this harness answers by position", () => {
    render({});
    expect(harness.calls).toBe(STATE_COUNT);
  });

  it("the flag hint is a polite live region, never role=\"alert\" (mutation: render it in Notice again -> FAILS)", () => {
    const html = render({ mode: "find", picked: ana, choice: "emergency_contact:a" }, [mother]);
    const hint = note(html, "flag-hint");
    expect(hint).toContain('aria-live="polite"');
    expect(renderedText(hint)).toContain("Already on this record as “Mother: Ana Ramírez”. Turn on “Emergency contact” there instead.");
    expect(html).not.toContain('role="alert"');
  });

  it("control: the polite region is there and empty when there is no hint, so its first words are announced", () => {
    const hint = note(render({ mode: "find", picked: ana, choice: "parent:a" }, [mother]), "flag-hint");
    expect(hint).toContain('aria-live="polite"');
    expect(renderedText(hint).trim()).toBe("");
  });

  it("after a failed add that SAVED the new person, a polite line says so, and the names are theirs now (read-only)", () => {
    const html = render({ mode: "new", fresh: { firstName: "Ana", lastName: "Ramírez", phone: "" }, failed: { createdId: ANA, personSaved: true } });
    const saved = note(html, "person-saved");
    expect(saved).toContain('aria-live="polite"');
    expect(renderedText(saved)).toContain(m["relationships.dialog.personSaved"].replace("{name}", "Ana Ramírez"));
    expect(html.match(/readOnly=""|readonly=""/g)).toHaveLength(3);
  });

  it("after a failed add that MATCHED someone already saved, no line claims they were saved (mutation: show the line whenever an id came back -> FAILS)", () => {
    const html = render({ mode: "new", fresh: { firstName: "Ana", lastName: "Ramírez", phone: "956 555 0142" }, failed: { createdId: ANA, personSaved: false } });
    expect(html.match(/readOnly=""|readonly=""/g)).toHaveLength(3); // control: this IS the post-failure state
    expect(renderedText(note(html, "person-saved")).trim()).toBe("");
  });

  it("a result list for an earlier term is not shown under a new one (mutation: show the last answer whatever its term -> FAILS)", () => {
    const answer = { term: "Ana", hits: [ana] };
    expect(render({ mode: "find", term: "Ana", answer })).toContain('name="rel-person"'); // control
    const html = render({ mode: "find", term: "Anab", answer });
    expect(html).not.toContain('name="rel-person"');
    expect(renderedText(html)).not.toContain(m["relationships.dialog.searchEmpty"]);
  });
});

// Plan Task 8 (F-092 part 1): the "find" picker's rows highlight which letters or digits matched,
// the same way the palette and the contact list do — driven by the term the row actually answered,
// never a query the row invents on its own.
describe("the find picker highlights the matched letters and digits (plan Task 8)", () => {
  it("marks the matched letters of a hit's name (mutation: render the row's name without HighlightedText -> FAILS)", () => {
    const hits = [{ id: ANA, firstName: "Ana", lastName: "Ramírez", phone: null }];
    const html = render({ mode: "find", term: "ramirez", answer: { term: "ramirez", hits } });
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>Ramírez<\/mark>/);
  });

  it("marks the matched digits of a hit's phone (mutation: render the row's phone without HighlightedText -> FAILS)", () => {
    const hits = [{ id: ANA, firstName: "Ana", lastName: "Ramírez", phone: "(956) 555-0199" }];
    const html = render({ mode: "find", term: "0199", answer: { term: "0199", hits } });
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>0199<\/mark>/);
  });
});

describe("the submit hands the created id to the retry (final review B Minor 1: step 5 of the e2e cannot tell a retry-by-id from a re-match by phone)", () => {
  it("the submit passes this dialog's createdId to otherForSubmit (mutation: createdId: null -> FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./add-relationship-dialog.tsx", import.meta.url), "utf8");
    const call = src.match(/otherForSubmit\(\{([^}]*)\}\)/);
    expect(call, "the submit calls otherForSubmit with an object literal").not.toBeNull();
    expect(call![1]).toMatch(/(^|[\s,])createdId\s*(,|$)/);
  });
});
