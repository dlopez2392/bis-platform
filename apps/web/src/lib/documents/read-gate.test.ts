import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spec 3.3, "every file waits" BY CONSTRUCTION: a signed READ URL for a stored file is minted in ONE
 * place, signedDocumentReadUrl, which refuses unless the version is clean; the scanner's own URL in
 * one other, signedScannerUrl, called only by the scan procedure. This scan of the source fails the
 * moment a third mint appears (the PR 1a action minted its own, documents-actions.ts:312 before 2a).
 * Test files and e2e specs are not scanned: they may sign URLs to check storage.
 */
const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const TREES = ["apps/web/src", "packages/db/src"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "test" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const files = TREES.flatMap((t) => sources(join(ROOT, t))).map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), text: readFileSync(p, "utf8") }));

describe("the read gate (spec 3.3)", () => {
  it("scans a real tree (positive control: it finds documents.ts and this module's own sibling)", () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["packages/db/src/documents.ts", "apps/web/src/lib/documents/scan-version.ts"]));
  });

  it("storage's signed-URL methods are named in exactly two places, both in documents.ts: a call, a createSignedUrls batch call or a destructured name all count (plan review 9; mutations: mint in documents-actions.ts again -> FAILS; `const { createSignedUrl } = svc.storage.from(b)` anywhere -> FAILS)", () => {
    // Prose in a comment ("Supabase's own createSignedUrl refuses…", scan-version.ts, Task 5, already
    // committed) names the function without calling it; stripped here so only code constructs count.
    const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hits = files.flatMap((f) => (stripComments(f.text).match(/\bcreateSignedUrls?\b/g) ?? []).map(() => f.rel));
    expect(hits).toEqual(["packages/db/src/documents.ts", "packages/db/src/documents.ts"]);
  });

  it("the scanner's URL is asked for only by the scan procedure (mutation: call signedScannerUrl from an action or a route -> FAILS)", () => {
    const users = files.filter((f) => f.text.includes("signedScannerUrl") && !f.rel.startsWith("packages/db/src/"));
    expect(users.map((f) => f.rel)).toEqual(["apps/web/src/lib/documents/scan-version.ts"]);
  });
});
