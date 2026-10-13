// S-09 §18.3: evidence JSON in (read by the orchestrator through the Supabase MCP, read-only), one SQL
// file out (applied by the orchestrator through the MCP), counts printed. Connects to nothing.
//   pnpm --filter web exec tsx scripts/backfill-contact-language.ts --in <evidence.json> --out <signals.sql> [--chunk N]
//
// Without --chunk, --out is one file applied as a single batch by the MCP: a statement that record_
// language_signal's own guards refuse (e.g. a time outside its bound) raises inside that file's
// transaction and rolls back the WHOLE file, not just that row. With --chunk N, the plan splits on
// contact boundaries into <out base>.1<ext>, <out base>.2<ext>, ... — apply them IN ORDER, so a refused
// row only costs its own chunk. Either way, re-applying any file (or the whole thing) is safe:
// record_language_signal returns false, and writes nothing, for a contact whose language is already
// set from an earlier run (same evidence replayed twice is a no-op, per Task 1).
import { readFileSync, writeFileSync } from "node:fs";
import { planLanguageBackfillReport, backfillSql, backfillSqlChunks, backfillCounts, type Evidence } from "../src/lib/contacts/language-backfill";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name} <path>`);
  return process.argv[i + 1]!;
};
const optionalArg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1] ?? null;
};

const evidence = JSON.parse(readFileSync(arg("--in"), "utf8")) as Evidence[];
const { signals, dropped } = planLanguageBackfillReport(evidence);

const outPath = arg("--out");
const chunkRaw = optionalArg("--chunk");
let chunkFiles: string[] = [outPath];
if (chunkRaw !== null) {
  const chunkSize = Number(chunkRaw);
  const chunks = backfillSqlChunks(signals, chunkSize);
  const dot = outPath.lastIndexOf(".");
  const base = dot >= 0 ? outPath.slice(0, dot) : outPath;
  const ext = dot >= 0 ? outPath.slice(dot) : "";
  chunkFiles = chunks.map((_, i) => `${base}.${i + 1}${ext}`);
  chunks.forEach((sql, i) => writeFileSync(chunkFiles[i]!, sql, "utf8"));
} else {
  writeFileSync(outPath, backfillSql(signals), "utf8");
}

// Review M-4: every evidence row is a signal or one drop reason (a form in the account's own language
// is `dropped.sameAsAccount`), so `reconciles` is true; false means a row fell through uncounted.
const droppedTotal = Object.values(dropped).reduce((n, k) => n + k, 0);
console.log(JSON.stringify({
  evidence: evidence.length, dropped, reconciles: evidence.length === signals.length + droppedTotal, files: chunkFiles, ...backfillCounts(signals),
}));
