import { shell, button, escapeHtml, type EmailBrand } from "./shell";
import type { WeeklyNumbers } from "@/lib/reports/weekly-metrics";

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
};

/**
 * "3 more than the week before", not "▲3".
 *
 * Words rather than an arrow, in every part: an arrow is meaningless in the
 * text/plain alternative, unreadable to a screen reader, and renders
 * inconsistently across mail clients. Empty string when there is no prior
 * week — the caller renders the number alone rather than inventing a baseline.
 */
export function deltaPhrase(now: number, prior: number | null): string {
  if (prior === null) return "";
  const diff = now - prior;
  if (diff === 0) return "same as the week before";
  const size = Math.abs(diff);
  return `${size} ${diff > 0 ? "more" : "fewer"} than the week before`;
}

type Line = { value: number; label: string; delta: string };

function lines(input: WeeklyReportInput): Line[] {
  const { now, prior } = input;
  const out: Line[] = [
    { value: now.calls, label: "calls answered", delta: deltaPhrase(now.calls, prior?.calls ?? null) },
    { value: now.leads, label: "leads captured", delta: deltaPhrase(now.leads, prior?.leads ?? null) },
    { value: now.bookings, label: "bookings", delta: deltaPhrase(now.bookings, prior?.bookings ?? null) },
  ];
  // OMITTED, not zeroed. `visitors === null` means no site is linked, and a
  // client without one would otherwise read "0 visitors" every Monday and
  // conclude their website is dead.
  if (now.visitors !== null) {
    out.push({
      value: now.visitors, label: "website visitors",
      delta: deltaPhrase(now.visitors, prior?.visitors ?? null),
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
function visitorsSentence(now: WeeklyNumbers): string | null {
  if (now.visitors === null || now.visitors === 0) return null;
  const noun = now.visitors === 1 ? "visitor" : "visitors";
  return `Your website had ${now.visitors} ${noun} last week.`;
}

function quietBody(input: WeeklyReportInput): { html: string; text: string } {
  const { receptionist, textBack, receptionistName } = input.reassurance;
  const persona = receptionistName?.trim() || "Sofía";
  const running = [
    receptionist ? `${persona} is still answering` : null,
    textBack ? "your missed-call text-back is still on" : null,
  ].filter(Boolean) as string[];

  const reassurance = running.length > 0
    ? `${running.join(", and ")}.`
    : "";
  const visitors = visitorsSentence(input.now);

  const text = [
    "Nothing came in last week — no calls, no leads, no bookings.",
    visitors,
    reassurance,
  ].filter(Boolean).join("\n\n");

  const html = [
    `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">Last week was quiet</p>`,
    `<p style="margin:0 0 16px;color:#71717a;">Nothing came in last week &mdash; no calls, no leads, no bookings.</p>`,
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
  const { now } = input;
  const isQuiet = isQuietPipeline(now);

  const body = isQuiet ? quietBody(input) : (() => {
    const rows = lines(input);
    const text = ["Here's how last week went.", "",
      ...rows.map((l) => `${l.value} ${l.label}${l.delta ? ` — ${l.delta}` : ""}`),
    ].join("\n");
    const html = [
      `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">Here's how last week went.</p>`,
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

  const cta = input.dashboardUrl
    ? button(input.brand, input.dashboardUrl, "Open your dashboard")
    : "";

  return {
    html: shell(input.brand, body.html + cta),
    // The text alternative is composed deliberately rather than derived by
    // stripping tags — it is what keeps a branded message out of the spam
    // bucket and readable in a text client.
    text: [body.text, input.dashboardUrl ? `\nOpen your dashboard: ${input.dashboardUrl}` : ""]
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
export function weeklyReportSubject(now: WeeklyNumbers): string {
  if (isQuietPipeline(now)) {
    if (now.visitors !== null && now.visitors > 0) {
      const noun = now.visitors === 1 ? "visitor" : "visitors";
      return `Last week: ${now.visitors} website ${noun}`;
    }
    return "Last week was quiet";
  }
  return `Last week: ${now.calls} calls, ${now.leads} new leads`;
}
