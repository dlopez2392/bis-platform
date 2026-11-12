import { describe, expect, it } from "vitest";
import { sidebarAccountBase } from "./account-route";

describe("sidebarAccountBase", () => {
  it("uses the account in the URL for everyone", () => {
    expect(sidebarAccountBase("/dashboard/accounts/a1/calls", true, undefined)).toBe("/dashboard/accounts/a1");
    expect(sidebarAccountBase("/dashboard/accounts/a1/calls", false, "b2")).toBe("/dashboard/accounts/a1");
  });

  it("keeps a client's own business off an account's routes", () => {
    expect(sidebarAccountBase("/dashboard/preferences", false, "b2")).toBe("/dashboard/accounts/b2");
  });

  it("gives the agency its top-level scope off an account's routes", () => {
    expect(sidebarAccountBase("/dashboard/preferences", true, "b2")).toBeNull();
    expect(sidebarAccountBase("/dashboard", true, undefined)).toBeNull();
  });

  it("is null for a client whose business did not resolve", () => {
    expect(sidebarAccountBase("/dashboard/preferences", false, undefined)).toBeNull();
  });
});
