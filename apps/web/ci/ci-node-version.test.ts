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

/** Each `actions/setup-node` step with the node-version its `with:` block names (null when it names none). */
function setupNodeSteps(file: string): Array<{ file: string; version: string | null }> {
  const lines = fs.readFileSync(fileURLToPath(new URL(file, workflowDir)), "utf8")
    .replace(/\r\n/g, "\n").split("\n")
    .filter((l) => !/^\s*#/.test(l));
  const steps: Array<{ file: string; version: string | null }> = [];
  for (let i = 0; i < lines.length; i++) {
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
    steps.push({ file, version });
  }
  return steps;
}

describe("CI installs the Node major production runs on", () => {
  const steps = workflowFiles.flatMap(setupNodeSteps);

  it("finds the setup-node steps of both gates (so the check below is not empty)", () => {
    expect(steps.filter((s) => s.file === "ci.yml")).toHaveLength(2);
  });

  it.each(steps.map((s, i) => [`${s.file} #${i}`, s] as const))(
    "%s pins node-version to production's major",
    (_label, step) => {
      expect(step.version).toBe(PRODUCTION_NODE_MAJOR);
    },
  );
});
