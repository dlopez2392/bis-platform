import { describe, expect, it } from "vitest";
import {
  INCLUDED_SCHEMAS,
  PG_META_IMAGE,
  REGENERATE,
  TYPES_FILE,
  acceptGenerated,
  driftReport,
  parseArgs,
  pgMetaRun,
  schemaFiles,
} from "./plan";

// The generator behind `types:gen` and CI's `types:check` (./run.ts). Both
// must produce the same bytes for the same schema, so both go through
// pgMetaRun: one image, one set of PG_META_* settings, whatever the platform.

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const GENERATED = "export type Json =\n  | string\n\nexport type Database = {\n  public: {}\n}\n";

describe("pgMetaRun: the one way the types are generated", () => {
  it("runs the pinned postgres-meta image's own generator with the CLI's settings, for public and app only", () => {
    const run = pgMetaRun(LOCAL, { platform: "linux" });
    expect(run.args.at(-3)).toBe(PG_META_IMAGE);
    expect(run.args.slice(-2)).toEqual(["node", "dist/server/server.js"]);
    expect(run.env).toMatchObject({
      PG_META_GENERATE_TYPES: "typescript",
      PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS: "public,app",
      PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS: "true",
    });
    expect(INCLUDED_SCHEMAS).toBe("public,app");
  });

  it("pins the image by digest, so a re-pushed tag cannot change the output on one machine and not another", () => {
    expect(PG_META_IMAGE).toMatch(/^public\.ecr\.aws\/supabase\/postgres-meta:v0\.96\.6@sha256:[0-9a-f]{64}$/);
  });

  it("hands the DB URL to docker through the environment, never on its command line (a URL carries a password)", () => {
    const run = pgMetaRun(LOCAL, { platform: "linux" });
    expect(run.env.PG_META_DB_URL).toBe(LOCAL);
    expect(run.args.filter((a) => a.includes("postgresql://"))).toEqual([]);
    for (const name of Object.keys(run.env)) expect(run.args).toContain(name);
  });

  it("on Linux (CI) reaches the runner's stack through the host network, URL untouched", () => {
    const run = pgMetaRun(LOCAL, { platform: "linux" });
    expect(run.args.slice(0, 4)).toEqual(["run", "--rm", "--network", "host"]);
    expect(run.env.PG_META_DB_URL).toBe(LOCAL);
  });

  it.each(["127.0.0.1", "localhost"])("on Docker Desktop (Windows, macOS) points %s at the host instead, since the container's loopback is its own", (host) => {
    const run = pgMetaRun(`postgresql://postgres:pw@${host}:55461/pre`, { platform: "win32" });
    expect(run.args).not.toContain("--network");
    expect(run.env.PG_META_DB_URL).toBe("postgresql://postgres:pw@host.docker.internal:55461/pre");
  });

  it("joins a named docker network unchanged (the throwaway database's own)", () => {
    const url = "postgresql://postgres:postgres@bis-types-db:5432/postgres";
    const run = pgMetaRun(url, { network: "bis-types-net" });
    expect(run.args.slice(0, 4)).toEqual(["run", "--rm", "--network", "bis-types-net"]);
    expect(run.env.PG_META_DB_URL).toBe(url);
  });

  it("refuses production's database, naming the ref and not the URL", () => {
    const prod = "postgresql://postgres.tlbkbmlrfafquucsmsmm:s3cret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
    expect(() => pgMetaRun(prod, { platform: "linux" })).toThrow(/production/);
    expect(() => pgMetaRun(prod, { platform: "linux" })).not.toThrow(/s3cret/);
  });
});

describe("acceptGenerated: what the generator printed is a types file, or nothing is written", () => {
  it("passes a types file through byte for byte", () => {
    expect(acceptGenerated(GENERATED)).toBe(GENERATED);
  });

  it.each([
    ["nothing", ""],
    ["an error", "Error: connect ECONNREFUSED 127.0.0.1:54322\n"],
    ["a file with no Database type", "export type Json = string\n"],
  ])("refuses %s", (_label, out) => {
    expect(() => acceptGenerated(out)).toThrow(/did not print a types file/);
  });
});

describe("driftReport: the CI check's verdict", () => {
  it("is null when the checked-in file is exactly what the schema generates", () => {
    expect(driftReport(GENERATED, GENERATED)).toBeNull();
  });

  it("names the file, the first line that differs, and the command that fixes it", () => {
    const stale = GENERATED.replace("public: {}", "public: { old: true }");
    const report = driftReport(stale, GENERATED);
    expect(report).toContain(TYPES_FILE);
    expect(report).toContain("line 5");
    expect(report).toContain(REGENERATE);
    expect(REGENERATE).toBe("pnpm --filter @bis/db types:gen");
  });

  it("quotes the differing line from both sides, so a CI log alone says what changed", () => {
    const stale = GENERATED.replace("public: {}", "public: { old: true }");
    const report = driftReport(stale, GENERATED);
    expect(report).toContain("checked in: `  public: { old: true }`");
    expect(report).toContain("generated:  `  public: {}`");
  });

  it("counts a missing trailing newline or a CRLF file as drift (the comparison is bytes)", () => {
    expect(driftReport(GENERATED.trimEnd(), GENERATED)).not.toBeNull();
    expect(driftReport(GENERATED.replace(/\n/g, "\r\n"), GENERATED)).not.toBeNull();
  });
});

describe("parseArgs: the URL comes from a variable NAMED on the command line, so no URL is ever in argv (pnpm echoes argv when a script fails)", () => {
  it("defaults to writing from a throwaway database", () => {
    expect(parseArgs(["write"], {})).toEqual({ mode: "write", dbUrl: null });
  });

  it("takes check and the name of the variable holding an existing database's URL", () => {
    expect(parseArgs(["check", "--db-url-env", "SUPABASE_DB_URL"], { SUPABASE_DB_URL: LOCAL })).toEqual({ mode: "check", dbUrl: LOCAL });
  });

  it("refuses a named variable that is empty or unset, naming the variable and nothing else", () => {
    expect(() => parseArgs(["check", "--db-url-env", "SUPABASE_DB_URL"], {})).toThrow("SUPABASE_DB_URL is empty or unset");
    expect(() => parseArgs(["check", "--db-url-env", "SUPABASE_DB_URL"], { SUPABASE_DB_URL: "" })).toThrow(/SUPABASE_DB_URL/);
  });

  it.each([[[]], [["generate"]], [["check", "--db-url-env"]], [["check", "--db-url", LOCAL]], [["write", "--schema", "x"]]])(
    "refuses %j",
    (argv) => {
      expect(() => parseArgs(argv, { SUPABASE_DB_URL: LOCAL })).toThrow(/usage/);
    },
  );
});

describe("schemaFiles: the throwaway database is built in the CI stack's order", () => {
  it("applies the bootstrap first, then every migration in file-name order, and nothing else", () => {
    const files = schemaFiles(["0002_b.sql", "README.md", "0010_c.sql", "0001_a.sql"]);
    expect(files).toEqual([
      "supabase/bootstrap/ci-project.sql",
      "supabase/migrations/0001_a.sql",
      "supabase/migrations/0002_b.sql",
      "supabase/migrations/0010_c.sql",
    ]);
  });
});
