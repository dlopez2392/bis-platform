/**
 * What `types:gen` and `types:check` do with a generated file, apart from
 * the I/O (./run.ts supplies it as `Deps`), so the verdict and the exit code
 * are tested (./cli.test.ts) rather than trusted.
 */
import { fileURLToPath } from "node:url";
import { checkVerdict, parseArgs, redactSecrets, TYPES_FILE } from "./plan";

/** The checked-in file: the one `write` replaces and `check` compares against. */
export const OUT = fileURLToPath(new URL("../database.types.ts", import.meta.url));

export type Deps = {
  /** The generator against an existing database. */
  generateFrom(dbUrl: string): string;
  /** The generator against a throwaway database built from the migrations. */
  generateFromMigrations(): string;
  readText(path: string): string;
  writeText(path: string, text: string): void;
  /** Saves the generated text somewhere the author can diff it; returns where. Called on drift only. */
  saveGeneratedCopy(text: string): string;
  out(line: string): void;
  err(line: string): void;
};

/** The exit code for one run. Never throws: an error is printed, redacted, as exit 1. */
export function main(argv: string[], env: Record<string, string | undefined>, deps: Deps): 0 | 1 {
  try {
    const { mode, dbUrl } = parseArgs(argv, env);
    const generated = dbUrl ? deps.generateFrom(dbUrl) : deps.generateFromMigrations();
    if (mode === "write") {
      deps.writeText(OUT, generated);
      deps.out(`types: wrote ${TYPES_FILE} (${generated.split("\n").length} lines)`);
      return 0;
    }
    const verdict = checkVerdict(deps.readText(OUT), generated, env.GITHUB_ACTIONS === "true");
    if (verdict.exitCode === 0) {
      deps.out(verdict.message);
      return 0;
    }
    deps.err(`${verdict.message} The generated file is at ${deps.saveGeneratedCopy(generated)}.`);
    return 1;
  } catch (e) {
    deps.err(redactSecrets((e as Error).message));
    return 1;
  }
}

/** main, with its verdict made the process's exit code. */
export function runCli(argv: string[], env: Record<string, string | undefined>, deps: Deps,
  proc: { exitCode?: number | string | null }): void {
  proc.exitCode = main(argv, env, deps);
}
