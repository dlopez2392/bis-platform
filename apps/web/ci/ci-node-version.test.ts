import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Production runs on the Vercel project's Node major (24.x, read from the
// project settings 2026-10-09). CI ran 22 until then, so a gate could pass on
// a runtime production never uses (D-098). Every workflow that installs Node
// pins the same major as production; a move to the next major changes this
// constant, the Vercel setting and every workflow together.

const PRODUCTION_NODE_MAJOR = "24";

const workflowDir = new URL("../../../.github/workflows/", import.meta.url);
const workflowFiles = fs.readdirSync(fileURLToPath(workflowDir))
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

/** Each `actions/setup-node` step with the node-version its `with:` block names (null when it names none), and the top-level job (two-space key) it falls under in `jobs:` (null outside one). */
function setupNodeSteps(file: string): Array<{ file: string; job: string | null; version: string | null }> {
  const lines = fs.readFileSync(fileURLToPath(new URL(file, workflowDir)), "utf8")
    .replace(/\r\n/g, "\n").split("\n")
    .filter((l) => !/^\s*#/.test(l));
  const steps: Array<{ file: string; job: string | null; version: string | null }> = [];
  let job: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const jobId = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]!)?.[1];
    if (jobId) job = jobId;
    if (!/uses:\s*actions\/setup-node@/.test(lines[i]!)) continue;
    let version: string | null = null;
    // The step runs until the next `- ` item at the same or a shallower indent.
    const indent = lines[i]!.search(/\S/);
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() === "") continue;
      const lineIndent = l.search(/\S/);
      if (lineIndent <= indent && /^\s*- /.test(l)) break;
      if (lineIndent < indent) break;
      const m = l.match(/^\s*node-version:\s*["']?([^"'\s]+)["']?\s*$/);
      if (m) { version = m[1]!; break; }
    }
    steps.push({ file, job, version });
  }
  return steps;
}

describe("CI installs the Node major production runs on", () => {
  const steps = workflowFiles.flatMap(setupNodeSteps);

  // The scanner job (S-07 2a) added a third; the split of verify and e2e into
  // parallel parts (2026-11-12) made it four: verify-db's, verify-app's,
  // e2e-shard's (one step, every shard) and scanner's, each pinned to
  // production's major in the loop below. The gates (verify, e2e) install no
  // Node; migrations-plan and migrations-bis-ci (2026-11-13) each install one.
  // A job that installs Node but forgets to
  // pin it — or pins a different major — must still show up here, named, or
  // this count silently drops and the loop below never sees it (mutation:
  // drop scanner's setup-node step, or its node-version, → FAILS).
  it("finds the setup-node steps of verify-db, verify-app, e2e-shard, migrations-plan, migrations-bis-ci and scanner (so the check below is not empty)", () => {
    const ciSteps = steps.filter((s) => s.file === "ci.yml");
    expect(ciSteps).toHaveLength(6);
    expect(ciSteps.map((s) => s.job).sort()).toEqual(["e2e-shard", "migrations-bis-ci", "migrations-plan", "scanner", "verify-app", "verify-db"]);
  });

  it.each(steps.map((s, i) => [`${s.file}${s.job ? ` (${s.job})` : ""} #${i}`, s] as const))(
    "%s pins node-version to production's major",
    (_label, step) => {
      expect(step.version).toBe(PRODUCTION_NODE_MAJOR);
    },
  );
});
