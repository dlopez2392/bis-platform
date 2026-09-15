import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The public booking and form surfaces ship hand-written CSS — a <style> block
 * on the page and one inline style object on the error boundary — because they
 * render for a client's CUSTOMER, outside the dashboard's token layer, and have
 * to stand on their own with no stylesheet to inherit from.
 *
 * Hand-written CSS fails silently. An invalid declaration is not an error; the
 * browser drops that one line and paints whatever was underneath. Nothing in
 * `tsc`, eslint or the e2e suite looks at it, which is how
 * `font: 600 15px inherit` sat on the cancel page's primary button from P7
 * until 2026-09-15, rendering it at the UA default (measured: 13.3px Arial 400)
 * instead of the page's 15px at 600 — in front of clients' customers the whole
 * time. It was even noted in the Sept 3 roadmap as "pre-existing, cheap, and
 * visible to customers" and still did not get fixed, because nothing failed.
 */
const PUBLIC_SOURCES = [
  "b/[publicId]/booking-page.tsx",
  "b/[publicId]/cancel/[token]/page.tsx",
  "b/error.tsx",
  "f/[publicId]/form.css",
  "f/[publicId]/form-page.tsx",
];

const APP = path.join(process.cwd(), "src", "app");

function readIfPresent(rel: string): string | null {
  const full = path.join(APP, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

/**
 * Comments out, before anything reads declarations. The first run of the rule
 * below flagged this very file's prose, which quotes the bad declaration in
 * order to explain it — a scanner that cannot tell code from a comment reports
 * the documentation as the defect.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("public surface CSS", () => {
  /**
   * A CSS-wide keyword (`inherit`, `initial`, `unset`, `revert`) is only legal
   * as a property's SOLE value. Used as one COMPONENT of a shorthand it
   * invalidates the entire declaration — so `font: 600 15px inherit` sets
   * nothing at all, rather than the "inherit the family, override size and
   * weight" it reads as.
   *
   * `font: inherit` alone is correct and used throughout these files; the
   * repair for the other case is `font: inherit` plus the individual
   * longhands, which is what booking-page.tsx's own submit button does.
   */
  it("never uses a CSS-wide keyword as one part of a `font` shorthand", () => {
    const KEYWORDS = /\b(inherit|initial|unset|revert)\b/;
    const offenders: string[] = [];

    for (const rel of PUBLIC_SOURCES) {
      const raw = readIfPresent(rel);
      if (raw === null) continue;
      const src = stripComments(raw);
      // Both `font: 600 15px inherit;` in a style block and
      // `font: "600 15px inherit",` in a React style object.
      for (const m of src.matchAll(/\bfont:\s*(?:"([^"]*)"|([^;,\n}]*))/g)) {
        const value = (m[1] ?? m[2] ?? "").trim();
        if (!value || !KEYWORDS.test(value)) continue;
        if (KEYWORDS.exec(value)![0] === value) continue; // the sole value: legal
        offenders.push(`${rel}: font: ${value}`);
      }
    }

    expect(
      offenders,
      `A CSS-wide keyword is only legal as a whole value. These declarations are ` +
      `invalid and the browser drops them silently:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * Buttons and inputs do not inherit the page's font — every UA stylesheet
   * sets one on form controls. So each public control has to say `font: inherit`
   * explicitly, and a control that forgets renders in the browser default while
   * the text beside it does not. That is the defect the rule above catches
   * spelled wrong; this catches it left out.
   */
  it("gives every public control an explicit font", () => {
    const css = readIfPresent("f/[publicId]/form.css");
    expect(css).not.toBeNull();
    // The text inputs share one rule with the textarea; the submit has its own.
    for (const selector of ['.bis-form input[type="text"]', ".bis-form-submit {"]) {
      const at = css!.indexOf(selector);
      expect(at, `${selector} not found — did the class names change?`).toBeGreaterThan(-1);
      const block = css!.slice(at, css!.indexOf("}", at));
      expect(block, `${selector} must set an explicit font`).toMatch(/font:\s*inherit/);
    }
  });
});
