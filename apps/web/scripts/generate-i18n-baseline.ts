import { writeFileSync } from "node:fs";
import path from "node:path";
import { countsByFile } from "../src/lib/i18n/ratchet-scan";

// No local allowlist or roots here (plan-review I2) — both come from
// ratchet-scan.ts's own exports via countsByFile's default parameter, so
// the script and the test can never drift into scanning two different
// trees.
const counts = countsByFile(path.join(__dirname, ".."));
writeFileSync(
  path.join(__dirname, "../src/lib/i18n/ratchet-baseline.json"),
  JSON.stringify(counts, null, 2) + "\n",
);
console.log(`Wrote ${Object.keys(counts).length} file entries.`);
