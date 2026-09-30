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

/**
 * A COMMENT CANNOT VOUCH FOR A FUNCTION (hardened 2026-09-22).
 *
 * This walk used to ask `body.includes("loadSendableRows")` over the RAW
 * source of each function — comments and all. A function whose call had been
 * deleted therefore still passed as long as its prose mentioned the loader,
 * and a perfectly ordinary comment ("this goes through loadSendableRows, not
 * loadAccountBrandInfo") silently exempted it. That is a guard disarmed by
 * prose, on the one test that certifies every due-list honours
 * `accounts.outbound_suppressed`.
 *
 * It was found by mutation, not by reading: deleting the call from
 * `listDueReactivations` while the comment above it named the loader left
 * this file reporting green. It was PROPHYLACTIC when it was fixed — a scan
 * of all four walked files found no function whose mentions outnumbered its
 * calls, so nothing was actually exempt at the time; the comment that caught
 * it was one an implementer had just been told to write.
 *
 * Two changes, and they are load-bearing together: comments are stripped
 * before the source is chunked, and the check counts CALL SITES
 * (`loadSendableRows(`) rather than substrings. `counts CALL SITES IN CODE`
 * above is the regression test, so re-simplifying either one reds.
 *
 * Strings are tracked so a `//` inside a literal (a URL) does not eat the
 * rest of its line: an over-eager strip would exempt a function by accident,
 * the same hole wearing the other face. Newlines inside block comments are
 * kept, so line-shaped assertions elsewhere still see the same geometry.
 */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    // inside a string literal
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

/** How many times `name` is CALLED in `body`. Not mentioned — called. */
const callSitesOf = (name: string, body: string) =>
  (body.match(new RegExp(`\\b${name}\\s*\\(`, "g")) ?? []).length;

const source = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");

/** The file with every comment removed — what every claim below is read from. */
const code = (file: string) => stripComments(source(file));

const bodies = (file: string) =>
  code(file)
    .split(/(?=export (?:async )?function )/)
    .map((fn) => ({ name: /export (?:async )?function (\w+)/.exec(fn)?.[1], body: fn }))
    .filter((f): f is { name: string; body: string } => f.name !== undefined);

describe("outbound suppression", () => {
  it("counts CALL SITES IN CODE, so a comment naming the loader cannot vouch for a function", () => {
    // THE REGRESSION TEST FOR THIS FILE'S OWN DEFECT (2026-09-22). The walk
    // below used `body.includes("loadSendableRows")` over the raw source,
    // comments and all — so a function whose call had been DELETED still
    // passed as long as its prose mentioned the loader. Proven, not argued:
    // `listDueReactivations` was mutated to call `loadAccountBrandInfo`
    // directly with the comment "This goes through loadSendableRows, not
    // loadAccountBrandInfo" left above it, and the assertion below reported
    // green. Anyone re-simplifying the walk back to `includes` deletes the
    // two helpers this case exercises, and this case reds.
    const onlyAComment = `export async function listDueFakes(db) {
      // routed through loadSendableRows, like every other due-list
      /* was: await loadSendableRows(db, rows, "listDueFakes"); */
      return [];
    }`;
    expect(callSitesOf("loadSendableRows", stripComments(onlyAComment))).toBe(0);

    const theRealThing = `export async function listDueReals(db) {
      const { sendable } = await loadSendableRows(db, rows, "listDueReals");
      return sendable;
    }`;
    expect(callSitesOf("loadSendableRows", stripComments(theRealThing))).toBe(1);

    // And the stripper must not eat CODE that follows a `//` inside a string
    // literal — an over-eager strip would exempt a function by accident,
    // which is the same hole wearing the other face.
    expect(stripComments(`const u = "https://x/y"; const r = loadSendableRows(a); // gone`))
      .toContain("loadSendableRows(a)");
    expect(stripComments(`const u = "https://x/y"; // gone`)).not.toContain("gone");
  });

  it("routes every due-list, and every by-id release lookup, through loadSendableRows", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const { name, body } of bodies(file)) {
        // `getDue*ById` (Task 3, part C): the release pass re-reads a SINGLE
        // subject the same way the cron's due-lists read many — a surface
        // the cron now reaches through, so it is inside the same guard.
        if (!/^(listDue|getDue)/.test(name)) continue;
        if (PREDICATE_GATED[file]?.includes(name)) continue;
        // CALL SITES, in code with comments already stripped. `includes` over
        // the raw source was satisfied by a comment naming the loader; see
        // stripComments' note and the regression case above.
        if (callSitesOf("loadSendableRows", body) === 0) offenders.push(`${file}: ${name}`);
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
    // `code`, not `source`: THE MIRROR OF THE DEFECT ABOVE. The open paren
    // already made this count calls rather than mentions, but a comment
    // carrying `loadAccountBrandInfo(` counts as a caller all the same — so
    // deleting a real call and writing a comment about it in the same edit
    // leaves the list the same length and this assertion green. Comments are
    // gone before the count.
    const callers = FILES.flatMap((file) =>
      [...code(file).matchAll(/loadAccountBrandInfo\s*\(/g)].map(() => file));
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
    // Comments stripped for the same reason: the 220-character gap is a gap
    // in CODE, and a comment mentioning the column inside it would satisfy
    // this with the column absent from the select.
    expect(code("booking.ts")).toMatch(/ACCOUNT_BRAND_COLS[\s\S]{0,220}outbound_suppressed/);
  });

  it("defaults the column to false, so no existing account changes behaviour", () => {
    const sql = fs.readFileSync(
      path.join(SRC, "..", "supabase", "migrations", "0032_outbound_suppressed.sql"), "utf8");
    expect(sql).toMatch(/add column outbound_suppressed boolean not null default false/);
  });
});
