import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F-085 part 1 (spec §7.1, plan deviation 1): the surfaces a Technician does
 * not work on (Dashboard, Activity, Pipeline, Website, Forms, Import and
 * Branding) refuse them in the page AND in every action the page posts,
 * through `requireNotTechnician(accountId)`, before anything is read.
 * Hiding the nav link is convenience; this is the boundary.
 *
 * A source scan, the house pattern for guard tests (registry.test.ts,
 * app-sidebar.test.ts): comments are stripped first, so a guard that exists
 * only in a comment cannot satisfy it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

const PAGES = [
  "dashboard/page.tsx", "activity/page.tsx", "pipeline/page.tsx", "website/page.tsx",
  "forms/page.tsx", "forms/[formId]/page.tsx", "contacts/import/page.tsx", "branding/page.tsx",
  // F-006 part 1 (plan Task 10; owner ruling D9): merge, undo and dismiss are Owners, Staff and the
  // agency only — never a Technician, who cannot read the duplicates queue at all (0068).
  "contacts/merge/page.tsx",
] as const;

const ACTIONS: Record<string, string[]> = {
  "pipeline/actions.ts": ["createOpportunityAction", "moveOppToStageAction", "updateOpportunityAction"],
  "forms/actions.ts": ["createFormAction", "saveFormAction", "republishFormAction"],
  "contacts/import/actions.ts": ["importContactsBatchAction"],
  "branding/actions.ts": ["setBrandingAction", "removeBrandLogoAction", "restoreBrandLogoAction"],
};

/** A Technician's own five screens (spec §9). accountHome sends them to To do, so none may refuse them: the loop guard. */
const TECHNICIAN_HOMES = [
  "tasks/page.tsx", "contacts/page.tsx", "conversations/page.tsx", "calendar/page.tsx", "calls/page.tsx",
] as const;

/** Code only: line and block comments removed, strings kept (registry.test.ts's scanner). */
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

function read(rel: string): string {
  return stripComments(readFileSync(path.join(here, rel), "utf8"));
}

/**
 * The body of the function whose declaration starts at `start`: past the
 * balanced parameter list, the first `{` that ends its line opens the body
 * (a return type's own braces never end a line in this tree), then to the
 * matching `}`.
 */
function bodyFrom(src: string, start: number): string {
  let i = src.indexOf("(", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  const open = src.slice(i).search(/\{\s*\n/) + i;
  depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
  }
  throw new Error("unbalanced body");
}

/**
 * Why `body` is not guarded first, or null when it is. The guard must be
 * AWAITED (fix round 1, review M2): directly, or as a member of an awaited
 * Promise.all. Called without an await, its redirect stops nothing.
 */
function guardProblem(body: string): string | null {
  if (body.indexOf("requireNotTechnician(accountId)") < 0) return "never calls requireNotTechnician(accountId)";
  const awaited = /await\s+(?:Promise\.all\(\[\s*)?requireNotTechnician\(accountId\)/.exec(body);
  if (!awaited) return "calls requireNotTechnician(accountId) but it is not awaited";
  const guard = awaited.index;
  for (const read of ["dbForRequest(", "serviceDb("]) {
    const at = body.indexOf(read);
    if (at >= 0 && at < guard) return `calls ${read} before requireNotTechnician(accountId)`;
  }
  // Only the route's own params may be awaited ahead of the guard; the guard
  // may share its await with a read of the caller's own preferences.
  for (const m of body.matchAll(/\bawait\s+/g)) {
    if (m.index! >= guard) break;
    const rest = body.slice(m.index! + m[0].length);
    if (/^(params|searchParams)\b/.test(rest)) continue;
    const statement = rest.slice(0, rest.search(/;|\n\s*\n/));
    if (statement.includes("requireNotTechnician(accountId)")) continue;
    return `awaits \`${rest.slice(0, 40).split("\n")[0]}\` before requireNotTechnician(accountId)`;
  }
  return null;
}

describe("the refused pages call requireNotTechnician(accountId) before any read (spec §7.1)", () => {
  it.each(PAGES)("%s", (rel) => {
    const src = read(rel);
    const start = src.indexOf("export default async function");
    expect(start, `${rel} has no default async page`).toBeGreaterThanOrEqual(0);
    expect(guardProblem(bodyFrom(src, start)), rel).toBeNull();
  });
});

describe("every action those pages post calls requireNotTechnician(accountId) first (spec §7.1)", () => {
  const cases = Object.entries(ACTIONS).flatMap(([rel, names]) => names.map((name) => [rel, name] as const));
  it.each(cases)("%s: %s (mutation: remove the call from branding/actions.ts's removeBrandLogoAction -> FAILS naming it)", (rel, name) => {
    const src = read(rel);
    const start = src.indexOf(`export async function ${name}(`);
    expect(start, `${rel} has no ${name}`).toBeGreaterThanOrEqual(0);
    expect(guardProblem(bodyFrom(src, start)), `${rel}: ${name}`).toBeNull();
  });

  it("the list is every exported action in those files (a new action cannot slip in unguarded)", () => {
    for (const [rel, names] of Object.entries(ACTIONS)) {
      const exported = [...read(rel).matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
      expect(exported.sort(), rel).toEqual([...names].sort());
    }
  });
});

describe("a Technician's own screens never refuse them (the redirect-loop guard)", () => {
  it.each(TECHNICIAN_HOMES)("%s does not call requireNotTechnician (mutation: guard tasks/page.tsx -> FAILS)", (rel) => {
    expect(read(rel)).not.toContain("requireNotTechnician");
  });
});

describe("the Documents page admits a Technician (S-07 3a, spec 3.1)", () => {
  it("the Documents page admits a Technician: it never calls requireNotTechnician, and it does call requireAccountAccess (spec 3.1; RLS bounds the rows) (mutation: add requireNotTechnician(accountId) -> FAILS)", () => {
    const src = read("documents/page.tsx");
    expect(src).not.toContain("requireNotTechnician");
    expect(src).toContain("requireAccountAccess(accountId)");
  });
});

describe("the scanner itself", () => {
  it("rejects a guard that comes after a read, and one that sits only in a comment", () => {
    expect(guardProblem("{\n  const db = await dbForRequest();\n  await requireNotTechnician(accountId);\n}")).toMatch(/dbForRequest/);
    expect(guardProblem(stripComments("{\n  // await requireNotTechnician(accountId);\n  const db = await dbForRequest();\n}"))).toMatch(/never calls/);
    expect(guardProblem("{\n  const x = await listThings(db);\n  await requireNotTechnician(accountId);\n}")).toMatch(/awaits `listThings/);
    expect(guardProblem("{\n  const { accountId } = await params;\n  const [{ isAgency }, prefs] = await Promise.all([requireNotTechnician(accountId), getPersonPrefs()]);\n  const db = await dbForRequest();\n}")).toBeNull();
  });
  // Fix round 1 (review M2): a guard that is called but not awaited redirects
  // nobody: its rejection floats while the page reads on.
  it("rejects a guard that is called but not awaited (mutation: accept any call -> FAILS)", () => {
    expect(guardProblem("{\n  const { accountId } = await params;\n  requireNotTechnician(accountId);\n  const db = await dbForRequest();\n}")).toMatch(/not awaited/);
    expect(guardProblem("{\n  void requireNotTechnician(accountId);\n}")).toMatch(/not awaited/);
    expect(guardProblem("{\n  const p = requireNotTechnician(accountId);\n  const db = await dbForRequest();\n  await p;\n}")).toMatch(/not awaited/);
    expect(guardProblem("{\n  Promise.all([requireNotTechnician(accountId), getPersonPrefs()]);\n}")).toMatch(/not awaited/);
    expect(guardProblem("{\n  const { userId } = await requireNotTechnician(accountId);\n}")).toBeNull();
  });
});
