import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FormRow } from "@bis/db";
import { m } from "@/lib/messages";

const { FormEditor } = await import("./form-editor");

function form(overrides: Partial<FormRow> = {}): FormRow {
  return {
    id: "f1", account_id: "a1", public_id: "pub1", name: "Contact us", status: "draft",
    fields: [], theme: {}, success_mode: "message", success_message: "Thanks!",
    redirect_url: null, notify_emails: [], locale_default: "en",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function html(f: FormRow) {
  return renderToStaticMarkup(createElement(FormEditor, {
    form: f, customFields: [], action: async () => ({ ok: true as const }),
    conciergeAssistantName: null, republishAction: async () => ({ ok: true as const }),
  }));
}

/**
 * F-018, folded into F-157 (docs/crm-features.md §4.3 rider 6): the source
 * question is an optional field a form builder can add, the smallest-surface
 * option named in the brief — the SAME "Add field" picker the other core
 * kinds (First name, Company…) already offer, not a new screen. Mutation:
 * leave "core.referral_source" out of CORE_KINDS → the button never
 * renders, FAILS.
 */
describe("FormEditor: the source question is offered in the Add field picker (F-018/F-157)", () => {
  it("offers 'Who recommended you?' when the form has no such field yet", () => {
    const out = html(form());
    expect(out).toContain(m["forms.kind.core.referral_source"]);
  });

  it("stops offering it once the form already has one (same rule every other core kind follows)", () => {
    const out = html(form({
      fields: [{ key: "referral", kind: "core.referral_source", label: "Who recommended you?", required: false }],
    }));
    // The field's OWN row still names it (the left-hand kind tag), but the
    // "Add field:" picker's button list must not offer it a second time.
    const pickerSection = out.slice(out.indexOf(m["forms.addField"]));
    expect(pickerSection).not.toContain(`>${m["forms.kind.core.referral_source"]}<`);
  });

  it("the Add field picker's own tag stays English for a Spanish-locale form — editor chrome, never the form's own locale (mutation: pass locale to the sidebar tag too → FAILS)", () => {
    const out = html(form({ locale_default: "es" }));
    expect(out).toContain(m["forms.kind.core.referral_source"]);
    expect(out).not.toContain(m["forms.kind.core.referral_source.es"]);
  });
});

/**
 * Review round 1, m5: `addField` (the ONE call site that seeds a new
 * field's customer-facing label) passes `form.locale_default` to
 * `kindLabel` — proven as a source pin, the same tool contact-drawer.
 * wiring.test.ts already uses for wiring a static render cannot reach
 * (there is no DOM renderer here, so a click on "Add field" cannot be
 * simulated; `kindLabel`'s own locale behaviour is unit-tested directly in
 * editor-helpers.test.ts).
 */
describe("FormEditor: the seeded label follows the FORM's own locale, not an 'operator locale' (review round 1, m5)", () => {
  const src = readFileSync(fileURLToPath(new URL("./form-editor.tsx", import.meta.url)), "utf8");

  it("addField passes form.locale_default to kindLabel (mutation: drop the third argument → FAILS)", () => {
    expect(src).toMatch(/label: kindLabel\(kind, customFields, form\.locale_default\)/);
  });

  it("the editor's own sidebar tags do NOT pass a locale — they stay the dashboard's own English chrome (mutation: pass form.locale_default there too → FAILS)", () => {
    expect(src).toContain("{kindLabel(field.kind, customFields)}");
    expect(src).toContain("{kindLabel(kind, customFields)}");
  });
});
