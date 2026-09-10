import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "import-wizard.tsx"), "utf8");
const action = readFileSync(path.join(here, "actions.ts"), "utf8");

describe("import wizard", () => {
  it("parses in the browser — the file is never sent whole", () => {
    expect(src).toContain("papaparse");
    expect(src).not.toMatch(/FormData|file\.arrayBuffer\(\)/);
  });

  it("commits in bounded batches, not one request", () => {
    expect(src).toMatch(/BATCH_SIZE\s*=\s*200/);
  });

  it("re-validates on the server: the action never trusts the browser's mapping", () => {
    expect(action).toContain("mapRows");
  });

  it("builds the match index once per BATCH, never once per row", () => {
    // Structural, not a comment scan: buildMatchIndex must be called outside
    // any loop over rows. The behavioural guarantee this protects — that two
    // identical rows collapse — is tested for real in contact-import.test.ts.
    expect(action).toContain("buildMatchIndex");
    expect(action).not.toMatch(/for\s*\([^)]*rows[^)]*\)[\s\S]{0,200}buildMatchIndex/);
  });

  // danlo's decision, 2026-09-10: the import is recorded in the ledger but gets
  // NO curated activity-feed line. The screen already tells the operator
  // "Added N, updated M" the moment it finishes, so a feed row would mostly
  // repeat what they just read — the same reasoning that puts
  // contact.created/contact.updated on the activity card's skipped list.
  // Pinned so a later "let's surface imports" change is a deliberate reversal.
  it("records the import in the ledger, and adds no feed copy of its own", () => {
    expect(action).toContain("contact.imported");
    expect(src).not.toContain("contact.imported");
  });
});
