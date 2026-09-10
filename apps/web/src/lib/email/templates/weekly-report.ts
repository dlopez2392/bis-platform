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
   *  do not have one is worse than saying nothing. */
  reassurance: { receptionist: boolean; textBack: boolean };
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

function quietBody(input: WeeklyReportInput): { html: string; text: string } {
  const { receptionist, textBack } = input.reassurance;
  const running = [
    receptionist ? "Sofía is still answering" : null,
    textBack ? "your missed-call text-back is still on" : null,
  ].filter(Boolean) as string[];

  const reassurance = running.length > 0
    ? `${running.join(", and ")}.`
    : "";

  const text = [
    "Nothing came in last week — no calls, no leads, no bookings.",
    reassurance,
  ].filter(Boolean).join("\n\n");

  const html = [
    `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">Last week was quiet</p>`,
    `<p style="margin:0 0 16px;color:#71717a;">Nothing came in last week &mdash; no calls, no leads, no bookings.</p>`,
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
  const isQuiet = now.calls === 0 && now.leads === 0 && now.bookings === 0;

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

/** The subject line. A number is what gets it opened; a quiet week says so. */
export function weeklyReportSubject(now: WeeklyNumbers): string {
  if (now.calls === 0 && now.leads === 0 && now.bookings === 0) return "Last week was quiet";
  return `Last week: ${now.calls} calls, ${now.leads} new leads`;
}
