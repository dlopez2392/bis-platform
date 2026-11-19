// F-023 PR 4: the whole system prompt, byte for byte, for every combination a surface can send. Captured from main
// (4b7e9147) BEFORE the prompt learned which tools its session was offered, so a change of one character on the phone
// line fails a test rather than reaching a call.
//
// Two encodings, both exact:
//  - "dictionary" (the phone and the web chat, thousands of prompts): every distinct line once in `lines`, each prompt
//    a list of indices into it. Never re-baselined; a change is a finding.
//  - "lines" (the two demos, a few dozen prompts): each prompt as its own list of lines, so a deliberate re-baseline
//    reads in a diff as the lines it removed.
//
// Writing: WRITE_PROMPT_SNAPSHOTS=1 rewrites the fixture a test names and then FAILS that test, so a run that writes
// can never also be a green run.
import { readFileSync, writeFileSync } from "node:fs";

export type DictionaryFile = { encoding: "dictionary"; lines: string[]; prompts: Record<string, number[]> };
export type LinesFile = { encoding: "lines"; prompts: Record<string, string[]> };
export type SnapshotFile = DictionaryFile | LinesFile;

export function decodePrompt(file: SnapshotFile, key: string): string | undefined {
  if (file.encoding === "lines") return file.prompts[key]?.join("\n");
  const idx = file.prompts[key];
  return idx?.map((i) => file.lines[i]).join("\n");
}

/** The fixture's JSON text: one dictionary line or one prompt per line of the file. */
export function encodeSnapshots(encoding: SnapshotFile["encoding"], prompts: Record<string, string>): string {
  const keys = Object.keys(prompts);
  if (encoding === "lines") {
    const body = keys.map((k) => `    ${JSON.stringify(k)}: [\n${prompts[k]!.split("\n").map((l) => `      ${JSON.stringify(l)}`).join(",\n")}\n    ]`);
    return `{\n  "encoding": "lines",\n  "prompts": {\n${body.join(",\n")}\n  }\n}\n`;
  }
  const lines: string[] = [];
  const index = new Map<string, number>();
  const encoded = keys.map((k) => {
    const ids = prompts[k]!.split("\n").map((l) => {
      let i = index.get(l);
      if (i === undefined) { i = lines.length; lines.push(l); index.set(l, i); }
      return i;
    });
    return `    ${JSON.stringify(k)}: [${ids.join(",")}]`;
  });
  return `{\n  "encoding": "dictionary",\n  "lines": [\n${lines.map((l) => `    ${JSON.stringify(l)}`).join(",\n")}\n  ],\n  "prompts": {\n${encoded.join(",\n")}\n  }\n}\n`;
}

export type SnapshotCheck = { written: boolean; missingKeys: string[]; extraKeys: string[]; mismatched: string[] };

/**
 * Compares every prompt with the fixture at `path` (or writes it, under WRITE_PROMPT_SNAPSHOTS=1). The caller asserts
 * on the result, and on `written` being false, so a write is never a pass.
 */
export function checkSnapshots(path: string, encoding: SnapshotFile["encoding"], actual: Record<string, string>): SnapshotCheck {
  if (process.env.WRITE_PROMPT_SNAPSHOTS === "1") {
    writeFileSync(path, encodeSnapshots(encoding, actual));
    return { written: true, missingKeys: [], extraKeys: [], mismatched: [] };
  }
  const file = JSON.parse(readFileSync(path, "utf8")) as SnapshotFile;
  const want = Object.keys(file.prompts);
  const got = Object.keys(actual);
  return {
    written: false,
    missingKeys: want.filter((k) => !(k in actual)),
    extraKeys: got.filter((k) => !(k in file.prompts)),
    mismatched: got.filter((k) => k in file.prompts && decodePrompt(file, k) !== actual[k]),
  };
}

export function readSnapshot(path: string, key: string): string | undefined {
  return decodePrompt(JSON.parse(readFileSync(path, "utf8")) as SnapshotFile, key);
}
