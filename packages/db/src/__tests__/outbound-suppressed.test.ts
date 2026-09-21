import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Migration 0032 gave accounts an `outbound_suppressed` flag, and its column
 * comment states the rule broadly: every automation pass skips a suppressed
 * account's due work. The cron runs all eight passes against serviceDb() with
 * no account filter, so a read that forgets the flag is a pass that will act
 * on a demo company — mail its invented contacts, or call a third party for a
 * project id that does not exist.
 *
 * This walks the source rather than the database: the failure it guards
 * against is a NINTH pass written later that copies an old preamble, and no
 * amount of seeded data catches that.
 *
 * The flag is applied by one of two mechanisms, and which one a read uses is
 * decided by its shape, not by taste:
 *
 *   - Row-shaped due-lists (`listDue*`) return domain rows carrying an
 *     `account_id`. They go through `loadSendableRows`, which has to load the
 *     accounts anyway for branding, so the filter is free.
 *   - Account-shaped and site-shaped reads (the weekly report's two, the site
 *     sync) can express the rule as a server-side predicate, which is
 *     strictly better: the suppressed rows never leave Postgres.
 */
const SRC = path.join(__dirname, "..");

/** Files holding a read the cron reaches. Adding a pass usually adds one. */
const FILES = ["booking.ts", "automations.ts", "weekly-report.ts", "sites.ts"] as const;

/** Reads gated by a server-side predicate rather than by loadSendableRows. */
const PREDICATE_GATED: Record<string, readonly string[]> = {
  "weekly-report.ts": ["listAccountsDueWeeklyReport", "listAccountsForWeeklyRollup"],
  "sites.ts": ["listSitesToSync"],
};

const source = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");

const bodies = (file: string) =>
  source(file)
    .split(/(?=export (?:async )?function )/)
    .map((fn) => ({ name: /export (?:async )?function (\w+)/.exec(fn)?.[1], body: fn }))
    .filter((f): f is { name: string; body: string } => f.name !== undefined);

describe("outbound suppression", () => {
  it("routes every due-list, and every by-id release lookup, through loadSendableRows", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const { name, body } of bodies(file)) {
        // `getDue*ById` (Task 3, part C): the release pass re-reads a SINGLE
        // subject the same way the cron's due-lists read many — a surface
        // the cron now reaches through, so it is inside the same guard.
        if (!/^(listDue|getDue)/.test(name)) continue;
        if (PREDICATE_GATED[file]?.includes(name)) continue;
        if (!body.includes("loadSendableRows")) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gates every predicate-filtered read on the column, server-side", () => {
    // Not a grep over the whole file: the assertion is per-FUNCTION, so a
    // filter sitting in a neighbouring read cannot vouch for this one.
    const offenders: string[] = [];
    for (const [file, names] of Object.entries(PREDICATE_GATED)) {
      const found = bodies(file);
      for (const name of names) {
        const fn = found.find((f) => f.name === name);
        if (!fn) { offenders.push(`${file}: ${name} — function not found`); continue; }
        if (!/outbound_suppressed[^\n]*,\s*false|outbound_suppressed", false/.test(fn.body)) {
          offenders.push(`${file}: ${name} — no outbound_suppressed predicate`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves loadAccountBrandInfo called only where the flag is already applied", () => {
    // The raw loader still throws on a missing account and does NOT filter.
    // Every caller must therefore have applied the rule itself — either by
    // being `loadSendableRows`, or by having filtered server-side first.
    //
    // #44 asserted "exactly one caller" while scanning only booking.ts and
    // automations.ts. weekly-report.ts was a third caller the whole time and
    // the test could not see it, so the claim was narrower than it read. The
    // set is now spelled out per file across every scanned file, which is a
    // statement that can actually go stale loudly.
    const callers = FILES.flatMap((file) =>
      [...source(file).matchAll(/loadAccountBrandInfo\(/g)].map(() => file));
    expect(callers).toEqual([
      // The declaration, and the one call inside loadSendableRows.
      "booking.ts", "booking.ts",
      // The single call in listAccountsDueWeeklyReport — which has already
      // dropped suppressed accounts in its own `.eq` by the time it runs.
      // (The named import above it does not match: this pattern requires the
      // open paren, so it counts CALLS and not mentions.)
      "weekly-report.ts",
    ]);
  });

  it("selects the column the filter reads", () => {
    expect(source("booking.ts")).toMatch(/ACCOUNT_BRAND_COLS[\s\S]{0,220}outbound_suppressed/);
  });

  it("defaults the column to false, so no existing account changes behaviour", () => {
    const sql = fs.readFileSync(
      path.join(SRC, "..", "supabase", "migrations", "0032_outbound_suppressed.sql"), "utf8");
    expect(sql).toMatch(/add column outbound_suppressed boolean not null default false/);
  });
});
