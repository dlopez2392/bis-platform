import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * auth.teardown.ts, run against fakes: what it asks Clerk to delete for the
 * per-run agency identity. Playwright cannot run from `pnpm check`, so the
 * teardown's two registered tests are collected here and called directly.
 *
 * Since 2026-10-08 (review I-1) the agency user is the sole member of an org
 * of its own instead of a member of the seeded org, so teardown has two
 * things to delete for it. Deleting the user leaves its org behind with no
 * members (Clerk keeps an org whose last member is gone), and the sweep would
 * only find it half an hour later.
 *
 * Mutation: drop the deleteOrganization call from the agency teardown →
 * "deletes the agency's own org and then the user" FAILS.
 */

const files = vi.hoisted(() => ({ contents: {} as Record<string, string> }));
const registered = vi.hoisted(() => ({
  tests: [] as { title: string; fn: () => Promise<void> }[],
}));
const deleted = vi.hoisted(() => ({ orgs: [] as string[], users: [] as string[] }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    existsSync: (p: string) => p in files.contents,
    readFileSync: (p: string) => {
      const c = files.contents[p];
      if (c === undefined) throw new Error(`unit test: no fake file ${p}`);
      return c;
    },
  };
});
vi.mock("dotenv", async (importOriginal) => {
  const real = await importOriginal<typeof import("dotenv")>();
  return { ...real, config: vi.fn() };
});
vi.mock("@playwright/test", () => ({
  test: (title: string, fn: () => Promise<void>) => { registered.tests.push({ title, fn }); },
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: { deleteOrganization: async (id: string) => { deleted.orgs.push(id); } },
    users: { deleteUser: async (id: string) => { deleted.users.push(id); } },
  }),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), setClientAccess: vi.fn(), removeBrandLogo: vi.fn(),
}));
vi.mock("./sweep", () => ({
  deleteAccountCascade: vi.fn(),
  emptySweepReport: () => ({ errors: [] }),
}));

async function runTeardown(title: RegExp) {
  vi.resetModules();
  registered.tests = [];
  await import("../auth.teardown");
  const t = registered.tests.find((x) => title.test(x.title));
  if (!t) throw new Error(`auth.teardown.ts registered no test matching ${title}`);
  await t.fn();
}

describe("auth.teardown.ts: the per-run agency identity", () => {
  beforeEach(() => {
    files.contents = {};
    deleted.orgs = [];
    deleted.users = [];
  });

  it("deletes the agency's own org and then the user", async () => {
    files.contents["e2e/.auth/agency-fixture.json"] = JSON.stringify({
      clerkUserId: "user_AGENCY_UNIT", email: "e2e-agency-1786412389258@example.com",
      clerkOrgId: "org_AGENCY_UNIT",
    });
    await runTeardown(/agency/);
    expect(deleted.orgs).toEqual(["org_AGENCY_UNIT"]);
    expect(deleted.users).toEqual(["user_AGENCY_UNIT"]);
  });

  // A fixture file written before the org existed (setup died between
  // createUser and createOrganization) still has its user deleted.
  it("still deletes the user when the record holds no org", async () => {
    files.contents["e2e/.auth/agency-fixture.json"] = JSON.stringify({
      clerkUserId: "user_AGENCY_UNIT", email: "e2e-agency-1786412389258@example.com",
    });
    await runTeardown(/agency/);
    expect(deleted.orgs).toEqual([]);
    expect(deleted.users).toEqual(["user_AGENCY_UNIT"]);
  });
});
