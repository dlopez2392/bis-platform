import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Migration 0032 gave accounts an `outbound_suppressed` flag, and every
 * due-list drops a suppressed account's rows by going through
 * `loadSendableRows`. The cron runs each pass against serviceDb() with no
 * account filter, so a `listDue*` that loads accounts for itself is a pass
 * that will mail a demo company's fake contacts.
 *
 * This walks the source rather than the database: the failure it guards
 * against is a NEW due-list written later that copies the old preamble, and
 * no amount of seeded data catches that.
 */
const SRC = path.join(__dirname, "..");
const FILES = ["booking.ts", "automations.ts"] as const;

const source = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");

describe("outbound suppression", () => {
  it("routes every due-list through loadSendableRows", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const fn of source(file).split(/(?=export (?:async )?function )/)) {
        const name = /export (?:async )?function (listDue\w+)/.exec(fn)?.[1];
        if (name && !fn.includes("loadSendableRows")) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves loadAccountBrandInfo called from exactly one place", () => {
    // The raw loader still throws on a missing account, but its only caller is
    // the helper applying the filter. A second caller is a second place to forget.
    const callers = FILES.flatMap((file) =>
      [...source(file).matchAll(/loadAccountBrandInfo\(/g)].map(() => file));
    // booking.ts: the declaration, and the one call inside loadSendableRows.
    expect(callers).toEqual(["booking.ts", "booking.ts"]);
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
