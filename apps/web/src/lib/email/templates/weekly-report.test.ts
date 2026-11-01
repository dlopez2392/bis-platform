import { describe, expect, it } from "vitest";
import { emailBrandNamed } from "./shell";
import { deltaPhrase, weeklyReportEmail, weeklyReportSubject } from "./weekly-report";
import type { Branding } from "@bis/db";

const branding: Branding = {
  brandName: "Rio Roofing", brandLogoPath: null, brandColor: "#6D28D9",
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrandNamed(branding, "Rio Roofing");

const week = { calls: 12, leads: 4, bookings: 2, visitors: 86 };
const quiet = { calls: 0, leads: 0, bookings: 0, visitors: null };
const nothingOn = { receptionist: false, textBack: false };

describe("deltaPhrase", () => {
  it("says more, fewer or same IN WORDS — never an arrow", () => {
    expect(deltaPhrase(12, 9)).toBe("3 more than the week before");
    expect(deltaPhrase(2, 3)).toBe("1 fewer than the week before");
    expect(deltaPhrase(4, 4)).toBe("same as the week before");
  });

  /**
   * An account eight days old has no honest "week before", and a delta
   * measured against a window that predates it would be fabricated. Empty is
   * the answer; the number ships alone.
   */
  it("is EMPTY when there is no prior week", () => {
    expect(deltaPhrase(12, null)).toBe("");
  });
});

describe("weeklyReportEmail", () => {
  it("omits the website line ENTIRELY when visitors were not measured", () => {
    const { html, text } = weeklyReportEmail({
      brand, now: { ...week, visitors: null }, prior: null,
      dashboardUrl: null, reassurance: nothingOn,
    });
    // A zero we did not measure must not look like a zero we did.
    expect(html).not.toMatch(/visitors/i);
    expect(text).not.toMatch(/visitors/i);
  });

  it("includes the website line when there IS a site", () => {
    const { text } = weeklyReportEmail({
      brand, now: week, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toMatch(/86/);
    expect(text).toMatch(/visitors/i);
  });

  it("renders a quiet week as its own message, not four zero rows", () => {
    const { text } = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: true },
    });
    expect(text).toContain("Nothing came in last week");
    expect(text).not.toMatch(/0 calls answered/);
  });

  // D-064 (review round 2): a metric we DID measure (real website traffic)
  // must never be swallowed by the quiet-week copy just because the
  // pipeline metrics (calls/leads/bookings) all read zero — but the fix is
  // NOT to abandon the quiet-week body for the four-zero-row table (the
  // first pass's mistake): DESIGN.md's own rule is that a quiet week gets
  // its OWN body, not four zero rows, and that still holds when the
  // pipeline itself is quiet — only the WEBSITE wasn't. The quiet body
  // keeps "Nothing came in" (true: no calls, no leads, no bookings) and
  // its reassurance, and gains one more true sentence about the website.
  // EXACT lines pinned, not a loose match, because the earlier version of
  // this test (`.not.toContain`) could not have caught the wrong fix
  // either — it only proved the quiet body was gone, not what replaced it.
  it("a week with no calls, leads or bookings but real website visitors keeps the quiet-week body AND adds a visitors sentence (mutation: drop the visitors line, or switch to the four-zero-row table → FAILS)", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 50 }, prior: null,
      dashboardUrl: null, reassurance: { receptionist: true, textBack: true },
    });
    expect(text).toBe(
      "Nothing came in last week — no calls, no leads, no bookings.\n\n"
      + "Your website had 50 visitors last week.\n\n"
      + "Sofía is still answering, and your missed-call text-back is still on.",
    );
    expect(text).not.toMatch(/0 calls answered/);
  });

  it("singular: 1 visitor, not 1 visitors", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 1 }, prior: null,
      dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toContain("Your website had 1 visitor last week.");
    expect(text).not.toContain("1 visitors");
  });

  it("a week with zero visitors (measured, genuinely none) and nothing else is still the quiet-week message", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 0 }, prior: null,
      dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toContain("Nothing came in last week");
  });

  it("claims the receptionist only when the account actually has one", () => {
    const off = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    expect(off.text).not.toMatch(/still answering/i);

    const on = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: false },
    });
    expect(on.text).toMatch(/still answering/i);
  });

  // S-10 T8 review round 1, finding 5: text-back ALONE (no receptionist) is
  // a continuation clause ("your missed-call text-back is still on") used
  // as the whole sentence — it must start with a capital, not run on
  // lower-case the way it reads mid-sentence after the receptionist clause.
  it("text-back alone starts the reassurance sentence with a capital (mutation: drop the capitalisation step → \"your missed-call…\" FAILS)", () => {
    const { text } = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: false, textBack: true },
    });
    expect(text).toContain("Your missed-call text-back is still on.");
    expect(text).not.toContain("your missed-call text-back is still on.");
  });

  // D-063: the quiet-week reassurance names whichever persona THIS account
  // configured, not a hard-coded "Sofía" — some clients rename their
  // receptionist on the voice profile (persona_name).
  it("names the account's OWN configured receptionist persona, not a hard-coded 'Sofía'", () => {
    const { text } = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: false, receptionistName: "Max" },
    });
    expect(text).toMatch(/Max is still answering/);
    expect(text).not.toMatch(/Sofía/);
  });

  it("falls back to 'Sofía' when no persona name is given (e.g. a null voice profile)", () => {
    const { text } = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: true, textBack: false },
    });
    expect(text).toMatch(/Sofía is still answering/);
  });

  it("carries both an html and a text part — never html alone", () => {
    const out = weeklyReportEmail({
      brand, now: week, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    // The text alternative is what keeps a branded message out of the spam
    // bucket; SendEmailInput.html's own comment says never send it without body.
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.html).toContain("<");
    expect(out.text).not.toContain("<td");
  });

  it("escapes the brand name — it reaches an inbox", () => {
    const hostile = emailBrandNamed(branding, 'Rio "Best" <Roofing>');
    const { html } = weeklyReportEmail({
      brand: hostile, now: week, prior: null, dashboardUrl: null, reassurance: nothingOn,
    });
    expect(html).not.toContain("<Roofing>");
  });

  it("renders the deltas when a prior week exists", () => {
    const { text } = weeklyReportEmail({
      brand, now: week, prior: { calls: 9, leads: 4, bookings: 3, visitors: 74 },
      dashboardUrl: null, reassurance: nothingOn,
    });
    expect(text).toContain("3 more than the week before");
    expect(text).toContain("same as the week before");
    expect(text).toContain("1 fewer than the week before");
  });
});

describe("weeklyReportSubject (D-064, review round 2)", () => {
  it("says quiet when the pipeline AND the website (if measured) are both empty", () => {
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 0 })).toBe("Last week was quiet");
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: null })).toBe("Last week was quiet");
  });

  // The pipeline is still quiet (no calls, no leads, no bookings) — the
  // subject leads with the one true number that week actually had,
  // instead of claiming "quiet" over a week that had real visitors, or
  // falling back to "0 calls, 0 new leads" (review round 1's mistake).
  it("leads with the visitors count when the pipeline is quiet but the website had real visitors (mutation: fall back to the quiet or the 0-calls subject → FAILS)", () => {
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 50 }))
      .toBe("Last week: 50 website visitors");
  });

  // Review round 3: "1 website visitors" is a grammar bug the plural fixture
  // above could never catch (50 is plural either way). Both counts pinned
  // here so one case cannot regress without the other noticing.
  it("singular: 1 website visitor, not 1 website visitors (mutation: drop the singular branch → FAILS)", () => {
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 1 }))
      .toBe("Last week: 1 website visitor");
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 2 }))
      .toBe("Last week: 2 website visitors");
  });

  it("leads with calls/leads, unaffected, when the pipeline itself is not quiet", () => {
    expect(weeklyReportSubject({ calls: 12, leads: 4, bookings: 2, visitors: 86 }))
      .toBe("Last week: 12 calls, 4 new leads");
  });

  // S-10 T8: `locale` as a SECOND argument, English by default, so every
  // 1-arg call above keeps its exact prior output.
  it("in Spanish (mutation: drop the locale argument from any t()/plural() call → FAILS)", () => {
    expect(weeklyReportSubject({ calls: 12, leads: 4, bookings: 2, visitors: 86 }, "es"))
      .toBe("La semana pasada: 12 llamadas, 4 nuevos clientes potenciales");
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 50 }, "es"))
      .toBe("La semana pasada: 50 visitantes del sitio web");
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: 1 }, "es"))
      .toBe("La semana pasada: 1 visitante del sitio web");
    expect(weeklyReportSubject({ calls: 0, leads: 0, bookings: 0, visitors: null }, "es"))
      .toBe("La semana pasada estuvo tranquila");
  });
});

describe("S-10 T8: weeklyReportEmail and weeklyReportSubject in Spanish, usted, subject through footer", () => {
  // S-10 T8 review round 1, finding 3: narrowed from "renders a non-quiet
  // week's subject, body and CTA ... in both the html and text parts" —
  // the subject has no html/text split (it is one string), so the title
  // claimed coverage this test never had.
  it("renders a non-quiet week's body and CTA in Spanish, in both the html and text parts, and its own subject in Spanish too (mutation: pass \"en\" at any one t()/plural() call site → FAILS)", () => {
    const { html, text } = weeklyReportEmail({
      brand, now: week, prior: { calls: 9, leads: 4, bookings: 3, visitors: 74 },
      dashboardUrl: "https://x.example/dashboard", reassurance: nothingOn, locale: "es",
    });
    expect(weeklyReportSubject(week, "es")).toBe("La semana pasada: 12 llamadas, 4 nuevos clientes potenciales");
    expect(text).toContain("Así le fue la semana pasada.");
    expect(text).toContain("llamadas atendidas");
    expect(text).toContain("clientes potenciales captados");
    expect(text).toContain("citas");
    expect(text).toContain("visitantes del sitio web");
    expect(text).toContain("3 más que la semana anterior");
    expect(text).toContain("igual que la semana anterior");
    expect(text).toContain("1 menos que la semana anterior");
    expect(text).toContain("Abrir su panel: https://x.example/dashboard");
    expect(html).toContain("Así le fue la semana pasada.");
    expect(html).toContain("Abrir su panel");
    // usted, never tú.
    expect(text).not.toMatch(/\btu\b|\btus\b|\binténtalo\b/i);
  });

  it("renders the quiet-week body in Spanish, with the reassurance and a real visitor count, in both parts (mutation: hard-code \"en\" in quietBody's html branch → FAILS, where the text-only check above could not)", () => {
    const { html, text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 50 }, prior: null,
      dashboardUrl: null, reassurance: { receptionist: true, textBack: true, receptionistName: "Max" },
      locale: "es",
    });
    expect(text).toBe(
      "No llegó nada la semana pasada — sin llamadas, sin clientes potenciales, sin citas.\n\n"
      + "Su sitio web tuvo 50 visitantes la semana pasada.\n\n"
      + "Max sigue atendiendo y su texto por llamada perdida sigue activo.",
    );
    expect(html).toContain("La semana pasada estuvo tranquila");
    // S-10 T8 review round 1, finding 3: the QUIET BODY SENTENCE itself,
    // asserted in the HTML part — only the heading and the reassurance were
    // checked in html before this, so a hard-coded "en" surviving just this
    // one sentence's html branch had nothing to catch it.
    expect(html).toContain("No llegó nada la semana pasada &mdash; sin llamadas, sin clientes potenciales, sin citas.");
    expect(html).toContain("Su sitio web tuvo 50 visitantes la semana pasada.");
    expect(html).toContain("Max sigue atendiendo");
  });

  it("text-back alone starts the Spanish reassurance sentence with a capital too (mutation: drop the capitalisation step → \"su texto…\" FAILS)", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: null }, prior: null,
      dashboardUrl: null, reassurance: { receptionist: false, textBack: true }, locale: "es",
    });
    expect(text).toContain("Su texto por llamada perdida sigue activo.");
    expect(text).not.toContain("su texto por llamada perdida sigue activo.");
  });

  it("singular visitor count stays grammatical in Spanish: 1 visitante, not 1 visitantes", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: 1 }, prior: null,
      dashboardUrl: null, reassurance: nothingOn, locale: "es",
    });
    expect(text).toContain("Su sitio web tuvo 1 visitante la semana pasada.");
    expect(text).not.toContain("1 visitantes");
  });

  it("the CTA is omitted from the text footer when there is no dashboard url, in Spanish too", () => {
    const { text } = weeklyReportEmail({
      brand, now: week, prior: null, dashboardUrl: null, reassurance: nothingOn, locale: "es",
    });
    expect(text).not.toContain("Abrir su panel");
  });
});

// S-10 T8 review round 1, finding 2: "1 llamadas" and "1 calls answered" are
// both wrong — every row label and the pipeline subject now agree with
// their OWN count at 1, in both languages, through plural() rather than a
// flat t() lookup. Each row tested at 1 (singular) and 2 (plural) so one
// cannot regress without the other noticing (the same discipline the
// existing visitors singular/plural tests already use).
describe("S-10 T8 review round 1, finding 2: row labels and the pipeline subject agree with their count at 1", () => {
  // `toContain` on the LINE ARRAY (exact-element match), never on the raw
  // string: "booking"/"cita" are genuine substrings of "bookings"/"citas",
  // so a loose string .toContain would pass even for the wrong (plural)
  // row — splitting into lines first and matching a whole line is what
  // makes this assertion able to fail on exactly the bug finding 2 named.
  it("English: each row reads singular at 1 and plural at 2 (mutation: use t() instead of plural() for any row → \"1 calls answered\" etc. FAILS)", () => {
    const linesAt = (n: number) => weeklyReportEmail({
      brand, now: { calls: n, leads: n, bookings: n, visitors: n }, prior: null,
      dashboardUrl: null, reassurance: nothingOn,
    }).text.split("\n");

    const one = linesAt(1);
    expect(one).toContain("1 call answered");
    expect(one).toContain("1 lead captured");
    expect(one).toContain("1 booking");
    expect(one).toContain("1 website visitor");
    expect(one).not.toContain("1 calls answered");
    expect(one).not.toContain("1 leads captured");
    expect(one).not.toContain("1 bookings");
    expect(one).not.toContain("1 website visitors");

    const two = linesAt(2);
    expect(two).toContain("2 calls answered");
    expect(two).toContain("2 leads captured");
    expect(two).toContain("2 bookings");
    expect(two).toContain("2 website visitors");
  });

  it("Spanish: each row reads singular at 1 and plural at 2", () => {
    const linesAt = (n: number) => weeklyReportEmail({
      brand, now: { calls: n, leads: n, bookings: n, visitors: n }, prior: null,
      dashboardUrl: null, reassurance: nothingOn, locale: "es",
    }).text.split("\n");

    const one = linesAt(1);
    expect(one).toContain("1 llamada atendida");
    expect(one).toContain("1 cliente potencial captado");
    expect(one).toContain("1 cita");
    expect(one).toContain("1 visitante del sitio web");
    expect(one).not.toContain("1 llamadas atendidas");
    expect(one).not.toContain("1 clientes potenciales captados");
    expect(one).not.toContain("1 citas");
    expect(one).not.toContain("1 visitantes del sitio web");

    const two = linesAt(2);
    expect(two).toContain("2 llamadas atendidas");
    expect(two).toContain("2 clientes potenciales captados");
    expect(two).toContain("2 citas");
    expect(two).toContain("2 visitantes del sitio web");
  });

  it("the pipeline subject agrees independently for calls and leads, at 1 and at 2, in English", () => {
    expect(weeklyReportSubject({ calls: 1, leads: 1, bookings: 0, visitors: null }))
      .toBe("Last week: 1 call, 1 new lead");
    expect(weeklyReportSubject({ calls: 2, leads: 2, bookings: 0, visitors: null }))
      .toBe("Last week: 2 calls, 2 new leads");
    // Independent counts: one call, three new leads — neither borrows the other's form.
    expect(weeklyReportSubject({ calls: 1, leads: 3, bookings: 0, visitors: null }))
      .toBe("Last week: 1 call, 3 new leads");
  });

  it("the pipeline subject agrees independently for calls and leads, at 1 and at 2, in Spanish (mutation: drive both nouns off one count → FAILS)", () => {
    expect(weeklyReportSubject({ calls: 1, leads: 1, bookings: 0, visitors: null }, "es"))
      .toBe("La semana pasada: 1 llamada, 1 nuevo cliente potencial");
    expect(weeklyReportSubject({ calls: 2, leads: 2, bookings: 0, visitors: null }, "es"))
      .toBe("La semana pasada: 2 llamadas, 2 nuevos clientes potenciales");
    expect(weeklyReportSubject({ calls: 1, leads: 3, bookings: 0, visitors: null }, "es"))
      .toBe("La semana pasada: 1 llamada, 3 nuevos clientes potenciales");
  });
});
