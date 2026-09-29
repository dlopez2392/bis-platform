import { readFileSync, writeFileSync } from "node:fs";
import { parseOptouts, planTelnyxBackfill, telnyxBackfillSql, type Owner } from "./telnyx-optouts";

/**
 * pnpm --filter @bis/db backfill:telnyx-optouts <optouts.json> <owners.json> [--emit-sql <out.sql>]
 *
 * Prints counts only (never a customer number): rows read, to write per
 * account, business numbers with no owner, and `to` numbers that are our own
 * (expected 0). With --emit-sql it also writes the statements to <out.sql>.
 * Connects to nothing.
 *
 * If any planned row's occurred_at is in the future, `telnyxBackfillSql`
 * throws naming the row (see telnyx-optouts.ts): this crashes uncaught, on
 * purpose, so the run stops loudly instead of emitting a statement that
 * would abort against the real database (0055's RAISE on a future
 * p_occurred_at, telnyx-optouts.ts's own doc comment).
 */
function main(argv: string[]): void {
  const [optoutsPath, ownersPath, flag, outPath] = argv;
  if (!optoutsPath || !ownersPath || (flag !== undefined && (flag !== "--emit-sql" || !outPath))) {
    throw new Error("usage: backfill:telnyx-optouts <optouts.json> <owners.json> [--emit-sql <out.sql>]");
  }
  const rows = parseOptouts(JSON.parse(readFileSync(optoutsPath, "utf8")));
  const owners = JSON.parse(readFileSync(ownersPath, "utf8")) as Owner[];
  if (!Array.isArray(owners)) throw new Error("owners: expected the JSON array execute_sql returned");
  const plan = planTelnyxBackfill(rows, owners);
  console.log(`opt-outs read: ${rows.length}`);
  for (const [account, n] of Object.entries(plan.perAccount)) console.log(`to write, account ${account}: ${n}`);
  console.log(`to write, total: ${plan.toAppend.length}`);
  for (const u of plan.unmatched) console.log(`no owner for business number ${u.from}: ${u.rows} opt-out(s), not written`);
  console.log(`opt-outs whose customer number is one of ours (expected 0): ${plan.toMatchesOwners}`);
  if (outPath && plan.toAppend.length === 0) console.log("nothing to write: no statement emitted");
  else if (outPath) {
    writeFileSync(outPath, telnyxBackfillSql(plan));
    console.log(`statement written to ${outPath} — delete it after running`);
  }
}

main(process.argv.slice(2));
