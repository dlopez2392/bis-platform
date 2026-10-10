// To regenerate the baseline after a real count change (never hand-edit
// ratchet-baseline.json to admit a new violation):
//   pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanFile, relativeKey, AGENCY_ONLY_ALLOWLIST, countsByFile } from "./ratchet-scan";
import baseline from "./ratchet-baseline.json";

describe("scanFile", () => {
  it("counts a raw JSX text literal as 1, and a t()-routed string as 0 (mutation: count every string literal including className values → FAILS the second assertion, since 'px-2' would then count)", () => {
    const withLiteral = `export function X() { return <p className="px-2">Loading your calls</p>; }`;
    expect(scanFile("x.tsx", withLiteral)).toBe(1);

    const withCatalogue = `export function X() { return <p className="px-2">{t(m, "x.loading", locale)}</p>; }`;
    expect(scanFile("x.tsx", withCatalogue)).toBe(0);
  });

  it("reverting a real translated string back to a literal is caught by name (mutation check per the brief: delete the .es twin AND hard-code the English string back into the JSX → the live count for that file now exceeds its baseline entry, which is exactly what Step 5's ratchet test below asserts)", () => {
    const reverted = `export function X() { return <p>Loading your calls</p>; }`;
    expect(scanFile("x.tsx", reverted)).toBe(1);
  });
});

describe("relativeKey", () => {
  it("a Windows-style absolute path and a POSIX absolute path rooted at the same apps/web directory produce the identical key (mutation: return absPath unchanged instead of stripping baseDir → FAILS, the two inputs then produce two DIFFERENT strings instead of the same one) (plan-review C1)", () => {
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
    expect(winKey).toBe(posixKey);
  });
});

describe("AGENCY_ONLY_ALLOWLIST", () => {
  it("matches the agency's accounts LIST page but not the client's own billing page (mutation: add a dashboard/billing/ entry back to the list → FAILS the billing assertion, since nav-groups.ts puts billing under the account-scoped ${base}/billing, never a top-level agency route) (plan-review I1)", () => {
    const billingPage = "src/app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx";
    const accountsListPage = "src/app/(dashboard)/dashboard/accounts/page.tsx";
    expect(AGENCY_ONLY_ALLOWLIST.some((re) => re.test(billingPage))).toBe(false);
    expect(AGENCY_ONLY_ALLOWLIST.some((re) => re.test(accountsListPage))).toBe(true);
  });
});

describe("the i18n ratchet", () => {
  // apps/web/src/lib/i18n -> apps/web, matching generate-i18n-baseline.ts's
  // own apps/web/scripts -> apps/web — the SAME baseDir either file resolves
  // to, which relativeKey's test above already proved is OS-independent.
  const baseDir = path.join(__dirname, "../../..");

  it("no file's live raw-literal count exceeds its committed baseline (mutation: revert Task 6's app-sidebar.tsx edit back to m[item.labelKey] → src/components/app-sidebar.tsx's live count rises above its baseline entry of 0, FAILS by that file's name)", () => {
    const live = countsByFile(baseDir);
    for (const [file, count] of Object.entries(live)) {
      const allowed = (baseline as Record<string, number>)[file] ?? 0;
      expect(count, `${file}: live ${count} > baseline ${allowed}`).toBeLessThanOrEqual(allowed);
    }
  });

  it("no baseline entry names a file that no longer exists (mutation: rename a scanned file without regenerating the baseline → FAILS, naming the stale entry) (plan-review I3)", () => {
    const live = countsByFile(baseDir);
    for (const file of Object.keys(baseline as Record<string, number>)) {
      expect(live[file], `${file}: baseline entry for a file that no longer exists — regenerate the baseline`).not.toBeUndefined();
    }
  });

  it("no file's live count sits BELOW its baseline either — a real reduction must tighten the ceiling, not coast on the old one (mutation: skip this half of the check → a file that drops from 5 un-catalogued strings to 0 stays silently allowed up to 5 forever) (plan-review I3)", () => {
    const live = countsByFile(baseDir);
    for (const [file, allowed] of Object.entries(baseline as Record<string, number>)) {
      const count = live[file];
      if (count === undefined) continue; // the previous test already fails this case by name
      expect(
        count,
        `${file}: live ${count} < baseline ${allowed}; run \`pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts\` to tighten`,
      ).toBeGreaterThanOrEqual(allowed);
    }
  });
});
