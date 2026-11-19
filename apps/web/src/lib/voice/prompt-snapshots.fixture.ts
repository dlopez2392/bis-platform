// F-023 PR 4: how the prompt snapshot tests pin a whole prompt without committing megabytes of it.
//  - digestPrompts: sha256 over prompts in order, each followed by NUL. A group of prompts is pinned by one digest;
//    a failure names the group, and the changed text is seen by rebuilding that group at the base commit and diffing.
//  - checkSamples: a few prompts kept as full text (one JSON array of lines per prompt), so a deliberate change reads
//    in a diff as the lines it changed. WRITE_PROMPT_SNAPSHOTS=1 rewrites the file a test names and then FAILS that
//    test, so a run that writes can never also be a green run.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export function digestPrompts(prompts: readonly string[]): string {
  const h = createHash("sha256");
  for (const p of prompts) h.update(`${p}\u0000`);
  return h.digest("hex");
}

type SamplesFile = { prompts: Record<string, string[]> };

function encodeSamples(prompts: Record<string, string>): string {
  const body = Object.entries(prompts).map(([k, p]) =>
    `    ${JSON.stringify(k)}: [\n${p.split("\n").map((l) => `      ${JSON.stringify(l)}`).join(",\n")}\n    ]`);
  return `{\n  "prompts": {\n${body.join(",\n")}\n  }\n}\n`;
}

export type SampleCheck = { written: boolean; keys: string[]; mismatched: { key: string; actual: string; expected: string | undefined }[] };

/** Compares `actual` with the samples file at `path` (or writes it, under WRITE_PROMPT_SNAPSHOTS=1). */
export function checkSamples(path: string, actual: Record<string, string>): SampleCheck {
  if (process.env.WRITE_PROMPT_SNAPSHOTS === "1") {
    writeFileSync(path, encodeSamples(actual));
    return { written: true, keys: Object.keys(actual), mismatched: [] };
  }
  const file = JSON.parse(readFileSync(path, "utf8")) as SamplesFile;
  return {
    written: false,
    keys: Object.keys(file.prompts),
    mismatched: Object.entries(actual)
      .map(([key, a]) => ({ key, actual: a, expected: file.prompts[key]?.join("\n") }))
      .filter((m) => m.actual !== m.expected),
  };
}
