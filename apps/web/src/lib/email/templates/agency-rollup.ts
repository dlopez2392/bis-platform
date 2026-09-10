import { shell, escapeHtml, type EmailBrand } from "./shell";
import { deltaPhrase } from "./weekly-report";
import type { WeeklyNumbers } from "@/lib/reports/weekly-metrics";

/**
 * One account's line in the agency roll-up.
 *
 * `brandName` and NEVER an account name: `accounts.name` is the agency's
 * internal label ("Rio Roofing — trial") and it has reached customers three
 * times. This row names a real company to a real human reading their own
 * mail, so the same rule the client-facing types already enforce applies
 * here too — a recipe author cannot leak what a row cannot carry.
 *
 * `hasRecipients` is what makes a client silently receiving nothing VISIBLE
 * to the agency (spec 2026-09-10-weekly-report-design, "weeklyAgencyReportPass")
 * — an account with none still gets a row, marked, rather than being dropped.
 */
export type RollupRow = {
  brandName: string;
  numbers: WeeklyNumbers;
  /** null when no honest comparison exists for THIS account — same
   *  fabricated-delta guard as the client email, applied per row. */
  prior: WeeklyNumbers | null;
  hasRecipients: boolean;
};

export type AgencyRollupInput = {
  brand: EmailBrand;
  rows: RollupRow[];
};

const NOT_RECEIVING = "Nobody is receiving this";

type Line = { value: number; label: string; delta: string };

/**
 * The same four-line shape `weekly-report.ts`'s own (private) `lines()`
 * builds for the client email, reused per row here via the one function that
 * module DOES export — `deltaPhrase` — rather than a second, drifting copy of
 * the delta wording.
 *
 * Website visitors is OMITTED, not zeroed, when `numbers.visitors` is null:
 * a zero this account's report did not measure must not look like a zero it
 * did. Nothing in this row's markup ever names "visitors" for it — not even
 * a placeholder — which is what keeps a zero the reader can't tell apart
 * from an absence out of the mail entirely.
 */
function lines(numbers: WeeklyNumbers, prior: WeeklyNumbers | null): Line[] {
  const out: Line[] = [
    { value: numbers.calls, label: "calls answered", delta: deltaPhrase(numbers.calls, prior?.calls ?? null) },
    { value: numbers.leads, label: "leads captured", delta: deltaPhrase(numbers.leads, prior?.leads ?? null) },
    { value: numbers.bookings, label: "bookings", delta: deltaPhrase(numbers.bookings, prior?.bookings ?? null) },
  ];
  if (numbers.visitors !== null) {
    out.push({
      value: numbers.visitors, label: "website visitors",
      delta: deltaPhrase(numbers.visitors, prior?.visitors ?? null),
    });
  }
  return out;
}

function rowHtml(row: RollupRow): string {
  const items = lines(row.numbers, row.prior)
    .map((l) => `${l.value} ${escapeHtml(l.label)}${l.delta ? ` &mdash; ${escapeHtml(l.delta)}` : ""}`)
    .join(" &middot; ");
  const marker = row.hasRecipients
    ? ""
    : `<span style="color:#b91c1c;font-weight:600;"> &mdash; ${escapeHtml(NOT_RECEIVING)}</span>`;
  return `<tr><td style="padding:10px 0;border-top:1px solid #e4e4e7;">`
    + `<div style="font-weight:600;">${escapeHtml(row.brandName)}${marker}</div>`
    + `<div style="color:#71717a;font-size:13px;padding-top:2px;">${items}</div>`
    + `</td></tr>`;
}

function rowText(row: RollupRow): string {
  const items = lines(row.numbers, row.prior)
    .map((l) => `${l.value} ${l.label}${l.delta ? ` (${l.delta})` : ""}`)
    .join(", ");
  const marker = row.hasRecipients ? "" : ` — ${NOT_RECEIVING}`;
  return `${row.brandName}${marker}\n  ${items}`;
}

/**
 * The agency's Monday roll-up: every account, one line each, including one
 * nobody is receiving. Operator-facing mail, so it spends structure a
 * customer-facing message would not (spec, "The emails") — a plain table
 * rather than the client email's quiet-week prose, because there is no
 * quiet-week copy that reads sensibly across a whole book of accounts at
 * once.
 */
export function agencyRollupEmail(input: AgencyRollupInput): { html: string; text: string } {
  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">Last week, across every account</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;">
      ${input.rows.map(rowHtml).join("")}
    </table>
  `);

  const text = ["Last week, across every account.", "", ...input.rows.map(rowText)].join("\n");

  return { html, text };
}
