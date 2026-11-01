// Regenerates the i18n ratchet baselines from scratch (see ratchet.test.ts's
// header for when to run it):
//   pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts
//
// - ratchet-baseline.json: per-file counts of un-catalogued copy in JSX,
//   NONZERO files only (a file with no entry may only be at zero, so a zero
//   entry would say nothing). Rewritten whole, so a file that got
//   translated or deleted drops out — stale entries are pruned here.
// - catalogue-baseline.json: the frozen, sorted list of messages.ts keys
//   with no ".es" twin today (agency-only prefixes, and since S-10 the keys
//   only agency-only files read, excluded). Every key NOT on it must have a
//   twin.
// - direct-read-baseline.json (S-10 G3): per-file counts of `m[...]` reads,
//   agency-only files excluded, nonzero files only.
//
// No local allowlist, roots or prefixes (plan-review I2) — all come from
// ratchet-scan.ts's own exports, so the script and the test can never drift
// into checking two different things.
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  countsByFile, keysMissingSpanish, scanSources, agencyOnlyFiles, agencyOnlyKeys, directReadCounts,
  AGENCY_ONLY_KEY_PREFIXES,
} from "../src/lib/i18n/ratchet-scan";
import { m } from "../src/lib/messages";

const baseDir = path.join(__dirname, "..");
const dir = path.join(__dirname, "../src/lib/i18n");

const nonzeroSorted = (counts: Record<string, number>) => Object.fromEntries(
  Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);

const counts = nonzeroSorted(countsByFile(baseDir));
writeFileSync(path.join(dir, "ratchet-baseline.json"), JSON.stringify(counts, null, 2) + "\n");

const scan = scanSources(baseDir, new Set(Object.keys(m)));
const agencyFiles = agencyOnlyFiles(scan.imports);
const missing = keysMissingSpanish(m, AGENCY_ONLY_KEY_PREFIXES, agencyOnlyKeys(scan.refs, agencyFiles));
writeFileSync(path.join(dir, "catalogue-baseline.json"), JSON.stringify(missing, null, 2) + "\n");

const direct = nonzeroSorted(directReadCounts(scan, agencyFiles));
writeFileSync(path.join(dir, "direct-read-baseline.json"), JSON.stringify(direct, null, 2) + "\n");

const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
console.log(
  `ratchet-baseline.json: ${Object.keys(counts).length} files, ${total(counts)} strings; `
  + `catalogue-baseline.json: ${missing.length} keys; `
  + `direct-read-baseline.json: ${Object.keys(direct).length} files, ${total(direct)} reads.`,
);
