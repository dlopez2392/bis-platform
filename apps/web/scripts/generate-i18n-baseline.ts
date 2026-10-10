// Regenerates BOTH i18n ratchet baselines from scratch (see ratchet.test.ts's
// header for when to run it):
//   pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts
//
// - ratchet-baseline.json: per-file counts of un-catalogued copy in JSX,
//   NONZERO files only (a file with no entry may only be at zero, so a zero
//   entry would say nothing). Rewritten whole, so a file that got
//   translated or deleted drops out — stale entries are pruned here.
// - catalogue-baseline.json: the frozen, sorted list of messages.ts keys
//   with no ".es" twin today (agency-only prefixes excluded). Every key NOT
//   on it must have a twin.
//
// No local allowlist, roots or prefixes (plan-review I2) — all come from
// ratchet-scan.ts's own exports, so the script and the test can never drift
// into checking two different things.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { countsByFile, keysMissingSpanish } from "../src/lib/i18n/ratchet-scan";
import { m } from "../src/lib/messages";

const dir = path.join(__dirname, "../src/lib/i18n");

const counts = Object.fromEntries(
  Object.entries(countsByFile(path.join(__dirname, "..")))
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
writeFileSync(path.join(dir, "ratchet-baseline.json"), JSON.stringify(counts, null, 2) + "\n");

const missing = keysMissingSpanish(m);
writeFileSync(path.join(dir, "catalogue-baseline.json"), JSON.stringify(missing, null, 2) + "\n");

console.log(`ratchet-baseline.json: ${Object.keys(counts).length} files; catalogue-baseline.json: ${missing.length} keys.`);
