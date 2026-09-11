import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text pins — the house pattern (hero.test.ts): this repo has no
 * component harness, so structure is what these tests pin.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const card = readFileSync(path.join(here, "weekly-report-card.tsx"), "utf8");
const settingsActions = readFileSync(path.join(here, "actions.ts"), "utf8");
// forms/ is a SIBLING of settings/ under [accountId]/ — the parked minor this
// change closes lives there, not here.
const formsActions = readFileSync(path.join(here, "..", "forms", "actions.ts"), "utf8");

/**
 * Slices one named function's own source out of a file, so an assertion can
 * pin something true of THAT function specifically rather than "this string
 * appears somewhere in the file" — which `isValidEmail`, for instance, already
 * would before this change, via setFromEmailAction elsewhere in the same file.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`function ${name} not found in source`);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

describe("WeeklyReportCard", () => {
  it("uses useFormSubmit, never a bare form action", () => {
    expect(card).toContain("useFormSubmit");
    expect(card).not.toMatch(/<form\s+action=/);
  });

  it("posts the recipients as a named field the action can read", () => {
    expect(card).toContain('name="reportEmails"');
  });
});

describe("setReportEmailsAction", () => {
  it("validates every address before saving", () => {
    const body = functionBody(settingsActions, "setReportEmailsAction");
    expect(body).toContain("isValidEmail");
  });

  it("is agency-gated and writes through serviceDb, like setFromEmailAction beside it — accounts has no client UPDATE grant on report_emails", () => {
    const body = functionBody(settingsActions, "setReportEmailsAction");
    expect(body).toContain("requireAgencyOnlyAccountAccess");
    expect(body).toContain("serviceDb");
  });
});

describe("the parked minor: the forms notify field now validates too", () => {
  it("applies isValidEmail to the forms notify-email field (forms/actions.ts)", () => {
    expect(formsActions).toContain("isValidEmail");
  });
});
