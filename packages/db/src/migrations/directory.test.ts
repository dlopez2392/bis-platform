import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkMigrationDirectory } from "./names";

// The repository's own migrations directory obeys the naming rules
// (./names.ts): exactly the 116 numbered files, no new numbered file, every
// other name a 14-digit UTC timestamp no more than a day ahead, one file per
// version. This is what refuses a branch that adds `0117_*.sql`, in verify.

const DIR = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));

describe("packages/db/supabase/migrations", () => {
  it("names every migration by the rules: 0001..0116 frozen, everything newer timestamped", () => {
    expect(checkMigrationDirectory(readdirSync(DIR), new Date())).toEqual([]);
  });
});
