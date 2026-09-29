import { readFileSync, writeFileSync } from "node:fs";
import {
  parseOptouts, planTelnyxBackfill, telnyxBackfillSql, telnyxBackfillSqlParts, maskLast4,
  MAX_ROWS_PER_STATEMENT, type Owner,
} from "./telnyx-optouts";

/**
 * pnpm --filter @bis/db backfill:telnyx-optouts <optouts.json> <owners.json> [--emit-sql <out.sql>]
 *
 * Prints counts only (never a customer number, and unmatched business numbers print masked to
 * their last four digits — review I2): rows read, to write per account (with how many of those
 * are from a released number — review I3), future-dated rows (review M2; emit is refused while
 * any exist), business numbers with no owner, and `to` numbers that are our own (expected 0 — a
 * non-zero count means a reversed from/to reading, and suppresses the unmatched list entirely
 * rather than risk printing a customer number under it).
 *
 * With --emit-sql it writes the statement(s) to <out.sql> — one file, or, above
 * MAX_ROWS_PER_STATEMENT rows, numbered `<out>-part-N.sql` files (review M1), each independently
 * idempotent. Connects to nothing.
 *
 * Any error (bad input, a reversed reading, a future-dated row) is caught here and only its
 * MESSAGE is printed, never a stack trace or an uncaught-exception dump that could echo more
 * than the message already chose to say (review I1).
 */
/** Never let JSON.parse's own SyntaxError escape (review I1): Node's V8 quotes a snippet of the
 *  input around the error, which for either file here can be most of a customer's own digits. */
function parseJsonFile(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: not valid JSON`);
  }
}

function run(argv: string[]): void {
  const [optoutsPath, ownersPath, flag, outPath] = argv;
  if (!optoutsPath || !ownersPath || (flag !== undefined && (flag !== "--emit-sql" || !outPath))) {
    throw new Error("usage: backfill:telnyx-optouts <optouts.json> <owners.json> [--emit-sql <out.sql>]");
  }
  const rows = parseOptouts(parseJsonFile(readFileSync(optoutsPath, "utf8"), "opt-outs file"));
  const owners = parseJsonFile(readFileSync(ownersPath, "utf8"), "owners file") as Owner[];
  if (!Array.isArray(owners)) throw new Error("owners: expected the JSON array execute_sql returned");
  const plan = planTelnyxBackfill(rows, owners);

  console.log(`opt-outs read: ${rows.length}`);
  for (const [account, n] of Object.entries(plan.perAccount)) {
    console.log(`to write, account ${account}: ${n} (of which from released numbers: ${plan.releasedPerAccount[account] ?? 0})`);
  }
  console.log(`to write, total: ${plan.toAppend.length}`);
  console.log(`future-dated: ${plan.futureDated.length}`);

  if (plan.toMatchesOwners > 0) {
    console.log(`opt-outs whose customer number is one of ours: ${plan.toMatchesOwners} — this reads as a reversed from/to; no numbers listed, and --emit-sql is refused`);
  } else {
    console.log("opt-outs whose customer number is one of ours (expected 0): 0");
    for (const u of plan.unmatched) console.log(`no owner for business number ${maskLast4(u.from)}: ${u.rows} opt-out(s), not written`);
  }

  if (!outPath) return;
  if (plan.toMatchesOwners > 0) {
    // Refuse here too, not only inside telnyxBackfillSql: when EVERY row's
    // `from` fails to match an owner (the whole-file reversed case),
    // toAppend is empty and the "nothing to write" branch below would
    // otherwise return 0 despite the message above saying --emit-sql is
    // refused.
    throw new Error(
      `--emit-sql refused: ${plan.toMatchesOwners} opt-out(s) have a customer number that matches one ` +
      "of our OWN numbers, which reads as a reversed from/to; fix the input before emitting SQL",
    );
  }
  if (plan.toAppend.length === 0) { console.log("nothing to write: no statement emitted"); return; }
  if (plan.toAppend.length > MAX_ROWS_PER_STATEMENT) {
    const parts = telnyxBackfillSqlParts(plan);
    const base = outPath.replace(/\.sql$/i, "");
    parts.forEach((sql, i) => {
      const p = `${base}-part-${i + 1}.sql`;
      writeFileSync(p, sql);
      console.log(`statement written to ${p} — delete it after running`);
    });
    return;
  }
  writeFileSync(outPath, telnyxBackfillSql(plan));
  console.log(`statement written to ${outPath} — delete it after running`);
}

try {
  run(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
