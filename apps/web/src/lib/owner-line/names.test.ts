import { describe, it, expect } from "vitest";
import { firstName } from "./names";

// F-032 plan, Task 7 Step 4 (apps/web/src/lib/owner-line/names.ts). Created ahead of Task 7 here because Task 8's
// lockout.ts (this same plan) imports firstName and Task 7 has not landed in this worktree yet — see Task 8's
// report for the deviation note.
describe("firstName", () => {
  it("takes the first word of a stored name, trimming extra whitespace", () => {
    expect(firstName("  Dan   Lopez ")).toBe("Dan");
  });
  it("is null for no name or a blank one", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("   ")).toBeNull();
  });
});
