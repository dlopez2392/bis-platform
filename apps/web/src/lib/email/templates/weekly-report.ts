import { shell, button, escapeHtml, type EmailBrand } from "./shell";
import type { WeeklyNumbers } from "@/lib/reports/weekly-metrics";
import { m } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

export type WeeklyReportInput = {
  brand: EmailBrand;
  now: WeeklyNumbers;
  /** null when no honest comparison exists — the prior window predates the
   *  account, so there is no "week before" to measure against. */
  prior: WeeklyNumbers | null;
  dashboardUrl: string | null;
  /** Each flag is claimed in the quiet-week copy ONLY when it is true of this
   *  account. Telling a client their receptionist is still answering when they
   *  do not have one is worse than saying nothing.
   *
   *  `receptionistName` (D-063): the account's OWN configured persona
   *  (`voice_profiles.persona_name`) — some clients rename their
   *  receptionist, and a quiet-week email that says "Sofía is still
   *  answering" regardless is wrong for every one of them. Falls back to
   *  "Sofía" (the column's own default, 0019_voice_core.sql) only when the
   *  caller omits it or passes an empty string — never silently to a blank
   *  sentence. */
  reassurance: { receptionist: boolean; textBack: boolean; receptionistName?: string };
  /** S-10 T8: `accounts.language ?? "en"` — one email, one language, subject
   *  through footer (spec §3.3). Never the recipient's own language: none of
   *  these addresses is a `users` row. English when absent. */
  locale?: Locale;
};

/**
 * "3 more than the week before", not "▲3".
 *
 * Words rather than an arrow, in every part: an arrow is meaningless in the
 * text/plain alternative, unreadable to a screen reader, and renders
 * inconsistently across mail clients. Empty string when there is no prior
 * week — the caller renders the number alone rather than inventing a baseline.
 *
 * Spanish's "más"/"menos" do not inflect by count the way some languages'
 * quantity words do, but the One/Other split still runs through `plural()`
 * (not a plain `t()` call) so the mechanism this catalogue uses for every
 * other counted phrase stays uniform here too, and so a future language that
 * DOES need a different singular form has somewhere to put it.
 */
export function deltaPhrase(now: number, prior: number | null, locale: Locale = "en"): string {
  if (prior === null) return "";
  const diff = now - prior;
  if (diff === 0) return t(m, "email.weeklyReport.delta.same", locale);
  const size = Math.abs(diff);
  const key: "email.weeklyReport.delta.more" | "email.weeklyReport.delta.fewer" =
    diff > 0 ? "email.weeklyReport.delta.more" : "email.weeklyReport.delta.fewer";
  return plural(m, key, size, locale, { size });
}

type Line = { value: number; label: string; delta: string };

// S-10 T8 review round 1, finding 2: each row label agrees with its own
// value at 1 ("1 call answered", never "1 calls answered"), in both
// languages — `plural()`, never a flat `t()` lookup, picks the word form.
function lines(input: WeeklyReportInput): Line[] {
  const { now, prior } = input;
  const locale = input.locale ?? "en";
  const out: Line[] = [
    {
      value: now.calls, label: plural(m, "email.weeklyReport.label.calls", now.calls, locale),
      delta: deltaPhrase(now.calls, prior?.calls ?? null, locale),
    },
    {
      value: now.leads, label: plural(m, "email.weeklyReport.label.leads", now.leads, locale),
      delta: deltaPhrase(now.leads, prior?.leads ?? null, locale),
    },
    {
      value: now.bookings, label: plural(m, "email.weeklyReport.label.bookings", now.bookings, locale),
      delta: deltaPhrase(now.bookings, prior?.bookings ?? null, locale),
    },
  ];
  // OMITTED, not zeroed. `visitors === null` means no site is linked, and a
  // client without one would otherwise read "0 visitors" every Monday and
  // conclude their website is dead.
  if (now.visitors !== null) {
    out.push({
      value: now.visitors, label: plural(m, "email.weeklyReport.label.visitors", now.visitors, locale),
      delta: deltaPhrase(now.visitors, prior?.visitors ?? null, locale),
    });
  }
  return out;
}

/**
 * D-064 (review round 2): "quiet" is the PIPELINE — calls, leads and
 * bookings — and only that. Round 1 folded visitors into this check too,
 * which fixed the wrong thing: it kept a measured, nonzero visitor count
 * from being swallowed by routing a visitors-only week to the FULL,
 * four-zero-row table instead — exactly the report-card-of-zeros copy
 * DESIGN.md's own rule says a quiet week must never get. The pipeline
 * being quiet still earns the quiet body; what changes is that the body
 * now says so, below, when the website had something to report.
 */
function isQuietPipeline(now: WeeklyNumbers): boolean {
  return now.calls === 0 && now.leads === 0 && now.bookings === 0;
}

/** A measured, nonzero visitor count is never omitted, even inside the
 *  quiet-pipeline body — only a metric we didn't measure (`null`) or one
 *  that was genuinely quiet too (`0`) stays silent about it. */
function visitorsSentence(now: WeeklyNumbers, locale: Locale): string | null {
  if (now.visitors === null || now.visitors === 0) return null;
  return plural(m, "email.weeklyReport.visitors", now.visitors, locale, { count: now.visitors });
}

/** Escapes, then swaps the plain em dash for its HTML entity — the same
 *  rendering the hand-written English literal used, now applied to whatever
 *  locale's catalogue string is in play. */
function withMdash(s: string): string {
  return escapeHtml(s).replace(/—/g, "&mdash;");
}

function quietBody(input: WeeklyReportInput): { html: string; text: string } {
  const locale = input.locale ?? "en";
  const { receptionist, textBack, receptionistName } = input.reassurance;
  // The persona's OWN name is never translated — it is what the account
  // typed in, not platform copy.
  const persona = receptionistName?.trim() || "Sofía";
  const join = t(m, "email.weeklyReport.reassurance.join", locale);
  const running = [
    receptionist ? t(m, "email.weeklyReport.reassurance.receptionist", locale, { persona }) : null,
    textBack ? t(m, "email.weeklyReport.reassurance.textBack", locale) : null,
  ].filter(Boolean) as string[];

  // S-10 T8 review round 1, finding 5: when the receptionist clause is OFF
  // and only the text-back one runs, the sentence used to start with that
  // clause's own lower-case first word ("your…"/"su…") — a continuation
  // clause, never meant to stand alone as a sentence. Capitalised here,
  // once, after the join, rather than in either catalogue entry: the
  // receptionist clause already starts with a capitalised persona name, so
  // this is a no-op there and fixes only the case that needed it.
  const joined = running.join(join);
  const reassurance = joined
    ? `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
    : "";
  const visitors = visitorsSentence(input.now, locale);
  const quietHeading = t(m, "email.weeklyReport.quiet.heading", locale);
  const quietBodySentence = t(m, "email.weeklyReport.quiet.body", locale);

  const text = [
    quietBodySentence,
    visitors,
    reassurance,
  ].filter(Boolean).join("\n\n");

  const html = [
    `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(quietHeading)}</p>`,
    `<p style="margin:0 0 16px;color:#71717a;">${withMdash(quietBodySentence)}</p>`,
    visitors ? `<p style="margin:0 0 16px;color:#71717a;">${escapeHtml(visitors)}</p>` : "",
    reassurance ? `<p style="margin:0 0 16px;color:#71717a;">${escapeHtml(reassurance)}</p>` : "",
  ].filter(Boolean).join("");

  return { html, text };
}

/**
 * The client's Monday email.
 *
 * A quiet week gets its OWN body rather than four zero rows: a report card of
 * zeros arriving every Monday is a weekly argument for cancelling, delivered
 * by us. It still sends — silence would leave the client unable to tell a
 * quiet week from a broken product.
 */
export function weeklyReportEmail(input: WeeklyReportInput): { html: string; text: string } {
  const locale = input.locale ?? "en";
  const { now } = input;
  const isQuiet = isQuietPipeline(now);

  const body = isQuiet ? quietBody(input) : (() => {
    const rows = lines(input);
    const heading = t(m, "email.weeklyReport.heading", locale);
    const text = [heading, "",
      ...rows.map((l) => `${l.value} ${l.label}${l.delta ? ` — ${l.delta}` : ""}`),
    ].join("\n");
    const html = [
      `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(heading)}</p>`,
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">`,
      ...rows.map((l) =>
        `<tr>`
        + `<td style="padding:4px 12px 4px 0;font-size:20px;font-weight:600;vertical-align:top;">${l.value}</td>`
        + `<td style="padding:4px 0;vertical-align:top;">${escapeHtml(l.label)}`
        + (l.delta ? `<span style="color:#71717a;"> &mdash; ${escapeHtml(l.delta)}</span>` : "")
        + `</td></tr>`),
      `</table>`,
    ].join("");
    return { html, text };
  })();

  const cta = t(m, "email.weeklyReport.cta", locale);
  const ctaHtml = input.dashboardUrl
    ? button(input.brand, input.dashboardUrl, cta)
    : "";

  return {
    html: shell(input.brand, body.html + ctaHtml),
    // The text alternative is composed deliberately rather than derived by
    // stripping tags — it is what keeps a branded message out of the spam
    // bucket and readable in a text client.
    text: [body.text, input.dashboardUrl ? `\n${cta}: ${input.dashboardUrl}` : ""]
      .filter(Boolean).join("\n"),
  };
}

/**
 * The subject line. A number is what gets it opened. D-064 (review round
 * 2): a quiet PIPELINE with a real visitors count leads with THAT number
 * rather than claiming "quiet" (false — the website had a week) or
 * falling back to "0 calls, 0 new leads" (round 1's mistake — that's the
 * four-zero-row framing the body itself refuses to send).
 */
export function weeklyReportSubject(now: WeeklyNumbers, locale: Locale = "en"): string {
  if (isQuietPipeline(now)) {
    if (now.visitors !== null && now.visitors > 0) {
      return plural(m, "email.weeklyReport.subject.visitors", now.visitors, locale, { count: now.visitors });
    }
    return t(m, "email.weeklyReport.quiet.heading", locale);
  }
  // S-10 T8 review round 1, finding 2: calls and leads agree with their OWN
  // counts independently ("1 call, 3 new leads" is a real case) — each
  // phrase is built through its own plural() before the sentence composes
  // them, never a single count driving the whole template's number.
  const calls = plural(m, "email.weeklyReport.subject.pipeline.calls", now.calls, locale, { count: now.calls });
  const leads = plural(m, "email.weeklyReport.subject.pipeline.leads", now.leads, locale, { count: now.leads });
  return t(m, "email.weeklyReport.subject.pipeline", locale, { calls, leads });
}
