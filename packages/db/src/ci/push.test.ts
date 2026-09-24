import { describe, it, expect } from "vitest";
import { planCiCli, type CiCliMode } from "./push";
import { PRODUCTION_SUPABASE_REF } from "./target";

/**
 * `db:push:ci` and `db:migrations:ci` are the ONLY way this repo pushes
 * migrations with the Supabase CLI now that `db:push` is gone. The planner is
 * pure; the runner (./push-run.ts) only loads dotenv, prints the target and
 * spawns what this returns. So every refusal the runner can make is proven here.
 */
const CI_REF = "cicicicicicicicicici";
const PROD = PRODUCTION_SUPABASE_REF;
const DB_URL = `postgresql://postgres.${CI_REF}:Secretpass123@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const ciEnv = {
  BIS_CI_SUPABASE_REF: CI_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${CI_REF}.supabase.co`,
  SUPABASE_DB_URL: DB_URL,
};
const paths = { workdir: "/repo/packages/db" };

const PROD_SHAPES: [string, Record<string, string>, RegExp][] = [
  ["the production ref", {
    BIS_CI_SUPABASE_REF: PROD,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres.${PROD}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  }, /BIS_CI_SUPABASE_REF is production's ref/],
  ["production's API URL", { ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` },
    /NEXT_PUBLIC_SUPABASE_URL points at production/],
  ["production's DB URL", {
    ...ciEnv, SUPABASE_DB_URL: `postgresql://postgres.${PROD}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  }, /SUPABASE_DB_URL points at production/],
];

const MODES: CiCliMode[] = ["push", "list"];

describe("planCiCli refuses production in every mode", () => {
  for (const mode of MODES) {
    for (const [label, env, message] of PROD_SHAPES) {
      it(`${mode}: refuses ${label}`, () => {
        expect(() => planCiCli(mode, env, [], paths)).toThrow(message);
      });
    }
  }
});

describe("planCiCli refuses anything that could re-aim the CLI", () => {
  for (const mode of MODES) {
    it(`${mode}: refuses an unset CI ref`, () => {
      expect(() => planCiCli(mode, { ...ciEnv, BIS_CI_SUPABASE_REF: undefined }, [], paths))
        .toThrow(/BIS_CI_SUPABASE_REF is not set/);
    });
    it(`${mode}: refuses a second --db-url`, () => {
      expect(() => planCiCli(mode, ciEnv, ["--db-url", "postgresql://x@elsewhere/postgres"], paths))
        .toThrow(/refusing argument "--db-url"/);
    });
    it(`${mode}: refuses --linked`, () => {
      expect(() => planCiCli(mode, ciEnv, ["--linked"], paths)).toThrow(/refusing argument "--linked"/);
    });
  }

  it("does not echo an argument that is not a plain flag (it may be a URL with a password)", () => {
    const url = `postgresql://postgres.${CI_REF}:Secretpass123@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    for (const arg of [url, `--db-url=${url}`]) {
      let message = "";
      try { planCiCli("push", ciEnv, [arg], paths); } catch (e) { message = (e as Error).message; }
      expect(message).toMatch(/refusing an argument/);
      expect(message).not.toContain("Secretpass123");
    }
  });

  it("push: refuses --include-all", () => {
    expect(() => planCiCli("push", ciEnv, ["--include-all"], paths)).toThrow(/refusing argument "--include-all"/);
  });

  it("list: refuses --dry-run, which only push understands", () => {
    expect(() => planCiCli("list", ciEnv, ["--dry-run"], paths)).toThrow(/refusing argument "--dry-run"/);
  });
});

describe("planCiCli builds exactly the CLI call it prints", () => {
  it("push: db push against the env's DB URL, from this package's supabase dir", () => {
    const plan = planCiCli("push", ciEnv, [], paths);
    expect(plan.args).toEqual(["db", "push", "--db-url", DB_URL, "--workdir", "/repo/packages/db", "--yes"]);
    expect(plan.dryRun).toBe(false);
    expect(plan.target.ref).toBe(CI_REF);
  });

  it("push --dry-run: the same call, plus --dry-run", () => {
    const plan = planCiCli("push", ciEnv, ["--dry-run"], paths);
    expect(plan.args).toEqual(["db", "push", "--db-url", DB_URL, "--workdir", "/repo/packages/db", "--yes", "--dry-run"]);
    expect(plan.dryRun).toBe(true);
  });

  it("list: migration list against the env's DB URL", () => {
    const plan = planCiCli("list", ciEnv, [], paths);
    expect(plan.args).toEqual(["migration", "list", "--db-url", DB_URL, "--workdir", "/repo/packages/db"]);
  });

  /**
   * The CLI child inherits its environment. Go pgconn and the TS client both
   * take PGHOST/PGUSER/PGDATABASE/PGOPTIONS/… as defaults (and the reviewer
   * saw an upper-case-scheme URL ignored outright in their favour), and the
   * npm shim EXECUTES whatever binary SUPABASE_CLI_BINARY_OVERRIDE names
   * (node_modules/supabase/dist/supabase.js:25). None of them may reach it.
   */
  it("spawns the CLI with no PG* variable and no binary override, whatever their case", () => {
    const plan = planCiCli("push", {
      ...ciEnv, PATH: "/usr/bin", HOME: "/home/ci",
      PGHOST: "evil.example", PGUSER: "someone", PGDATABASE: "x", PGOPTIONS: "-c role=x",
      PGPASSWORD: "p", PGSSLMODE: "disable", pgport: "1", PgService: "s",
      SUPABASE_CLI_BINARY_OVERRIDE: "/tmp/evil", supabase_cli_binary_override: "/tmp/evil2",
    }, [], paths);
    expect(Object.keys(plan.env).filter((k) => /^pg/i.test(k) || /^supabase_cli_binary_override$/i.test(k))).toEqual([]);
    expect(plan.env.PATH).toBe("/usr/bin");
    expect(plan.env.HOME).toBe("/home/ci");
  });

  it("the printable summary never carries the password", () => {
    const plan = planCiCli("push", ciEnv, ["--dry-run"], paths);
    expect(plan.summary).toContain(CI_REF);
    expect(plan.summary).toContain("dry run");
    expect(plan.summary).not.toContain("Secretpass123");
  });
});
