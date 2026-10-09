import { describe, it, expect } from "vitest";
import type { FormTheme, CustomFieldDef } from "@bis/db";
import {
  defaultFieldKey, mergeFormTheme, isValidFormFieldList, defaultFormFields,
  shouldWarnOnUnpublish, statusAfterUndo, kindLabel,
} from "./editor-helpers";

describe("defaultFieldKey", () => {
  it("strips the core. prefix", () => {
    expect(defaultFieldKey("core.email")).toBe("email");
    expect(defaultFieldKey("core.first_name")).toBe("first_name");
  });

  it("namespaces custom fields so they can never collide with a core key", () => {
    expect(defaultFieldKey("custom.email")).toBe("custom_email");
  });

  it("leaves kinds with no prefix alone", () => {
    expect(defaultFieldKey("message")).toBe("message");
    expect(defaultFieldKey("consent")).toBe("consent");
  });
});

describe("mergeFormTheme", () => {
  it("keeps keys the editor does not manage", () => {
    const stored = { mode: "dark" as const, radius: "1rem", transparentBackground: true };
    const merged = mergeFormTheme(stored, { transparentBackground: false });
    expect(merged).toEqual({ mode: "dark", radius: "1rem", transparentBackground: false });
  });

  it("handles an absent stored theme", () => {
    const merged = mergeFormTheme(undefined, { transparentBackground: false });
    expect(merged).toEqual({ transparentBackground: false });
  });

  // A form saved before the brand color replaced per-form accents keeps its
  // stored accent key untouched. Nothing reads it; no migration rewrites it.
  it("leaves a legacy accent key in place without reading it", () => {
    const stored = { accent: "#111111", transparentBackground: false } as FormTheme;
    const merged = mergeFormTheme(stored, { transparentBackground: true });
    expect((merged as Record<string, unknown>).accent).toBe("#111111");
  });
});

describe("defaultFormFields", () => {
  // F-047 phase 1 defect (docs/crm-features.md §2.3, "the seeded Name
  // field"): a brand-new form seeded a single field, kind core.first_name,
  // labeled plainly "Name" — a visitor reads "Name" and types a full name,
  // which lands entirely in first_name because there is no last_name field
  // for the rest to go to (confirmed against apps/web/src/lib/concierge/
  // lead.ts:79-81, which falls back to stuffing the whole fullName into
  // core.first_name specifically when the form carries no core.last_name
  // field). The fix seeds both, same as the demo form
  // (packages/db/src/demo/seed.ts:810-811), and labels the first one
  // truthfully instead of the ambiguous "Name".
  it("seeds a first name AND a last name field, not one field mislabeled 'Name'", () => {
    const fields = defaultFormFields();
    const first = fields.find((f) => f.kind === "core.first_name");
    const last = fields.find((f) => f.kind === "core.last_name");
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first!.label).not.toBe("Name");
    expect(first!.label.toLowerCase()).toContain("first");
    expect(last!.label.toLowerCase()).toContain("last");
  });

  it("still seeds an email field and a message field, both as before", () => {
    const fields = defaultFormFields();
    expect(fields.some((f) => f.kind === "core.email" && f.required)).toBe(true);
    expect(fields.some((f) => f.kind === "message")).toBe(true);
  });

  it("every seeded field has a unique key, so FormData never collides two answers onto one name", () => {
    const fields = defaultFormFields();
    const keys = fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isValidFormFieldList", () => {
  const valid = { key: "email", kind: "core.email", label: "Email", required: true };

  it("accepts a well-formed array", () => {
    expect(isValidFormFieldList([valid])).toBe(true);
    expect(isValidFormFieldList([])).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(isValidFormFieldList({ ...valid })).toBe(false);
    expect(isValidFormFieldList(null)).toBe(false);
  });

  it("rejects an item missing required shape, e.g. a tampered [{}]", () => {
    expect(isValidFormFieldList([{}])).toBe(false);
    expect(isValidFormFieldList([{ ...valid, key: "" }])).toBe(false);
    expect(isValidFormFieldList([{ ...valid, required: "true" }])).toBe(false);
    expect(isValidFormFieldList([{ ...valid, kind: 5 }])).toBe(false);
    expect(isValidFormFieldList([valid, {}])).toBe(false);
  });
});

// Owner context (forms tracker batch 4): the Forms page warns before taking
// a form off "published" when a website assistant files its leads there —
// D-048 already stops the chat from answering once that happens
// (concierge.ts's getVoiceProfileByPublicId), but nothing told the operator
// making the change what they were about to break. This predicate is the
// decision alone, so it is testable without the editor's own Select state,
// its toast, or its Undo wiring.
describe("shouldWarnOnUnpublish", () => {
  // Retitled (fix round 1 review): the old name claimed "mutation: drop the
  // currentStatus check → FAILS", but both assertions here already hold
  // currentStatus at "published" — dropping that check changes nothing for
  // either one (it is the OTHER "does not warn" tests below that catch it).
  // What this test actually isolates is checking nextStatus against
  // "published" specifically, not against one hardcoded off-published value:
  // a mutation that checked `nextStatus === "draft"` instead of
  // `nextStatus !== "published"` would still pass the first assertion but
  // FAIL the second (archived).
  it("warns for EITHER off-published value, draft or archived — not just one (mutation: check nextStatus === \"draft\" instead of !== \"published\" → the archived case alone FAILS)", () => {
    expect(shouldWarnOnUnpublish("published", "draft", "Ana")).toBe(true);
    expect(shouldWarnOnUnpublish("published", "archived", "Ana")).toBe(true);
  });

  it("does not warn when the form was never published to begin with (mutation: drop the currentStatus check → the 'archived already' case now also warns, FAILS)", () => {
    expect(shouldWarnOnUnpublish("draft", "archived", "Ana")).toBe(false);
    expect(shouldWarnOnUnpublish("archived", "draft", "Ana")).toBe(false);
  });

  it("does not warn when the pending status is still published, e.g. no real change (mutation: drop the nextStatus check → FAILS)", () => {
    expect(shouldWarnOnUnpublish("published", "published", "Ana")).toBe(false);
  });

  it("does not warn when no assistant is wired to this form (mutation: drop the null check → FAILS)", () => {
    expect(shouldWarnOnUnpublish("published", "draft", null)).toBe(false);
  });
});

// Fix round 1 review item 1: the Status Select was uncontrolled
// (defaultValue={form.status} — Radix reads it exactly once), so a
// successful Undo republish left the visible control, and the `status`
// state driving shouldWarnOnUnpublish, still showing the unpublished value.
// The warning reappeared on an already-published form, and the next Save
// unpublished it again. This is the state-transition decision alone,
// extracted so it is testable without a DOM renderer (no DOM lib in this
// repo — see contact-drawer.wiring.test.ts's own precedent for pulling
// non-trivial wiring out of a component for exactly this reason).
/**
 * Review round 1, m5: `kindLabel` doubles as the editor's own category tag
 * (operator-facing, always English — the dashboard carries no live i18n)
 * AND the SEEDED default value of a new field's customer-facing `label`
 * when `addField` first adds it. Those are two different readers: the
 * operator building the form always reads the editor in English, but the
 * seeded label becomes something the VISITOR reads, in whichever language
 * the FORM itself was built in (`form.locale_default`) — never an
 * "operator locale", which does not exist here (fixing the stale comment
 * at messages.ts, same review round).
 */
describe("kindLabel", () => {
  const NO_CUSTOM: CustomFieldDef[] = [];

  it("defaults to English with no locale argument — the editor's own chrome (mutation: default to Spanish → FAILS)", () => {
    expect(kindLabel("core.referral_source", NO_CUSTOM)).toBe("Who recommended you?");
  });

  it("stays English for an English-locale form, even when a .es twin exists", () => {
    expect(kindLabel("core.referral_source", NO_CUSTOM, "en")).toBe("Who recommended you?");
  });

  it("seeds the Spanish twin for a Spanish-locale form (mutation: ignore the locale argument → FAILS)", () => {
    expect(kindLabel("core.referral_source", NO_CUSTOM, "es")).toBe("¿Quién le recomendó?");
  });

  it("a kind with no .es twin falls back to English even for a Spanish form (mutation: throw/crash on a missing twin → FAILS)", () => {
    expect(kindLabel("core.first_name", NO_CUSTOM, "es")).toBe("First name");
  });

  it("an unrecognised (custom) kind is unaffected by locale — it already reads the account's OWN custom field name", () => {
    const def: CustomFieldDef = {
      id: "d1", model: "contact", field_key: "gate_code", name: "Gate code",
      data_type: "text", options: [], position: 0,
    };
    expect(kindLabel("custom.gate_code", [def], "es")).toBe("Gate code");
  });
});

describe("statusAfterUndo", () => {
  it("moves the status to published on a successful republish (mutation: return currentStatus unconditionally → FAILS)", () => {
    expect(statusAfterUndo({ ok: true }, "draft")).toBe("published");
    expect(statusAfterUndo({ ok: true }, "archived")).toBe("published");
  });

  it("leaves the status exactly as it was when the republish failed (mutation: return \"published\" unconditionally → FAILS)", () => {
    expect(statusAfterUndo({ ok: false, error: "nope" }, "draft")).toBe("draft");
    expect(statusAfterUndo({ ok: false, error: "nope" }, "archived")).toBe("archived");
  });
});
