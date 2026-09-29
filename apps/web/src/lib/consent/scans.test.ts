import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { SMS_KINDS } from "./classes";

/**
 * The consent chain's source scans (spec §8, "Source scans"), PR-1's share:
 *   1. only the gate reaches an SMS provider;
 *   2. every kind literal handed to the gate is in the registry;
 *   3. only packages/db/src/consent.ts touches consent_events, and never with
 *      an update, upsert or delete;
 *   5. nothing reads the retired quiet-hours settings;
 * plus this PR's own: `toE164` is gone for good (F-009's one rule), the
 * test-only fake gate is imported by tests alone (by ANY path), only the
 * text-back sets `numberFromCarrier`, and no contact write is handed a
 * number a normaliser already made (it must get the number as typed or as
 * said, so `phoneFields` can flag the ones that could be Mexican or US).
 * Scan 4 (the customer-initiated EMAIL kinds) is PR-3's, with the email kinds.
 *
 * Every scan reads CODE, never comments (the doc-comment-satisfies-the-guard
 * shape, memory bis-vacuous-test-shapes), and each has a positive control
 * proving it can see what it looks for — a scan that finds nothing because it
 * reads nothing is the silent no-op this repo has shipped three times.
 */
const WEB_SRC = fileURLToPath(new URL("../../", import.meta.url));      // apps/web/src/
const REPO = fileURLToPath(new URL("../../../../../", import.meta.url)); // repo root
const DB_SRC = join(REPO, "packages", "db", "src");

// Every scan reads every source file. Under the full suite's parallel load
// the first scans to print the tree ran past vitest's 5 s default (the
// integration head, a6e323e2), so the file gets room, and each file is
// walked, read and printed ONCE for the whole test file (the two Maps).
vi.setConfig({ testTimeout: 60_000 });

function walkDir(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walkDir(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const walked = new Map<string, readonly string[]>();
/** The .ts/.tsx files under `dir`, walked once per test file. */
function walk(dir: string): readonly string[] {
  if (!walked.has(dir)) walked.set(dir, walkDir(dir));
  return walked.get(dir)!;
}
const isTest = (f: string) => /\.test\.tsx?$/.test(f);
/** Forward slashes, relative to the repo, whatever the OS (Windows prints `\`). */
const rel = (f: string) => relative(REPO, f).split(sep).join("/");
/** A file parsed by TypeScript itself (`.tsx` as TSX). */
const parse = (f: string, text: string) =>
  ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const printer = ts.createPrinter({ removeComments: true });
/** Each file's printed code, by path: parsed and printed once for the whole test file. */
const printed = new Map<string, string>();
/** A file's CODE: TypeScript's own printer with the comments removed. Regexes
 *  cannot do it: stripping block comments first let a `// …/dashboard/*` line
 *  comment swallow real code up to the next block comment's end, and a regex literal holding
 *  `\/\/` read as a line comment and ate the rest of its line. */
function code(f: string, text?: string): string {
  if (text !== undefined) return printer.printFile(parse(f, text));
  if (!printed.has(f)) printed.set(f, printer.printFile(parse(f, readFileSync(f, "utf-8"))));
  return printed.get(f)!;
}

const webSources = () => walk(WEB_SRC).filter((f) => !isTest(f));
const dbSources = () => walk(DB_SRC).filter((f) => !isTest(f));

/** Every module specifier a file imports, re-exports or loads lazily. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;
/** A module's identity: repo-relative, no extension, no trailing `/index`, so
 *  `@/lib/sms`, `../sms/index.ts` and lib/sms's own `./index` are one module. */
const moduleId = (abs: string) => rel(abs).replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");
/** The in-repo modules a file imports: `@/…` and relative specifiers, resolved
 *  against the file's own folder (packages are not followed). */
function importsOf(file: string, src: string = code(file)): string[] {
  return [...src.matchAll(SPECIFIER)].flatMap(([, spec]) =>
    spec!.startsWith("@/") || spec!.startsWith(".") ? [resolveSpec(file, spec!)] : []);
}
/** One specifier's module id, resolved against `file`'s folder (a package name stays as it is). */
const resolveSpec = (file: string, spec: string) =>
  spec.startsWith("@/") ? moduleId(join(WEB_SRC, spec.slice(2)))
  : spec.startsWith(".") ? moduleId(join(dirname(file), spec))
  : spec;
const GATE_FILE = join(WEB_SRC, "lib", "consent", "gate.ts");

describe("every scan reads the code, and only the comments are gone", () => {
  it("code after a `// …/*` line comment, and after a regex literal holding \\/\\/, is still scanned, while the comments themselves are not (mutation: strip block comments, then line comments, with regexes → FAILS)", () => {
    const src = [
      "// fires for every /api/cron/* tick",
      "import { getSmsProvider } from \"@/lib/sms\";",
      "const HOST = /^https?:\\/\\//; const provider = getSmsProvider();",
      "/** a doc comment naming quiet_start */",
      "export const tsx = <div>{/* a JSX comment naming quiet_end */}{provider.name}</div>;",
    ].join("\n");
    const seen = code("probe.tsx", src);
    expect(seen).toContain("import { getSmsProvider } from \"@/lib/sms\";");
    expect(seen).toMatch(/const provider = getSmsProvider\(\);/);
    expect(seen).toMatch(/\{provider\.name\}/);
    expect(seen).not.toMatch(/fires for every|quiet_start|quiet_end/);
  });
});

describe("scan 1: only the send gate reaches an SMS provider", () => {
  // The provider's own modules, and the gate. alerts.ts is IN lib/sms but is
  // one of the five send paths, so it is scanned like any other.
  // types.ts is NOT exempt (review R3-M1): it holds types and the error
  // class only, and an exemption would let it re-export the factory.
  const PROVIDER_MODULES = new Set([
    "apps/web/src/lib/sms/index.ts", "apps/web/src/lib/sms/telnyx.ts", "apps/web/src/lib/sms/fake.ts",
    "apps/web/src/lib/consent/gate.ts",
  ]);
  const REACHES_PROVIDER: readonly RegExp[] = [
    /\bgetSmsProvider\b/,
    /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/sms|(?:\.\.?\/)+sms|\.\/index|\.\.\/index)(?:\/index)?(?:\.[jt]s)?["']/,
    /(?:from\s+|import\s*\(\s*)["'][^"']*\/telnyx["']/,
    /\btelnyxSmsProvider\b|\bfakeSmsProvider\b/,
  ];
  // The same three modules by RESOLVED path, so an import the regexes above
  // cannot spell (`../../lib/sms` from a route) still counts.
  const PROVIDER_IDS = new Set(["apps/web/src/lib/sms", "apps/web/src/lib/sms/telnyx", "apps/web/src/lib/sms/fake"]);

  it("no source file outside the provider's modules and the gate names the factory, the providers or lib/sms's index (mutation: import getSmsProvider back into alerts.ts or harness.ts → FAILS naming it)", () => {
    const offenders = webSources()
      .filter((f) => !PROVIDER_MODULES.has(rel(f)))
      .filter((f) => {
        const src = code(f);
        // lib/sms/alerts.ts's own `./index` would be the factory; elsewhere
        // `./index` is some other module, so that rule is only for lib/sms.
        return REACHES_PROVIDER.some((r, i) => (i === 1 && !rel(f).startsWith("apps/web/src/lib/sms/")
          ? /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/sms|(?:\.\.\/)+sms|\.\/sms)(?:\/index)?(?:\.[jt]s)?["']/.test(src)
          : r.test(src))) || importsOf(f, src).some((m) => PROVIDER_IDS.has(m));
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the gate itself does reach the factory — the scan can see an import (the positive control)", () => {
    expect(code(join(WEB_SRC, "lib", "consent", "gate.ts"))).toMatch(REACHES_PROVIDER[0]!);
    expect(importsOf(join(WEB_SRC, "lib", "consent", "gate.ts"))).toContain("apps/web/src/lib/sms");
    expect(webSources().length).toBeGreaterThan(300);
  });

  it("only the Telnyx provider names the messages endpoint: no raw fetch around the gate (review R3-M1; mutation: fetch https://api.telnyx.com/v2/messages from a pass → FAILS naming it; the list holding telnyx.ts is the positive control)", () => {
    expect(webSources().filter((f) => /\/v2\/messages\b/.test(code(f))).map(rel)).toEqual(["apps/web/src/lib/sms/telnyx.ts"]);
  });

  it("exactly two files name api.telnyx.com: the SMS provider and the number purchase (mutation: a third file names https://api.telnyx.com → FAILS naming it)", () => {
    expect(webSources().filter((f) => /api\.telnyx\.com/.test(code(f))).map(rel).sort())
      .toEqual(["apps/web/src/lib/sms/telnyx.ts", "apps/web/src/lib/voice/telnyx-numbers.ts"]);
  });

  it("the gate exports nothing it imports from lib/sms, so nothing reaches the provider THROUGH the gate (mutation: gate.ts adds export { getSmsProvider }, or export … from \"@/lib/sms\" → FAILS naming it; the lib/sms names it sees are the positive control)", () => {
    const sf = parse(GATE_FILE, readFileSync(GATE_FILE, "utf-8"));
    const isSms = (spec: ts.Expression | undefined) => !!spec && ts.isStringLiteral(spec)
      && /^apps\/web\/src\/lib\/sms(?:\/|$)/.test(resolveSpec(GATE_FILE, spec.text));
    const smsNames = new Set<string>();
    for (const s of sf.statements) {
      if (!ts.isImportDeclaration(s) || !isSms(s.moduleSpecifier)) continue;
      const clause = s.importClause;
      if (clause?.name) smsNames.add(clause.name.text);
      const bound = clause?.namedBindings;
      if (bound && ts.isNamespaceImport(bound)) smsNames.add(bound.name.text);
      if (bound && ts.isNamedImports(bound)) bound.elements.forEach((e) => smsNames.add(e.name.text));
    }
    const leaks = sf.statements.filter((s) =>
      (ts.isExportDeclaration(s) && (isSms(s.moduleSpecifier)
        || (!s.moduleSpecifier && !!s.exportClause && ts.isNamedExports(s.exportClause)
          && s.exportClause.elements.some((e) => smsNames.has((e.propertyName ?? e.name).text)))))
      || (ts.isExportAssignment(s) && ts.isIdentifier(s.expression) && smsNames.has(s.expression.text))
      || (ts.isVariableStatement(s) && !!s.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
        && s.declarationList.declarations.some((d) => !!d.initializer && ts.isIdentifier(d.initializer) && smsNames.has(d.initializer.text))))
      .map((s) => s.getText(sf));
    expect([...smsNames]).toEqual(expect.arrayContaining(["getSmsProvider", "SmsProviderError"]));
    expect(leaks).toEqual([]);
  });
});

describe("scan 2: every SMS kind handed to the gate is in the registry", () => {
  // Any quoted string that starts like a kind, in any quote, digits and all
  // (review R3-I4: `[a-z_]+` could not see "operator.alert_sms_v2", and a
  // kind held in a constant has no `kind:` in front of it).
  const KIND_LITERAL = /["'`]((?:automation|voice|staff|operator|consent)\.[^"'`]+)["'`]/g;
  // A gate caller imports the gate or the automations' send-sms by ANY path:
  // resolved, not spelled (review of 884220c2: `../../../../lib/consent/gate`
  // from a route slipped past a regex of four spellings).
  const GATE_MODULES = new Set(["apps/web/src/lib/consent/gate", "apps/web/src/lib/automations/send-sms"]);
  const isGateCaller = (f: string, src?: string) => importsOf(f, src).some((m) => GATE_MODULES.has(m));

  function kindLiterals(): { file: string; kind: string }[] {
    return webSources().filter((f) => isGateCaller(f))
      .flatMap((f) => [...code(f).matchAll(KIND_LITERAL)].map((m) => ({ file: rel(f), kind: m[1]! })));
  }

  it("a gate caller is found by its resolved import, whatever the path spells (mutation: match the four spelled specifiers again → FAILS)", () => {
    const at = (...p: string[]) => join(WEB_SRC, ...p);
    expect(isGateCaller(at("app", "api", "sms", "inbound", "route.ts"), `import { decideSms } from "../../../../lib/consent/gate";`)).toBe(true);
    expect(isGateCaller(at("lib", "automations", "passes", "probe.ts"), `import { sendAutomationSms } from "../send-sms.ts";`)).toBe(true);
    expect(isGateCaller(at("app", "probe.ts"), `const g = await import("@/lib/automations/send-sms");`)).toBe(true);
    expect(isGateCaller(at("lib", "consent", "probe.ts"), `import type { SmsRequest } from "./gate";`)).toBe(true);
    expect(isGateCaller(at("lib", "consent", "probe.ts"), `import { fakeSmsGate } from "./fake-gate";`)).toBe(false);
  });

  it("each kind literal in a file that sends through the gate is a registry key (mutation: a pass sends kind \"automation.review_requests\" → FAILS naming it)", () => {
    expect(kindLiterals().filter(({ kind }) => !(kind in SMS_KINDS))).toEqual([]);
  });

  it("the scan reaches every send path's kind — none of the eleven is missing (the positive control)", () => {
    const seen = new Set(kindLiterals().map(({ kind }) => kind));
    expect([...seen].sort()).toEqual(Object.keys(SMS_KINDS).sort());
  });
});

describe("scan 3: the ledger has one writer, and it only appends", () => {
  // The table's name as a string literal, anywhere in code (review R3-M1):
  // `.from("consent_events" as never)` and a name held in a constant both count.
  const TOUCHES_LEDGER = /["'`]consent_events["'`]/;

  it("only packages/db/src/consent.ts names the consent_events table in code (mutation: an insert from apps/web → FAILS naming the file)", () => {
    const touching = [...webSources(), ...dbSources()].filter((f) => TOUCHES_LEDGER.test(code(f))).map(rel);
    expect(touching).toEqual(["packages/db/src/consent.ts"]);
  });

  it("consent.ts never inserts, updates, upserts or deletes directly: every write is the one guarded function (0055; mutation: add .insert( or .update( to a consent_events call → FAILS)", () => {
    const src = code(join(DB_SRC, "consent.ts"));
    expect(src.match(/\.from\(/g)?.length).toBeGreaterThanOrEqual(4);   // the four reads: the scan sees them
    expect(src).toMatch(/\.rpc\(WRITE_FUNCTION,/);                      // and the one write
    expect(src.match(/\.(?:insert|update|upsert|delete)\s*\(/g) ?? []).toEqual([]);
  });

  it("only packages/db/src/consent.ts names the ledger's write function, as any string literal (mutation: an rpc(\"append_consent_event\") from apps/web → FAILS naming the file)", () => {
    const naming = [...webSources(), ...dbSources()].filter((f) => /["'`]append_consent_event["'`]/.test(code(f))).map(rel);
    expect(naming).toEqual(["packages/db/src/consent.ts"]);
  });

  it("0055, which defines the function, inserts into the ledger and never updates, deletes or truncates it (the insert is the positive control; mutation: add an update of consent_events → FAILS)", () => {
    const sql = readFileSync(join(REPO, "packages", "db", "supabase", "migrations", "0055_consent_writes.sql"), "utf-8").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/insert into public\.consent_events/);
    expect(sql).not.toMatch(/update\s+public\.consent_events|delete\s+from\s+public\.consent_events|truncate/i);
  });
});

describe("scan 5: nothing reads the retired quiet-hours settings", () => {
  const QUIET = /\bquiet_(enabled|start|end)\b|\bautomation_settings\b|\breadQuietSettings\b|\bsaveQuietSettings\b/;

  it("no source file names automation_settings or its quiet_* columns (mutation: bring readQuietSettings back → FAILS naming it; the list holding gate.ts and consent.ts is the positive control: an empty file list FAILS)", () => {
    const quietFiles = [...webSources(), ...dbSources()];
    expect(quietFiles.map(rel)).toEqual(expect.arrayContaining(["apps/web/src/lib/consent/gate.ts", "packages/db/src/consent.ts"]));
    expect(quietFiles.filter((f) => QUIET.test(code(f))).map(rel)).toEqual([]);
  });

  it("the scan can see the column name where it still exists: the migrations (the positive control)", () => {
    const migration = readFileSync(join(REPO, "packages", "db", "supabase", "migrations", "0046_automation_log.sql"), "utf-8");
    expect(migration).toMatch(QUIET);
  });
});

describe("F-009: toE164 is gone, and the fake gate stays in the tests", () => {
  const FAKE_GATE = "apps/web/src/lib/consent/fake-gate";

  it("no source file defines or calls toE164 (mutation: re-add it to phone-number.ts → FAILS; the list holding phone-number.ts, where it lived, and a definition the check does see are the positive controls: an empty file list FAILS)", () => {
    const e164Files = webSources();
    expect(e164Files.map(rel)).toContain("apps/web/src/lib/voice/phone-number.ts");
    expect(code("probe.ts", "export const toE164 = e164Of;")).toMatch(/\btoE164\b/);
    expect(e164Files.filter((f) => /\btoE164\b/.test(code(f))).map(rel)).toEqual([]);
  });

  it("only test files import lib/consent/fake-gate, by ANY path: @/lib/consent/fake-gate, ./fake-gate, ../consent/fake-gate (mutation: a pass imports it as ../../consent/fake-gate → FAILS naming it)", () => {
    const importers = walk(WEB_SRC).filter((f) => importsOf(f).includes(FAKE_GATE));
    expect(importers.length).toBeGreaterThan(0);   // the tests do: the scan resolves what it reads
    expect(importers.filter((f) => !isTest(f)).map(rel)).toEqual([]);
  });

  it("the import resolver sees the fake gate by every relative spelling, and nothing else (the positive control; mutation: match only the @/ alias → FAILS)", () => {
    const at = (...p: string[]) => join(WEB_SRC, ...p);
    expect(importsOf(at("lib", "automations", "passes", "probe.ts"), `import { fakeSmsGate } from "../../consent/fake-gate";`)).toEqual([FAKE_GATE]);
    expect(importsOf(at("lib", "automations", "probe.ts"), `export { fakeSmsGate } from "../consent/fake-gate.ts";`)).toEqual([FAKE_GATE]);
    expect(importsOf(at("lib", "consent", "probe.ts"), `import { fakeSmsGate } from "./fake-gate";`)).toEqual([FAKE_GATE]);
    expect(importsOf(at("app", "api", "probe.ts"), `const { fakeSmsGate } = await import("@/lib/consent/fake-gate");`)).toEqual([FAKE_GATE]);
    expect(importsOf(at("lib", "automations", "probe.ts"), `import { sendSms } from "../consent/gate";`)).toEqual(["apps/web/src/lib/consent/gate"]);
    expect(importsOf(at("lib", "billing", "probe.ts"), `import { FakeGateway } from "./fake-gateway";`)).not.toContain(FAKE_GATE);
  });
});

describe("the carrier bypass: only the text-back and the consent reply set numberFromCarrier", () => {
  it("no production file but the gate (which declares and carries it), lib/voice/textback.ts and lib/consent/replies.ts names numberFromCarrier, and the gate never sets it true itself (mutation: the composer sends numberFromCarrier: true → FAILS naming it; the list holding textback.ts is the positive control)", () => {
    const naming = webSources().filter((f) => /\bnumberFromCarrier\b/.test(code(f))).map(rel).sort();
    expect(naming).toEqual(["apps/web/src/lib/consent/gate.ts", "apps/web/src/lib/consent/replies.ts", "apps/web/src/lib/voice/textback.ts"]);
    expect(code(join(WEB_SRC, "lib", "voice", "textback.ts"))).toMatch(/\bnumberFromCarrier\s*:\s*true\b/);
    expect(code(join(WEB_SRC, "lib", "consent", "replies.ts"))).toMatch(/\bnumberFromCarrier\s*:\s*true\b/);
    expect(code(join(WEB_SRC, "lib", "consent", "gate.ts"))).not.toMatch(/\b(?:numberFromCarrier|fromCarrier)\s*[:=]\s*true\b/);
  });

  it("the gate's carrier line is pinned, so only an explicit true skips the stored flag (mutation: req.numberFromCarrier !== false → FAILS)", () => {
    expect(code(GATE_FILE)).toContain("const fromCarrier = req.numberFromCarrier === true;");
  });
});

/**
 * F-009's write rule (review R2-C1, Task 7): a contact write gets the number
 * AS TYPED or AS SAID, because `phoneFields` (packages/db) stores its E.164
 * AND flags ten digits that could be Mexican or US; a pre-normalised "+1…"
 * reads as confirmed and the gate would text it. A normaliser's NUMBER is
 * `e164Of(…)`, `toE164(…)`, `spokenPhone(…)` or `normalisePhone(…).e164`; a
 * bare `normalisePhone(…)` is a READING (its `.unconfirmed`, its truthiness)
 * and only its `.e164` is a number.
 *
 * What counts as "handed to a write": a normaliser's number in the INPUT
 * argument of `createContact`, `updateContact`, `fillContactBlanks` or
 * `applyImportBatch` (by position, from their signatures in packages/db:
 * the account id beside it is a lookup key, not the contact's phone),
 * directly or through a local of the same file that carries one
 * (`const p = e164Of(raw)`, `const n = normalisePhone(raw)` then `n.e164`,
 * `patch[key] = e164Of(v)` then `{ ...patch }`). A local that holds one but
 * never reaches a write is fine: the form path's `phoneE164` dials the
 * instant reply while the write gets `rawPhone`. BUILDERS hand a write its
 * input from another module, where the write's arguments cannot show the
 * number's origin, so in a builder ANY normaliser number counts.
 */
const WRITES = /(?<!function\s+)\b(createContact|updateContact|fillContactBlanks|applyImportBatch)\s*\(/g;
/** The index of each write's contact input (contacts.ts, contact-import.ts). */
const INPUT_ARG: Record<string, number> = { createContact: 2, updateContact: 3, fillContactBlanks: 3, applyImportBatch: 2 };
/** `repickPhoneCountry(…, "US")` is exactly the old `toE164`; `extractCallerNumber` reads a carrier event's caller. */
const NORMALISER_NAMES = ["e164Of", "toE164", "spokenPhone", "normalisePhone", "repickPhoneCountry", "extractCallerNumber"];
const NORMALISER = new RegExp(`\\b(${NORMALISER_NAMES.join("|")})\\s*\\(`, "g");
/** `name = rhs;` (declared, reassigned, destructured, or a member of `name`). */
const ASSIGNMENT = /(?<![\w$.])(\{[^{}]*\}|[A-Za-z_$][\w$]*)((?:\s*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]\n]*\]))*)\s*(?::[^=;{}]+?)?=(?![=>])([^;]*);/g;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[$]/g, "\\$&");
/** String literals' contents blanked, same length, so indices still line up
 *  and a `"phone"` or a `")"` inside quotes is not code. */
const blankStrings = (s: string) =>
  s.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, (q) => q[0] + " ".repeat(q.length - 2) + q[0]);

/** The text between the parenthesis at `open` and its partner, or null. */
function inParens(src: string, open: number): string | null {
  const blank = blankStrings(src);
  let depth = 0;
  for (let i = open; i < blank.length; i++) {
    if (blank[i] === "(") depth++;
    else if (blank[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

/** A call's arguments, split at its top-level commas. */
function splitArgs(args: string): string[] {
  const blank = blankStrings(args);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < blank.length; i++) {
    const c = blank[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(args.slice(start, i)); start = i + 1; }
  }
  out.push(args.slice(start));
  return out;
}

/** The normaliser calls in `text`, as numbers or readings (see above). */
function normaliserCalls(text: string): { numbers: string[]; readings: string[] } {
  const numbers: string[] = [];
  const readings: string[] = [];
  for (const m of text.matchAll(NORMALISER)) {
    const open = m.index! + m[0].length - 1;
    const args = inParens(text, open);
    if (args === null) continue;
    const call = squash(`${m[1]}(${args})`);
    const isReading = m[1] === "normalisePhone" && !/^\s*[?!]?\.\s*e164\b/.test(text.slice(open + args.length + 2));
    (isReading ? readings : numbers).push(call);
  }
  return { numbers, readings };
}

/** `name` used as a VALUE in `text`: not a member (`x.name`), not a key (`{ name: … }`); a spread counts. */
function usesValue(text: string, name: string): boolean {
  const blank = blankStrings(text);
  for (const m of blank.matchAll(new RegExp(`(?<![\\w$])(?<![^.]\\.)${escapeRe(name)}(?![\\w$])`, "g"))) {
    const isKey = /[{,]\s*$/.test(blank.slice(0, m.index)) && /^\s*:(?!:)/.test(blank.slice(m.index! + name.length));
    if (!isKey) return true;
  }
  return false;
}
const usesE164Of = (text: string, name: string) =>
  new RegExp(`(?<![\\w$])(?<![^.]\\.)${escapeRe(name)}\\s*[?!]?\\.\\s*e164\\b`).test(blankStrings(text));

type Carried = Map<string, Set<string>>;
/** The normaliser calls whose NUMBER `text` carries: its own, a local that holds one, a reading's `.e164`. */
function numbersIn(text: string, numbers: Carried, readings: Carried): string[] {
  const out = new Set(normaliserCalls(text).numbers);
  for (const [name, from] of numbers) if (usesValue(text, name)) from.forEach((c) => out.add(c));
  for (const [name, from] of readings) if (usesE164Of(text, name)) from.forEach((c) => out.add(c));
  return [...out];
}

function carry(map: Carried, name: string, calls: Iterable<string>): boolean {
  const set = map.get(name) ?? new Set<string>();
  const before = set.size;
  for (const c of calls) set.add(c);
  map.set(name, set);
  return set.size > before;
}

/** Every normaliser call whose NUMBER reaches a contact write in `src`. */
function normalisedIntoWrites(src: string, builder: boolean): string[] {
  const hits = new Set<string>(builder ? normaliserCalls(src).numbers : []);
  const writes = [...src.matchAll(WRITES)].flatMap((m) => {
    const args = inParens(src, m.index! + m[0].length - 1);
    const input = args === null ? undefined : splitArgs(args)[INPUT_ARG[m[1]!]!];
    return input === undefined ? [] : [input];
  });
  if (writes.length === 0) return [...hits].sort();
  const { numbers, readings } = carriedLocals(src);
  for (const args of writes) numbersIn(args, numbers, readings).forEach((c) => hits.add(c));
  return [...hits].sort();
}

/** The locals of `src` that carry a normaliser's number, or a reading. */
function carriedLocals(src: string): { numbers: Carried; readings: Carried } {
  const numbers: Carried = new Map();
  const readings: Carried = new Map();
  const assignments = [...src.matchAll(ASSIGNMENT)].map((m) => ({
    names: m[1]!.startsWith("{")
      ? m[1]!.slice(1, -1).replace(/[\w$]+\s*:/g, "").split(",")
        .map((n) => n.replace(/=[\s\S]*$/, "").replace(/^\s*\.\.\./, "").trim())
        .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
      : [m[1]!],
    rhs: m[3]!,
  }));
  for (let changed = true; changed;) {
    changed = false;
    for (const { names, rhs } of assignments) {
      const carried = numbersIn(rhs, numbers, readings);
      const read = [...normaliserCalls(rhs).readings];
      for (const [name, from] of readings) if (usesValue(rhs, name) && !usesE164Of(rhs, name)) read.push(...from);
      for (const n of names) {
        if (carry(numbers, n, carried)) changed = true;
        if (carry(readings, n, read)) changed = true;
      }
    }
  }
  return { numbers, readings };
}

/** A renamed import reads as its own name (`import { e164Of as toNumber }`:
 *  every `toNumber` is `e164Of`), so a rename cannot hide a normaliser. */
function dealias(src: string): string {
  let out = src;
  for (const m of src.matchAll(new RegExp(`\\b(${NORMALISER_NAMES.join("|")})\\s+as\\s+([A-Za-z_$][\\w$]*)`, "g"))) {
    out = out.replace(new RegExp(`(?<![\\w$.])${escapeRe(m[2]!)}(?![\\w$])`, "g"), m[1]!);
  }
  return out;
}

/** An object key `phone` (quoted or not; after `{` or `,`, so a ternary's `? phone :` is not one). */
const PHONE_KEY = /(?<![\w$.])(?:(["'])phone\1|phone)\s*:(?!:)/g;
/** A `phone` binding or member being given a value: `const phone =`, `phone =`,
 *  `input.phone =`, `input["phone"] =` (a type annotation allowed; not `==`, not `=>`). */
const PHONE_BINDING = /(?:(?<![\w$])phone|\[\s*(["'])phone\1\s*\])\s*(?::[^=;{}()]+?)?=(?![=>])/g;

/** The value that starts at `from`: up to the first top-level `,` or `;`, or the bracket that closes around it. */
function valueAt(src: string, blank: string, from: number): string {
  let depth = 0;
  for (let i = from; i < blank.length; i++) {
    const c = blank[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth < 0) return src.slice(from, i);
    else if ((c === "," || c === ";") && depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

/** Every normaliser call whose NUMBER is put under a `phone` key or into a `phone`
 *  binding in `src`, directly or through a local of the same file, whatever
 *  happens to it next: a helper's return, a builder's output, a typed local,
 *  `Object.assign`. Which write it reaches, if any, does not matter. */
function normalisedPhones(src: string): string[] {
  const blank = blankStrings(src);
  const values: { at: number; value: string }[] = [];
  for (const m of src.matchAll(PHONE_KEY)) {
    const i = m.index!;
    if (blank[i] !== src[i] || !/[{,]\s*$/.test(blank.slice(0, i))) continue;   // inside a string, or not a key
    values.push({ at: i, value: valueAt(src, blank, i + m[0].length) });
  }
  for (const m of src.matchAll(PHONE_BINDING)) {
    if (blank[m.index!] !== src[m.index!]) continue;                               // inside a string
    values.push({ at: m.index!, value: valueAt(src, blank, m.index! + m[0].length) });
  }
  // A local carries a number into a value only if it was assigned BEFORE it:
  // locals are followed by name, and a later function's `normalized` is not
  // an earlier one's.
  return [...new Set(values.flatMap(({ at, value }) => {
    const { numbers, readings } = carriedLocals(src.slice(0, at));
    return numbersIn(value, numbers, readings);
  }))].sort();
}

describe("F-009: every contact write gets the number as typed or as said", () => {
  /** Modules that build a contact write's input for a caller in ANOTHER file. */
  const BUILDERS = new Set([
    "apps/web/src/lib/contacts/csv.ts",         // mapRows → the CSV import's applyImportBatch rows
    "apps/web/src/lib/contacts/field-input.ts", // normalizeFieldInput → the inline edit's updateContact value
    "apps/web/src/lib/proposals/generate.ts",   // a call's proposed phone → the call page's accept (fillContactBlanks)
    "apps/web/src/lib/concierge/lead.ts",       // the concierge's lead → the form path's createContact (lib/forms/enrich.ts)
  ]);
  /** The numbers a write may take from a normaliser, one reason each: a
   *  carrier's number says its own country, and `spokenPhone` gives back the
   *  words as said (a model-added leading 1 dropped) or the caller ID. */
  const ALLOWED: Record<string, string> = {
    "apps/web/src/app/api/sms/inbound/route.ts: e164Of(payload?.from?.phone_number ?? null)":
      "the inbound text's sender, a carrier number (reaches createContact through its local, fromNumber)",
    "apps/web/src/lib/voice/finish-call.ts: spokenPhone(fields.callbackNumber, ctx.callerNumber)":
      "the lead's callback number as the caller said it, or the carrier's caller ID",
    "apps/web/src/lib/voice/tools/registry.ts: spokenPhone(String(args?.phone ?? \"\"), ctx.callerNumber)":
      "book_appointment's number as the caller said it, or the carrier's caller ID (through its local, phone)",
    "apps/web/src/lib/proposals/generate.ts: spokenPhone(value, null)":
      "a transcribed number stored as said; the accept's fillContactBlanks judges it",
    "apps/web/src/lib/concierge/lead.ts: spokenPhone(lead.phone, null)":
      "a model-written number as said, which the form path's createContact judges",
  };
  /** Allowed under a `phone` key or binding ONLY, never into a contact write:
   *  each goes to setContactPhoneCountry, which writes the flag beside it. The
   *  same number handed to createContact or updateContact loses its flag. */
  const PHONE_KEY_ONLY: Record<string, string> = {
    "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts: repickPhoneCountry(contact.phone, country)":
      "the drawer's country pick: staff chose the country explicitly, and the flag is written alongside (setContactPhoneCountry, unconfirmed: false)",
    "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts: normalisePhone(previous.phone)":
      "the country pick's Undo restores the prior number with the reading's own flag written alongside (setContactPhoneCountry)",
    "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts: normalisePhone(undo.priorPhone)":
      "the inline phone edit's Undo restores the prior number with the reading's own flag written alongside (setContactPhoneCountry)",
  };
  /** A file's code as the phone rules read it: comments gone, renamed normalisers under their own names. */
  const scanned = (f: string) => dealias(code(f));
  const intoWrites = () => [...webSources(), ...dbSources()].flatMap((f) =>
    normalisedIntoWrites(scanned(f), BUILDERS.has(rel(f))).map((c) => `${rel(f)}: ${c}`));
  /** packages/db is not in it: phoneFields IS the one place a number is normalised for a write. */
  const intoPhones = () => webSources().flatMap((f) => normalisedPhones(scanned(f)).map((c) => `${rel(f)}: ${c}`));

  it("no production file hands a contact write a normaliser's number, directly, through a local, or from a builder, beyond the allow-listed carrier and spoken numbers (mutation: the booking page writes phone: e164Of(phone), or the country pick's Undo writes through updateContact → FAILS naming it)", () => {
    expect(intoWrites().filter((h) => !(h in ALLOWED))).toEqual([]);
  });

  it("no production file under apps/web/src puts a normaliser's number under a phone key or into a phone binding, whatever the write, beyond the allow-list (review of 884220c2; mutation: a same-file helper returns { phone: e164Of(raw) } → FAILS naming it)", () => {
    expect(intoPhones().filter((h) => !(h in ALLOWED) && !(h in PHONE_KEY_ONLY))).toEqual([]);
  });

  it("every allow-listed number is still found where it is named: the scan follows a local to the write (the positive control; mutation: the inbound route writes the raw sender → its entry goes stale and FAILS)", () => {
    const hits = new Set([...intoWrites(), ...intoPhones()]);
    expect(Object.keys(ALLOWED).filter((h) => !hits.has(h))).toEqual([]);
    const phoneHits = new Set(intoPhones());
    expect(Object.keys(PHONE_KEY_ONLY).filter((h) => !phoneHits.has(h))).toEqual([]);
  });

  it("each BUILDERS path exists, so a renamed builder cannot drop out of the scan unseen (mutation: point a BUILDERS entry at a missing path → FAILS naming it)", () => {
    expect([...BUILDERS].filter((b) => !existsSync(join(REPO, b)))).toEqual([]);
  });

  it("repickPhoneCountry (with \"US\" it is exactly the old toE164) and extractCallerNumber are normalisers too (mutation: drop either from NORMALISER → FAILS)", () => {
    expect(normalisedIntoWrites(`await createContact(db, a, { phone: repickPhoneCountry(raw, "US") }, u);`, false)).toEqual([`repickPhoneCountry(raw, "US")`]);
    expect(normalisedIntoWrites(`const from = extractCallerNumber(event.data);\nawait createContact(db, a, { phone: from }, u);`, false)).toEqual(["extractCallerNumber(event.data)"]);
  });

  it("the phone rule catches a same-file helper, a cross-file builder, a typed local, a renamed import, Object.assign, a quoted key and a local, and passes a number as typed (the positive control; mutation: read only unquoted `phone:` keys → FAILS)", () => {
    const phones = (src: string) => normalisedPhones(dealias(src));
    expect(phones(`function toInput(raw: string) {\n  return { name: "x", phone: e164Of(raw) };\n}`)).toEqual(["e164Of(raw)"]);
    expect(phones(`export function buildInput(row: Row): ContactInput {\n  const input: ContactInput = {};\n  input.phone = normalisePhone(row.phone)?.e164 ?? row.phone;\n  return input;\n}`)).toEqual(["normalisePhone(row.phone)"]);
    expect(phones(`const input: { phone?: string } = { phone: e164Of(raw) ?? undefined };`)).toEqual(["e164Of(raw)"]);
    expect(phones(`import { e164Of as toNumber } from "@/lib/voice/phone-number";\nconst input = { phone: toNumber(raw) };`)).toEqual(["e164Of(raw)"]);
    expect(phones(`Object.assign(input, { phone: spokenPhone(said, null) });`)).toEqual(["spokenPhone(said, null)"]);
    expect(phones(`const row = { "phone": extractCallerNumber(data) };\nrow["phone"] = e164Of(other);`)).toEqual(["e164Of(other)", "extractCallerNumber(data)"]);
    expect(phones(`const p = repickPhoneCountry(raw, "US");\nconst input = { ...rest, phone: p };`)).toEqual([`repickPhoneCountry(raw, "US")`]);
    // As typed: a normaliser under another key, a reading, a ternary, a string.
    expect(phones(`const input = { phone: raw, e164: e164Of(raw) };`)).toEqual([]);
    expect(phones(`const n = normalisePhone(raw);\nconst input = { phone: raw, unconfirmed: n?.unconfirmed === true };`)).toEqual([]);
    expect(phones(`const shown = typed ? phone : e164Of(other);`)).toEqual([]);
    expect(phones(`const label = "phone: e164Of(raw)";`)).toEqual([]);
  });

  it("the scan catches phone: e164Of(raw) and each indirect shape in a fixture, and passes a number as typed (the positive control; mutation: read only the write's own arguments → FAILS)", () => {
    expect(normalisedIntoWrites(`await createContact(db, a, { phone: e164Of(raw) }, u);`, false)).toEqual(["e164Of(raw)"]);
    expect(normalisedIntoWrites(`const p: string | null = e164Of(raw) ?? raw;\nawait updateContact(db, a, c, { phone: p }, u);`, false)).toEqual(["e164Of(raw)"]);
    expect(normalisedIntoWrites(`const n = normalisePhone(raw);\nawait fillContactBlanks(db, a, c, { phone: n?.e164 }, u);`, false)).toEqual(["normalisePhone(raw)"]);
    expect(normalisedIntoWrites(`const patch: Record<string, string> = {};\npatch[key] = toE164(v);\nawait updateContact(db, a, c, { ...patch }, u);`, false)).toEqual(["toE164(v)"]);
    expect(normalisedIntoWrites(`await applyImportBatch(db, a, rows.map((r) => ({ input: { ...r, phone: spokenPhone(r.phone, null) } })), i, u, o);`, false)).toEqual(["spokenPhone(r.phone, null)"]);
    expect(normalisedIntoWrites(`if (key) input[key] = normalisePhone(value)?.e164 ?? value;`, true)).toEqual(["normalisePhone(value)"]);
    // As typed: a normalised local that never reaches the write, and a reading.
    expect(normalisedIntoWrites(`const phoneE164 = e164Of(raw);\nawait createContact(db, a, { phone: raw || undefined }, u);\nawait text(phoneE164);`, false)).toEqual([]);
    expect(normalisedIntoWrites(`const n = normalisePhone(raw);\nif (!n?.unconfirmed) await createContact(db, a, { phone: raw }, u);`, false)).toEqual([]);
    // A carrier number used as a LOOKUP key beside the input is not the contact's phone.
    expect(normalisedIntoWrites(`const accountId = await accountFor(e164Of(to));\nawait createContact(db, accountId, { phone: val("phone") }, u);`, false)).toEqual([]);
    expect(normalisedIntoWrites(`if (!normalisePhone(value)) continue;\nif (key) input[key] = value;`, true)).toEqual([]);
  });
});
