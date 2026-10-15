import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Spec 3.3, "every file waits" BY CONSTRUCTION: a signed READ URL for a stored file is minted in ONE
 * place, signedDocumentReadUrl, which refuses unless the version is clean; the scanner's own URL in
 * one other, signedScannerUrl, called only by the scan procedure. This scan of the source fails the
 * moment a third mint appears (the PR 1a action minted its own, documents-actions.ts:312 before 2a).
 * Test files and e2e specs are not scanned: they may sign URLs to check storage.
 *
 * This walks the real AST (the "typescript" package) rather than matching the raw text with a regex: a
 * regex, even one that first strips line and block comments, is blinded by an ordinary string, template
 * or regex literal that merely CONTAINS a comment-opening sequence before a real mint on the same file.
 * documents-card.tsx and styleguide/page.tsx both carry such a literal today, and a comment-stripping
 * regex misreads it as opening a block comment that then swallows everything up to the next closer,
 * including a real call in between (see the walker's own tests below for the exact shapes). The AST
 * walker visits only real nodes: a prose mention of the mint's name inside a comment never becomes a
 * node at all (comments are trivia, not part of the tree), so it is never counted, while a call, a
 * destructured binding, or a bracket-string access anywhere in real code always is, however it is split
 * across lines or boxed in by adjacent literals.
 * Accepted residual: a MINT NAME BUILT AT RUNTIME, e.g. two string halves joined at runtime, has no
 * single Identifier or StringLiteralLike node whose own text is the whole name, and is not caught here;
 * nothing in this codebase does that, and a reviewer reading a diff would still see both halves naming
 * the method, which is a weaker but real deterrent on its own.
 */
const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const TREES = ["apps/web/src", "packages/db/src"];
/** The only "test" directory this scan skips: @bis/db's own test helpers, read by other suites, not app code. */
const SKIP_TEST_DIR = "packages/db/src/test";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules") return [];
      const rel = relative(ROOT, path).split("\\").join("/");
      if (rel === SKIP_TEST_DIR) return [];
      return sources(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const files = TREES.flatMap((t) => sources(join(ROOT, t))).map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), text: readFileSync(p, "utf8") }));

/**
 * Every Identifier, PrivateIdentifier (`#name`) and string-literal-like node (a plain string, a bracket
 * key, or a template literal with no substitution) whose OWN text matches `re`, anywhere in the real
 * syntax tree. Comments are never visited: the parser discards them as trivia before the tree exists, so
 * a prose mention can never satisfy this, by construction rather than by a stripping step that could miss
 * one shape.
 */
function countMatchesInTree(sf: ts.SourceFile, re: RegExp): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node)) {
      if (re.test(node.text)) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}
/** Ad hoc text (the walker's own tests below): parses once, on the spot — these snippets are tiny. */
function countMatches(text: string, re: RegExp, scriptKind: ts.ScriptKind): number {
  return countMatchesInTree(ts.createSourceFile("source.tsx", text, ts.ScriptTarget.Latest, true, scriptKind), re);
}
const kindOf = (rel: string): ts.ScriptKind => (rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
/** `createSignedUrl`, a call to the batch form `createSignedUrls`, or either name reached by a bracket string or a destructured binding. */
const MINT_RE = /^createSignedUrls?$/;
const SCANNER_RE = /^signedScannerUrl$/;
/**
 * The whole tree, parsed EXACTLY ONCE at module scope (M2 fix, final review): re-parsing every file on
 * every `hits()` call made each test that walks the real tree reparse ~780 files, close to vitest's 5 s
 * default on this machine and over it on a slower one. The AST is shared; only the (cheap) walk repeats.
 */
const parsed = files.map((f) => ({ rel: f.rel, sf: ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, true, kindOf(f.rel)) }));
/** Every real occurrence of `re` across the whole tree, as that file's path once per hit (order: TREES, then file order within each). */
const hits = (re: RegExp): string[] => parsed.flatMap((f) => Array.from({ length: countMatchesInTree(f.sf, re) }, () => f.rel));

describe("the read gate (spec 3.3)", () => {
  it("scans a real tree (positive control: it finds documents.ts and this module's own sibling)", () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["packages/db/src/documents.ts", "apps/web/src/lib/documents/scan-version.ts"]));
  }, 30_000);

  it("storage's signed-URL methods are named in exactly two places, both in documents.ts: a call, a createSignedUrls batch call or a destructured name all count (plan review 9; mutations: mint in documents-actions.ts again -> FAILS; `const { createSignedUrl } = svc.storage.from(b)` anywhere -> FAILS)", () => {
    expect(hits(MINT_RE)).toEqual(["packages/db/src/documents.ts", "packages/db/src/documents.ts"]);
  }, 30_000);

  it("the scanner's URL is asked for only by the scan procedure (mutation: call signedScannerUrl from an action or a route -> FAILS)", () => {
    const users = parsed.filter((f) => countMatchesInTree(f.sf, SCANNER_RE) > 0 && !f.rel.startsWith("packages/db/src/"));
    expect(users.map((f) => f.rel)).toEqual(["apps/web/src/lib/documents/scan-version.ts"]);
  }, 30_000);
});

describe("the walker itself (I1 follow-up): a real mint is never blinded by an adjacent literal", () => {
  const MINT = 'svc.storage.from(b).createSignedUrl(p, 1)';

  it("a mint after a \"https://x\" string literal on the same line is still counted", () => {
    expect(countMatches(`const u = "https://x"; ${MINT};`, MINT_RE, ts.ScriptKind.TS)).toBe(1);
  });

  it('a mint after a "docs/*" string, with a REAL /** */ comment afterward, is still counted (a naive block-comment stripper opens on the "/*" inside the string and swallows the mint before it ever reaches the real comment)', () => {
    expect(countMatches(`const t = "docs/*"; ${MINT}; /** note */`, MINT_RE, ts.ScriptKind.TS)).toBe(1);
  });

  it("a mint after a template literal containing // is still counted (a naive line-comment stripper treats the template's own // as starting a comment and erases the rest of the line)", () => {
    expect(countMatches(`const u = \`https://x\`; ${MINT};`, MINT_RE, ts.ScriptKind.TS)).toBe(1);
  });

  it("a mint after a regex literal containing // is still counted", () => {
    expect(countMatches(`const re = /\\/\\//; ${MINT};`, MINT_RE, ts.ScriptKind.TS)).toBe(1);
  });

  it("the card shape: accept=\"image/*\" on an <input>, a mint in an onClick, a later JSX comment — today's documents-card.tsx:335/361 and styleguide/page.tsx:271 shape", () => {
    const tsx = `
      function Card() {
        return (
          <div>
            <input type="file" accept="image/*" onClick={() => { ${MINT}; }} />
            {/* a trailing JSX comment, same as styleguide/page.tsx:271 */}
          </div>
        );
      }
    `;
    expect(countMatches(tsx, MINT_RE, ts.ScriptKind.TSX)).toBe(1);
  });

  it("a bracket-string mint is counted (the destructuring mutation's cousin)", () => {
    expect(countMatches('svc.storage.from(b)["createSignedUrl"](p, 1);', MINT_RE, ts.ScriptKind.TS)).toBe(1);
  });

  it("a destructured binding is counted even with no call in sight", () => {
    expect(countMatches("const { createSignedUrl } = svc.storage.from(b);", MINT_RE, ts.ScriptKind.TS)).toBeGreaterThan(0);
  });

  it("a mint split across several lines is counted", () => {
    expect(countMatches("svc.storage\n  .from(b)\n  .createSignedUrl(\n    p,\n    1,\n  );", MINT_RE, ts.ScriptKind.TS)).toBe(1);
  });

  it("the batch form, createSignedUrls, is counted by the same pattern", () => {
    expect(countMatches("svc.storage.from(b).createSignedUrls([p]);", MINT_RE, ts.ScriptKind.TS)).toBe(1);
  });

  it("a prose mention inside a comment is NOT counted: comments are trivia, never nodes (positive control for the walker's own premise)", () => {
    expect(countMatches("// Supabase's own createSignedUrl refuses a non-existent object\nconst x = 1;", MINT_RE, ts.ScriptKind.TS)).toBe(0);
    expect(countMatches("/** createSignedUrl is mentioned here only in prose */\nconst x = 1;", MINT_RE, ts.ScriptKind.TS)).toBe(0);
  });
});
