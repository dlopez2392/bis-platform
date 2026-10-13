// S-09 §18.3: evidence JSON in (read by the orchestrator through the Supabase MCP, read-only), one SQL
// file out (applied by the orchestrator through the MCP), counts printed. Connects to nothing.
//   pnpm --filter web exec tsx scripts/backfill-contact-language.ts --in <evidence.json> --out <signals.sql>
import { readFileSync, writeFileSync } from "node:fs";
import { planLanguageBackfillReport, backfillSql, backfillCounts, type Evidence } from "../src/lib/contacts/language-backfill";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name} <path>`);
  return process.argv[i + 1]!;
};
const evidence = JSON.parse(readFileSync(arg("--in"), "utf8")) as Evidence[];
const { signals, droppedForTime } = planLanguageBackfillReport(evidence);
writeFileSync(arg("--out"), backfillSql(signals), "utf8");
console.log(JSON.stringify({ evidence: evidence.length, droppedForTime, ...backfillCounts(signals) }));
