import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubmissionRow } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";
import { SubmissionsTable } from "./submissions-table";

function submission(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: "s1", form_id: "f1", contact_id: null, spam_reason: null, processing_error: null,
    answers: [{ key: "email", label: "Email", value: "ana@example.com" }],
    attribution: {}, locale: null,
    consent: [{ key: "marketing", given: true, text: "I agree to be contacted", at: "2026-10-08T05:00:00.000Z" }],
    created_at: "2026-10-08T05:00:00.000Z",
    ...overrides,
  };
}

function html(
  submissions: SubmissionRow[],
  extra: { readerLocale?: Locale; pseudo?: boolean } = {},
): string {
  return renderToStaticMarkup(createElement(SubmissionsTable, {
    accountId: "a1", submissions, timezone: "America/Chicago",
    readerLocale: extra.readerLocale, pseudo: extra.pseudo,
  } as never));
}

/**
 * S-10 T5 part 2: every static read in this card — the card title, the
 * empty state, the spam badge and its title tooltip, the needs-attention
 * badge, the contact link, and the consent list's own sr-only words — now
 * follows the reader's own language, never a bare m[...] (always English
 * regardless of locale).
 */
describe("SubmissionsTable speaks Spanish to a Spanish-reading operator (S-10 T5 part 2)", () => {
  it("renders the card title in Spanish, and the empty state too (mutation: hard-code English in either → FAILS)", () => {
    const withTitle = renderedText(html([submission()], { readerLocale: "es" }));
    expect(withTitle).toContain(m["forms.submissions.es"]);

    const empty = renderedText(html([], { readerLocale: "es" }));
    expect(empty).toContain(m["forms.noSubmissions.es"]);
  });

  it("renders the blocked badge, its spam-reason tooltip, the needs-attention badge and the contact link in Spanish (mutation: leave any one as the bare English key → FAILS)", () => {
    const out = html([submission({
      spam_reason: "too_fast", processing_error: "enrichment timed out", contact_id: "c1",
    })], { readerLocale: "es" });
    const text = renderedText(out);
    expect(text).toContain(m["forms.blocked.es"]);
    expect(out).toContain(`title="${m["forms.spamReason.too_fast.es"]}"`);
    expect(text).toContain(m["forms.needsAttention.es"]);
    expect(text).toContain(m["forms.contact.es"]);
  });

  it("every spam reason's tooltip follows the reader's locale, not just too_fast (mutation: hard-code the English catalogue key → FAILS)", () => {
    for (const reason of ["honeypot", "too_fast", "rate_limited"] as const) {
      const out = html([submission({ spam_reason: reason })], { readerLocale: "es" });
      expect(out).toContain(`title="${m[`forms.spamReason.${reason}.es` as keyof typeof m]}"`);
    }
  });

  it("the consent list's sr-only agreed/not-agreed words are Spanish (mutation: leave the bare m[] → FAILS)", () => {
    const agreed = renderedText(html([submission({
      consent: [{ key: "marketing", given: true, text: "Acepto ser contactado", at: "2026-10-08T05:00:00.000Z" }],
    })], { readerLocale: "es" }));
    expect(agreed).toContain(m["forms.consentGiven.es"]);

    const declined = renderedText(html([submission({
      consent: [{ key: "marketing", given: false, text: "No deseo ser contactado", at: "2026-10-08T05:00:00.000Z" }],
    })], { readerLocale: "es" }));
    expect(declined).toContain(m["forms.consentNotGiven.es"]);
  });

  it("both dates — the submission's and the consent's — read in the reader's language and the account's zone (mutation: drop the locale from either call, or format in UTC → FAILS)", () => {
    // 03:00Z on Oct 8 is 10 PM on Oct 7 in America/Chicago, so the day
    // itself proves the account's zone, and the month word proves the language.
    const at = "2026-10-08T03:00:00.000Z";
    const row = submission({
      created_at: at,
      consent: [{ key: "marketing", given: true, text: "Acepto", at }],
    });
    const es = renderedText(html([row], { readerLocale: "es" }));
    expect(es.match(/7 oct 2026/g)?.length).toBe(2);
    expect(es).not.toMatch(/Oct 7/);
    const en = renderedText(html([row], { readerLocale: "en" }));
    expect(en.match(/Oct 7, 2026/g)?.length).toBe(2);
  });

  it("defaults to English with no readerLocale prop, so every other caller keeps its current behaviour (mutation: default to Spanish → FAILS)", () => {
    const text = renderedText(html([submission()]));
    expect(text).toContain(m["forms.submissions"]);
    expect(text).not.toContain(m["forms.submissions.es"]);
  });

  it("the QA pseudo-locale reaches the card title (mutation: drop pseudo from makeTr → FAILS)", () => {
    const text = renderedText(html([submission()], { readerLocale: "en", pseudo: true }));
    expect(text).toContain(pseudoLocale(m["forms.submissions"]));
  });
});
