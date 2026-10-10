// The i18n ratchet (F-012). Two baselines, ONE regeneration command — run it
// after a real translation pass lowers a count or adds Spanish twins, and
// commit the result as its own reviewable change. Never hand-edit either
// file to admit a new violation:
//
//   pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts
//
// It rewrites ratchet-baseline.json (per-file counts of un-catalogued copy
// in JSX, nonzero files only) and catalogue-baseline.json (the frozen list
// of messages.ts keys that had no ".es" twin on the day it was run), both
// from scratch, so stale entries are pruned by the regeneration itself.
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  scanFile, relativeKey, AGENCY_ONLY_ALLOWLIST, countsByFile, ratchetViolations,
  keysMissingSpanish, parityViolations, COPY_ATTRIBUTE_NAMES, AGENCY_ONLY_KEY_PREFIXES,
} from "./ratchet-scan";
import baseline from "./ratchet-baseline.json";
import catalogueBaseline from "./catalogue-baseline.json";
import { m } from "@/lib/messages";

const jsx = (body: string) => `export function X() { return ${body}; }`;

describe("scanFile — JSX text", () => {
  it("counts a raw JSX text literal as 1, and a t()-routed string as 0 (mutation: count every string-literal attribute, className included → FAILS, since 'px-2' would then count)", () => {
    expect(scanFile("x.tsx", jsx(`<p className="px-2">Loading your calls</p>`))).toBe(1);
    expect(scanFile("x.tsx", jsx(`<p className="px-2">{t(m, "x.loading", locale)}</p>`))).toBe(0);
  });

  it("skips JSX text with no letters — separators, punctuation, digits (mutation: revert to `text.trim().length > 0` → FAILS)", () => {
    for (const body of [`<p>·</p>`, `<span> — </span>`, `<p>{a} / {b}</p>`, `<p>2026</p>`, `<p>…</p>`, `<p>({n})</p>`]) {
      expect(scanFile("x.tsx", jsx(body)), body).toBe(0);
    }
  });

  it("counts letters beyond ASCII — a Spanish-only literal is still a literal (mutation: test /[A-Za-z]/ instead of \\p{L} → FAILS)", () => {
    expect(scanFile("x.tsx", jsx(`<p>Ñ</p>`))).toBe(1);
    expect(scanFile("x.tsx", jsx(`<p>¿Qué?</p>`))).toBe(1);
  });
});

describe("scanFile — attributes: only copy-bearing ones count", () => {
  // A LITERAL list, not COPY_ATTRIBUTE_NAMES itself: iterating the export
  // would make a dropped entry silently drop its own test case instead of
  // failing it.
  it.each(["placeholder", "title", "aria-label", "aria-description", "alt", "label"])(
    "counts a string-literal %s (mutation: drop it from COPY_ATTRIBUTE_NAMES → FAILS by name)",
    (attr) => {
      expect(scanFile("x.tsx", jsx(`<input ${attr}="Search calls" />`))).toBe(1);
    },
  );

  it("names exactly those six (mutation: add a seventh attribute without a test row → FAILS)", () => {
    expect([...COPY_ATTRIBUTE_NAMES].sort()).toEqual(["alt", "aria-description", "aria-label", "label", "placeholder", "title"]);
  });

  it("does not count non-copy attributes (mutation: invert back to a deny-list — count every attribute not on a short allow-list → FAILS)", () => {
    const attrs = [
      `variant="ghost"`, `size="sm"`, `id="kpi"`, `role="presentation"`, `className="px-2"`, `href="/x"`,
      `data-slot="stat-tile"`, `data-testid="x"`, `type="button"`, `name="email"`, `htmlFor="email"`,
      `rel="noreferrer"`, `target="_blank"`, `method="post"`, `autoComplete="off"`, `inputMode="tel"`,
    ];
    for (const attr of attrs) expect(scanFile("x.tsx", jsx(`<input ${attr} />`)), attr).toBe(0);
  });

  it("does not count a copy attribute with no letters — alt=\"\" on a decorative image, title=\"—\" (mutation: drop the letter check for attributes → FAILS)", () => {
    expect(scanFile("x.tsx", jsx(`<img alt="" src="/x.png" />`))).toBe(0);
    expect(scanFile("x.tsx", jsx(`<span title="—" />`))).toBe(0);
  });
});

describe("ratchetViolations — the gate fails only on a rise", () => {
  it("fails a file whose live count rises above its baseline (mutation: compare `live > allowed + 1` → FAILS)", () => {
    expect(ratchetViolations({ "a.tsx": 3 }, { "a.tsx": 2 })).toEqual([{ file: "a.tsx", live: 3, allowed: 2 }]);
  });

  it("fails a NEW file (no baseline entry) with any count at all (mutation: default a missing entry to Infinity instead of 0 → FAILS)", () => {
    expect(ratchetViolations({ "new.tsx": 1 }, {})).toEqual([{ file: "new.tsx", live: 1, allowed: 0 }]);
  });

  it("passes a new file with a zero count and a file at exactly its baseline", () => {
    expect(ratchetViolations({ "new.tsx": 0, "a.tsx": 2 }, { "a.tsx": 2 })).toEqual([]);
  });

  it("passes a count BELOW baseline — translating strings never fails the build (mutation: flag `live !== allowed` → FAILS)", () => {
    expect(ratchetViolations({ "a.tsx": 1 }, { "a.tsx": 5 })).toEqual([]);
  });

  it("passes a stale baseline entry for a file that no longer exists (mutation: flag baseline keys missing from the live scan → FAILS)", () => {
    expect(ratchetViolations({}, { "gone.tsx": 4 })).toEqual([]);
  });
});

describe("relativeKey", () => {
  it("a Windows-style absolute path and a POSIX absolute path rooted at the same apps/web directory produce the identical key (mutation: return absPath unchanged instead of stripping baseDir → FAILS) (plan-review C1)", () => {
    const winKey = relativeKey(
      "C:\\Users\\danlo\\bis-platform\\apps\\web",
      "C:\\Users\\danlo\\bis-platform\\apps\\web\\src\\components\\app-sidebar.tsx",
    );
    const posixKey = relativeKey(
      "/home/runner/work/bis-platform/apps/web",
      "/home/runner/work/bis-platform/apps/web/src/components/app-sidebar.tsx",
    );
    expect(winKey).toBe("src/components/app-sidebar.tsx");
    expect(posixKey).toBe("src/components/app-sidebar.tsx");
  });
});

describe("AGENCY_ONLY_ALLOWLIST — exactly the six agency-only top-level routes", () => {
  const excluded = (key: string) => AGENCY_ONLY_ALLOWLIST.filter((re) => re.test(key)).length;

  it.each([
    ["the accounts LIST", "src/app/(dashboard)/dashboard/accounts/page.tsx"],
    ["blueprints", "src/app/(dashboard)/dashboard/blueprints/blueprints-table.tsx"],
    ["the agency work queue", "src/app/(dashboard)/dashboard/work/agency-work-list.tsx"],
    ["phone numbers", "src/app/(dashboard)/dashboard/numbers/numbers-table.tsx"],
    ["screened calls", "src/app/(dashboard)/dashboard/screened/screened-table.tsx"],
    ["plans", "src/app/(dashboard)/dashboard/plans/plan-dialog.tsx"],
  ])("excludes %s, by exactly one pattern (mutation: delete that pattern → FAILS by name)", (_route, key) => {
    expect(excluded(key)).toBe(1);
  });

  it("has exactly six patterns (mutation: add a seventh without a test row → FAILS)", () => {
    expect(AGENCY_ONLY_ALLOWLIST).toHaveLength(6);
  });

  it("keeps every client-reachable account route scanned — billing, tasks, the dashboard's work row, contacts (mutation: widen the accounts pattern to /dashboard\\/accounts\\// → FAILS) (plan-review I1)", () => {
    for (const key of [
      "src/app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx",
      "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.tsx",
      "src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/work-row.tsx",
      "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.tsx",
    ]) expect(excluded(key), key).toBe(0);
  });
});

describe("catalogue parity — keysMissingSpanish / parityViolations", () => {
  const cat = {
    "a.one": "One", "a.one.es": "Uno",
    "a.two": "Two",
    "b.pair.en": "Hello", "b.pair.es": "Hola",
    "work.agency.title": "Work queue",
    "work.title": "To do",
  };

  it("lists a key with no .es twin and only that key (mutation: treat every key as twinned → FAILS)", () => {
    expect(keysMissingSpanish(cat)).toEqual(["a.two", "work.title"]);
  });

  it("treats a key.en / key.es pair as twinned (mutation: drop the .en stem handling → FAILS, b.pair.en is listed)", () => {
    expect(keysMissingSpanish(cat)).not.toContain("b.pair.en");
  });

  it.each(["accounts.", "blueprints.", "work.agency.", "numbers.", "screened.", "plans."])(
    "an agency-only key under %s needs no twin (mutation: drop it from AGENCY_ONLY_KEY_PREFIXES → FAILS by name)",
    (prefix) => {
      expect(keysMissingSpanish({ [`${prefix}x`]: "Agency copy" })).toEqual([]);
    },
  );

  it("has exactly those six prefixes, and work.agency. does not excuse the client's own work.* keys (mutation: widen work.agency. to work. → FAILS)", () => {
    expect([...AGENCY_ONLY_KEY_PREFIXES].sort()).toEqual(["accounts.", "blueprints.", "numbers.", "plans.", "screened.", "work.agency."]);
    expect(keysMissingSpanish({ "work.title": "To do" })).toEqual(["work.title"]);
  });

  it("parityViolations fails a missing key that is not frozen, passes a frozen one, and passes a frozen key that has since gained its twin (mutation: also fail frozen entries that are no longer missing → FAILS)", () => {
    expect(parityViolations(["a.two", "c.new"], ["a.two", "z.translatedSince"])).toEqual(["c.new"]);
  });
});

describe("the i18n ratchet, live", () => {
  // apps/web/src/lib/i18n -> apps/web, matching generate-i18n-baseline.ts's
  // own apps/web/scripts -> apps/web.
  const baseDir = path.join(__dirname, "../../..");

  it("no file's un-catalogued copy rises above its baseline, and no new file starts with any (mutation: add <p>Loading your calls</p> to src/components/app-sidebar.tsx → FAILS naming that file)", () => {
    const violations = ratchetViolations(countsByFile(baseDir), baseline as Record<string, number>);
    expect(violations, violations.map((v) => `${v.file}: live ${v.live} > baseline ${v.allowed}`).join("\n")).toEqual([]);
  });

  it("every catalogue key added from today has a Spanish twin unless it is agency-only (mutation: add \"nav.newThing\": \"New thing\" to messages.ts with no .es twin → FAILS naming the key)", () => {
    const violations = parityViolations(keysMissingSpanish(m), catalogueBaseline as string[]);
    expect(violations, `add a ".es" twin for: ${violations.join(", ")}`).toEqual([]);
  });
});
