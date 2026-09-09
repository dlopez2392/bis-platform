import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

describe("contacts list", () => {
  it("reads the cursor through the shared parser, never by hand", () => {
    expect(page).toContain("parseCursor");
    expect(page).not.toMatch(/before\?\.split\(/);
  });
  it("asks for one more row than it shows, to know whether an older page exists", () => {
    expect(page).toContain("PAGE_SIZE + 1");
  });
  it("counts with the same search the list uses", () => {
    expect(page).toMatch(/countContacts\(db, accountId, \{ search: q \}\)/);
  });
  it("offers import and export", () => {
    expect(page).toContain('m["contacts.import"]');
    expect(page).toContain('m["contacts.export"]');
  });
});
