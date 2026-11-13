import { describe, it, expect, afterAll } from "vitest";
import { checkMigrationDirectory, LEGACY_LAST, newMigrationFileName, parseMigrationFile } from "./names";

// Migration file names (plan docs/superpowers/plans/2026-11-13-migration-pipeline.md, D1).
// 0001..0116 keep their numbers; every new file is YYYYMMDDHHMMSS_slug.sql
// (UTC), so two branches can no longer pick the same next number. Every
// legacy name starts with 0 and every new one with 2, so file-name order,
// numeric order and Postgres' `order by version` on text all agree.

// The clock is read in UTC. CI's runners ARE UTC, where a local-time getter
// gives the same digits and these tests could not tell the two apart (review
// of #365). So this file runs in a zone that is neither UTC nor whole hours
// from it, on every machine, and the first test proves the pin took.
const PRIOR_TZ = process.env.TZ;
process.env.TZ = "Asia/Kolkata";
// Put the zone back, as document-expiry.test.ts does, so a run with
// --no-isolate cannot carry it into another file.
afterAll(() => {
  if (PRIOR_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = PRIOR_TZ;
});

describe("the zone these tests run in", () => {
  it("is not UTC, so a local-time clock reading fails below (mutation: drop the TZ pin, run with TZ=UTC → the UTC tests stop failing it)", () => {
    expect(new Date(Date.UTC(2026, 10, 13, 18, 30, 5)).getHours()).toBe(0);
  });
});

const LEGACY = Array.from({ length: LEGACY_LAST }, (_, i) => `${String(i + 1).padStart(4, "0")}_m${i + 1}.sql`);
const NOW = new Date(Date.UTC(2026, 10, 13, 18, 30, 5));

describe("parseMigrationFile", () => {
  it("splits a legacy name into the version and name the CLI records", () => {
    expect(parseMigrationFile("0115_owner_line.sql")).toEqual({
      file: "0115_owner_line.sql", stem: "0115_owner_line", version: "0115", name: "owner_line", kind: "legacy",
    });
  });

  it("splits a timestamped name the same way", () => {
    expect(parseMigrationFile("20261114093000_work_queue.sql")).toEqual({
      file: "20261114093000_work_queue.sql", stem: "20261114093000_work_queue",
      version: "20261114093000", name: "work_queue", kind: "timestamped",
    });
  });

  it("accepts the first second of the switch to timestamped names, 20261113000000 (mutation: floor off by one → FAILS)", () => {
    const parsed = parseMigrationFile("20261113000000_first.sql");
    expect("kind" in parsed && parsed.kind).toBe("timestamped");
  });

  it.each([
    ["0117_next.sql", /numbered/],
    ["0000_zero.sql", /numbered/],
    ["117_short.sql", /14-digit/],
    ["202611140930_twelve.sql", /14-digit/],
    ["20261131093000_no_such_day.sql", /not a real UTC/],
    ["20261114250000_hour_25.sql", /not a real UTC/],
    ["20261114093000_Upper.sql", /slug/],
    ["20261114093000_3_way.sql", /slug/],
    ["20261114093000_.sql", /slug/],
    ["01000101000000_year_100.sql", /before 20261113000000/],
    ["20261112235959_a_second_early.sql", /before 20261113000000/],
    ["20261114093000-dash.sql", /<version>_<slug>\.sql/],
    ["notes.sql", /<version>_<slug>\.sql/],
  ])("refuses %s, saying why", (file, why) => {
    const parsed = parseMigrationFile(file);
    expect("error" in parsed && parsed.error).toMatch(why);
  });
});

describe("checkMigrationDirectory", () => {
  it("accepts the 116 legacy files followed by timestamped ones", () => {
    expect(checkMigrationDirectory([...LEGACY, "20261114093000_a.sql", "20261114093001_b.sql"], NOW)).toEqual([]);
  });

  it("ignores files that are not .sql, as the CLI does", () => {
    expect(checkMigrationDirectory([...LEGACY, "README.md"], NOW)).toEqual([]);
  });

  it("refuses a NEW numbered file, naming it and the command to use instead", () => {
    const problems = checkMigrationDirectory([...LEGACY, "0117_next.sql"], NOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/0117_next\.sql/);
    expect(problems[0]).toMatch(/migration:new/);
  });

  it("refuses a second file reusing a legacy number", () => {
    const problems = checkMigrationDirectory([...LEGACY, "0050_other.sql"], NOW);
    expect(problems.join("\n")).toMatch(/0050.*more than once/);
  });

  it("refuses a missing legacy file: an applied migration was deleted or renamed", () => {
    const problems = checkMigrationDirectory(LEGACY.filter((f) => !f.startsWith("0042_")), NOW);
    expect(problems.join("\n")).toMatch(/0042/);
  });

  it("refuses a timestamped file whose slug another file already has, legacy or new (mutation: drop the slug check → FAILS)", () => {
    expect(checkMigrationDirectory([...LEGACY, "20261114093000_m115.sql"], NOW).join("\n")).toMatch(/m115.*0115_m115\.sql/);
    expect(checkMigrationDirectory([...LEGACY, "20261114093000_a.sql", "20261114093001_a.sql"], NOW).join("\n")).toMatch(/slug "a"/);
  });

  it("grandfathers a slug two LEGACY files share (0026 and 0047 are both automations_b)", () => {
    const legacy = LEGACY.map((f) => (f.startsWith("0047_") ? "0047_m26.sql" : f));
    expect(checkMigrationDirectory(legacy, NOW)).toEqual([]);
  });

  it("refuses two timestamped files with one version", () => {
    const problems = checkMigrationDirectory([...LEGACY, "20261114093000_a.sql", "20261114093000_b.sql"], NOW);
    expect(problems.join("\n")).toMatch(/20261114093000.*more than once/);
  });

  it("refuses a timestamp more than a day ahead of now, allows one within the day", () => {
    expect(checkMigrationDirectory([...LEGACY, "20261114183005_tomorrow.sql"], NOW)).toEqual([]);
    expect(checkMigrationDirectory([...LEGACY, "20261114183006_too_far.sql"], NOW).join("\n")).toMatch(/future/);
  });
});

describe("newMigrationFileName", () => {
  it("names the file from the UTC clock, to the second", () => {
    expect(newMigrationFileName("work_queue", NOW)).toBe("20261113183005_work_queue.sql");
  });

  it("pads every field", () => {
    expect(newMigrationFileName("a", new Date(Date.UTC(2027, 0, 2, 3, 4, 5)))).toBe("20270102030405_a.sql");
  });

  it.each(["Work", "3_way", "", "with-dash", "with space"])("refuses the slug %j", (slug) => {
    expect(() => newMigrationFileName(slug, NOW)).toThrow(/slug/);
  });

  it("produces a name parseMigrationFile accepts as timestamped", () => {
    const parsed = parseMigrationFile(newMigrationFileName("x", NOW));
    expect("kind" in parsed && parsed.kind).toBe("timestamped");
  });
});
