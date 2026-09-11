import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrandNamed } from "./shell";
import { agencyRollupEmail, type RollupRow } from "./agency-rollup";
import type { WeeklyNumbers } from "@/lib/reports/weekly-metrics";

/**
 * The agency roll-up has no client branding to draw on — it is BIS's own
 * mail, not a client's — so the fixture matches how `weekly-agency-report.ts`
 * itself builds the brand: `emailBrandNamed` with every visual field null,
 * which degrades to the platform's own unthemed default. Same `UNBRANDED`
 * shape as `shell.test.ts`.
 */
const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const BRAND = emailBrandNamed(UNBRANDED, "BIS");

const WEEK: WeeklyNumbers = { calls: 12, leads: 4, bookings: 2, visitors: 86 };

/** Distinctive, complete fixture. NO accountName — the type does not have one. */
function row(overrides: Partial<RollupRow> = {}): RollupRow {
  return { brandName: "Rio Roofing", numbers: WEEK, prior: null, hasRecipients: true, ...overrides };
}

describe("agencyRollupEmail", () => {
  it("lists every account, including ones nobody is receiving", () => {
    const { text } = agencyRollupEmail({
      brand: BRAND,
      rows: [
        row({ brandName: "Rio Roofing", hasRecipients: true }),
        row({
          brandName: "Valley Air", hasRecipients: false,
          numbers: { calls: 0, leads: 0, bookings: 0, visitors: null },
        }),
      ],
    });
    expect(text).toContain("Rio Roofing");
    expect(text).toContain("Valley Air");
  });

  it("marks an account with no recipients, so silence is visible", () => {
    const { text, html } = agencyRollupEmail({
      brand: BRAND,
      rows: [
        row({ brandName: "Rio Roofing", hasRecipients: true }),
        row({ brandName: "Valley Air", hasRecipients: false }),
      ],
    });
    // The marker sits WITH the row it describes, not merely anywhere in the
    // mail — so it is Valley Air's own line that carries it, not Rio's.
    const rioLine = text.split("\n").find((l) => l.includes("Rio Roofing"))!;
    const valleyLine = text.split("\n").find((l) => l.includes("Valley Air"))!;
    expect(valleyLine).toContain("Nobody is receiving this");
    expect(rioLine).not.toContain("Nobody is receiving this");
    expect(html).toContain("Nobody is receiving this");
  });

  it("never prints an internal account label", () => {
    // @ts-expect-error — RollupRow has no accountName: a row can only ever
    // carry the brand name, exactly like AccountDueWeeklyReport before it.
    const bad: RollupRow = { ...row(), accountName: "Rio Roofing — trial" };
    void bad;

    const { text, html } = agencyRollupEmail({ brand: BRAND, rows: [row({ brandName: "Rio Roofing" })] });
    expect(text).toContain("Rio Roofing");
    expect(text).not.toContain("— trial");
    expect(html).not.toContain("— trial");
  });

  it("omits a website figure for an account with no site, without printing a zero", () => {
    const { text, html } = agencyRollupEmail({
      brand: BRAND,
      rows: [row({ brandName: "Rio Roofing", numbers: { calls: 3, leads: 1, bookings: 0, visitors: null } })],
    });
    expect(text).not.toContain("0 visitors");
    expect(text).not.toMatch(/visitors/i);
    expect(html).not.toMatch(/visitors/i);
  });
});
