import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A shallow `history.pushState`/`replaceState` must never hand the CURRENT
 * history state back as its data argument.
 *
 * Next patches both methods (next@16.2.11,
 * `dist/client/components/app-router.js:252-279`). When the data it is given
 * already carries `__NA` (or `_N`), the patch assumes the call is Next's OWN
 * and forwards it untouched — it does NOT dispatch `ACTION_RESTORE`
 * (`applyUrlFromHistoryPushReplace`, `:237-246`), so the router's canonical
 * URL never learns the URL we pushed. After hydration `window.history.state`
 * always carries `__NA: true` (Next's HistoryUpdater writes it, `:51-67`), so
 * passing it made every push invisible to the router — and the next
 * `router.refresh()` or revalidating server action navigated to the router's
 * STALE URL and wrote it back to the address bar. That is how "Skip for now"
 * jumped the setup pane off `?step=` and an inline save closed the contact
 * drawer by stripping `?peek=`. The documented form is `pushState(null, …)`
 * (Next's own docs, `01-app/02-guides/single-page-applications.md`); the
 * patch then copies `__NA` and the tree onto the new entry itself.
 *
 * This walks every non-test file under `apps/web/src`, comments stripped, and
 * fails on any push/replace whose FIRST argument mentions `history.state` —
 * bare, `window.`-qualified, optional-chained or spread into an object, all
 * of which carry `__NA` across. It is a tripwire for the shape, not a proof:
 * `const s = history.state; pushState(s, …)` would slip past it.
 *
 * Mutation: put `window.history.state` back as the first argument at any one
 * site (e.g. `lib/contacts/use-peek.ts`'s `open`) — the first test fails,
 * naming that file.
 */
const WEB_SRC = fileURLToPath(new URL("..", import.meta.url));

/** Copied from packages/db/src/__tests__/cascade-export-boundary.test.ts. */
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
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

const isTestFile = (file: string) =>
  /\.(test|spec)\.tsx?$/.test(file) || file.split(path.sep).includes("__tests__");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !isTestFile(full)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(WEB_SRC, file).split(path.sep).join("/");

/**
 * The first argument of every `history.pushState(` / `history.replaceState(`
 * call in already-comment-stripped code: everything up to the first comma or
 * closing paren at bracket depth zero. Strings are skipped whole so a comma
 * inside a literal does not end the argument early.
 */
function historyCallFirstArgs(code: string): { method: string; firstArg: string }[] {
  const calls: { method: string; firstArg: string }[] = [];
  const re = /\bhistory\s*\??\.\s*(pushState|replaceState)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 0;
    let i = re.lastIndex;
    let quote: string | null = null;
    for (; i < code.length; i++) {
      const c = code[i];
      if (quote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
    }
    calls.push({ method: m[1] ?? "", firstArg: code.slice(re.lastIndex, i).trim() });
  }
  return calls;
}

/** `history.state` anywhere in the argument — bare, qualified, `?.`, or spread. */
const carriesCurrentState = (firstArg: string) => /\bhistory\s*\??\.\s*state\b/.test(firstArg);

describe("shallow history calls reach the Next router (no __NA passed back in)", () => {
  const files = walk(WEB_SRC);

  it("no push/replaceState under apps/web/src passes history.state as its data", () => {
    // Floor well below the real count (412 on 2026-09-22), so a wrong-but-
    // existing directory cannot pass vacuously on an empty offenders list.
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      for (const call of historyCallFirstArgs(stripComments(fs.readFileSync(file, "utf8")))) {
        if (carriesCurrentState(call.firstArg)) {
          offenders.push(`${rel(file)}: ${call.method}(${call.firstArg}, …)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the walk reaches the three shallow-routing call sites (guards the fixture)", () => {
    const sites: string[] = [];
    for (const file of files) {
      for (const call of historyCallFirstArgs(stripComments(fs.readFileSync(file, "utf8")))) {
        sites.push(`${rel(file)}: ${call.method}`);
      }
    }
    expect(sites).toEqual(expect.arrayContaining([
      "lib/contacts/use-peek.ts: pushState",
      "lib/contacts/use-peek.ts: replaceState",
      "app/(dashboard)/dashboard/accounts/[accountId]/setup/setup-shell.tsx: pushState",
    ]));
  });

  it("reads the first argument of a call, not a mention in a comment", () => {
    const flagged = (src: string) =>
      historyCallFirstArgs(stripComments(src)).filter((c) => carriesCurrentState(c.firstArg));

    expect(flagged(`// window.history.pushState(window.history.state, "", url) was the bug\n`)).toEqual([]);
    expect(flagged(`window.history.pushState(null, "", url);`)).toEqual([]);
    // history.state in a LATER argument is not the data argument.
    expect(flagged(`history.replaceState(null, String(history.state), url);`)).toEqual([]);

    expect(flagged(`window.history.pushState(window.history.state, "", url);`)).toHaveLength(1);
    expect(flagged(`history.replaceState(history.state, "", url);`)).toHaveLength(1);
    expect(flagged(`window.history.pushState(window.history?.state, "", url);`)).toHaveLength(1);
    expect(flagged(`window.history.pushState({ ...window.history.state, a: 1 }, "", url);`)).toHaveLength(1);
  });
});
