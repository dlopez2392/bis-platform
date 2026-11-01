import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FormRow, CustomFieldDef } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { Locale } from "@/lib/i18n/locale";

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

function html(
  f: FormRow,
  extra: { customFields?: CustomFieldDef[]; readerLocale?: Locale; pseudo?: boolean } = {},
) {
  return renderToStaticMarkup(createElement(FormEditor, {
    form: f, customFields: extra.customFields ?? [], action: async () => ({ ok: true as const }),
    conciergeAssistantName: null, republishAction: async () => ({ ok: true as const }),
    readerLocale: extra.readerLocale, pseudo: extra.pseudo,
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

  it("the Add field picker's own tag stays English for a Spanish-locale FORM when the READER's own locale is English (mutation: route the chrome off form.locale_default instead of readerLocale → FAILS)", () => {
    const out = html(form({ locale_default: "es" }));
    expect(out).toContain(m["forms.kind.core.referral_source"]);
    expect(out).not.toContain(m["forms.kind.core.referral_source.es"]);
  });
});

/**
 * S-10 T5 part 2: the editor's own chrome (card titles, labels, the field
 * picker, every button) now follows the OPERATOR's own language —
 * `readerLocale`, a prop distinct from `form.locale_default` (the known
 * trap this task names: that prop is the FORM's own customer-facing
 * language, forwarded unchanged to the embed snippet's `data-locale`, and
 * must never double as the reader's).
 */
describe("FormEditor speaks Spanish to a Spanish-reading operator (S-10 T5 part 2)", () => {
  it("renders every static card title, label, hint and button in Spanish (mutation: hard-code English in any one of them → FAILS)", () => {
    const out = html(form(), { readerLocale: "es" });
    const text = renderedText(out);
    expect(text).toContain(m["forms.fields.es"]);
    expect(text).toContain(m["forms.noFields.es"]);
    expect(text).toContain(m["forms.addField.es"]);
    expect(text).toContain(m["forms.settings.es"]);
    expect(text).toContain(m["forms.name.es"]);
    expect(text).toContain(m["forms.locale.es"]);
    expect(text).toContain(m["forms.notifyEmails.es"]);
    expect(text).toContain(m["forms.notifyHint.es"]);
    expect(text).toContain(m["forms.successMode.es"]);
    expect(text).toContain(m["forms.successMessage.es"]);
    expect(text).toContain(m["forms.transparent.es"]);
    expect(text).toContain(m["common.save.es"]);
    // sr-only label, but still a text node renderedText can see.
    expect(text).toContain(m["forms.status.es"]);
    expect(text).not.toContain(m["forms.fields"]);
    expect(text).not.toContain(m["forms.settings"]);
  });

  it("renders the redirect URL label instead of the success-message label once successMode is 'redirect', in Spanish too (mutation: leave the English label → FAILS)", () => {
    const out = html(form({ success_mode: "redirect", redirect_url: "https://example.com" }), { readerLocale: "es" });
    const text = renderedText(out);
    expect(text).toContain(m["forms.redirectUrl.es"]);
    expect(text).not.toContain(m["forms.successMessage.es"]);
  });

  it("a field row's own tag, its Label aria-label and its Required checkbox text are Spanish, and the per-field control aria-labels (move/remove) are too (mutation: leave any one English → FAILS)", () => {
    const out = html(form({
      fields: [{ key: "phone", kind: "core.phone", label: "Phone", required: true }],
    }), { readerLocale: "es" });
    expect(out).toContain(`aria-label="${m["forms.fieldLabel.es"]} — phone"`);
    expect(out).toContain(`aria-label="${m["forms.moveUp.es"]}"`);
    expect(out).toContain(`aria-label="${m["forms.moveDown.es"]}"`);
    expect(out).toContain(`aria-label="${m["forms.removeField.es"]}"`);
    const text = renderedText(out);
    expect(text).toContain(m["forms.kind.core.phone.es"]);
    expect(text).toContain(m["forms.fieldRequired.es"]);
  });

  it("the Add field picker's own button tags follow the READER's locale, not the form's (mutation: route them off form.locale_default → FAILS)", () => {
    const out = html(form({ locale_default: "en" }), { readerLocale: "es" });
    const text = renderedText(out);
    expect(text).toContain(m["forms.kind.core.email.es"]);
    expect(text).toContain(m["forms.kind.core.referral_source.es"]);
  });

  it("the QA pseudo-locale reaches the editor's chrome (mutation: drop pseudo from makeTr → FAILS)", async () => {
    const { pseudoLocale } = await import("@/lib/i18n/pseudo-locale");
    const out = html(form(), { readerLocale: "en", pseudo: true });
    const text = renderedText(out);
    expect(text).toContain(pseudoLocale(m["forms.fields"]));
  });
});

/**
 * Review round 1, m5 (corrected for S-10 T5 part 2): `addField` (the ONE
 * call site that seeds a new field's customer-facing label) passes
 * `form.locale_default` to `kindLabel` — proven as a source pin, the same
 * tool contact-drawer.wiring.test.ts already uses for wiring a static render
 * cannot reach (there is no DOM renderer here, so a click on "Add field"
 * cannot be simulated; `kindLabel`'s own locale behaviour is unit-tested
 * directly in editor-helpers.test.ts). The editor's own category tag (the
 * field row's left-hand label and the picker's own buttons) now passes
 * `readerLocale` instead — the OPPOSITE of the original m5 finding, now that
 * S-10 T5 part 2 gives the dashboard chrome a real reader locale to follow.
 */
describe("FormEditor: the seeded label follows the FORM's own locale; the editor's chrome follows the READER's (S-10 T5 part 2)", () => {
  const src = readFileSync(fileURLToPath(new URL("./form-editor.tsx", import.meta.url)), "utf8");
  const kindLabelCalls = [...src.matchAll(/kindLabel\([^)]*\)/g)].map((match) => match[0]);

  it("addField passes form.locale_default to kindLabel, and ONLY addField does (mutation: pass readerLocale there too, or drop the argument → FAILS)", () => {
    expect(src).toMatch(/label: kindLabel\(kind, customFields, form\.locale_default\)/);
    expect(kindLabelCalls.filter((c) => c.includes("form.locale_default")).length).toBe(1);
  });

  it("both of the editor's own chrome tags pass readerLocale, and ONLY readerLocale (mutation: pass form.locale_default to either, or drop the argument → FAILS)", () => {
    expect(src).toContain("{kindLabel(field.kind, customFields, readerLocale)}");
    expect(src).toContain("{kindLabel(kind, customFields, readerLocale)}");
    expect(kindLabelCalls.filter((c) => c.includes("readerLocale")).length).toBe(2);
  });
});

/**
 * S-10 T5 part 2: toasts and the unpublish notice fire only on an
 * interaction this repo's test tooling cannot simulate (no DOM lib; see the
 * block above's own comment) — pinned as source, the same shape used for
 * the seeded-label/chrome-tag split above.
 */
describe("FormEditor: toasts and the unpublish notice read through tr.text(), not a bare m[] (S-10 T5 part 2)", () => {
  const src = readFileSync(fileURLToPath(new URL("./form-editor.tsx", import.meta.url)), "utf8");

  it("has no direct m[...] read left at all (mutation: revert any one tr.text() call back to m[...] → FAILS)", () => {
    expect(src).not.toMatch(/\bm\[/);
  });

  it("the unpublish warning and its toast interpolate {assistant} through tr.text()'s own params, not .replace() (mutation: keep .replace(\"{assistant}\", ...) → FAILS)", () => {
    expect(src).toMatch(/tr\.text\("forms\.unpublishWarning", \{ assistant: conciergeAssistantName \}\)/);
    expect(src).toMatch(/tr\.text\("forms\.unpublishedToast", \{ assistant: conciergeAssistantName \}\)/);
  });
});
