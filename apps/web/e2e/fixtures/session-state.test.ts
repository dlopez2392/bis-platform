import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SESSION_TOKEN_COOKIE, withoutSessionTokens } from "./session-state";

/**
 * The saved sign-in state must not carry Clerk's 60-second session token
 * (see session-state.ts for the CI trace that made this a rule). Playwright
 * cannot run from `pnpm check`, so both halves are pinned here: the filter
 * itself, and that auth.setup.ts really saves BOTH identities through it —
 * proven by running its two registered setup tests against fakes and reading
 * what they wrote, not by reading its source.
 *
 * Mutations (each reds the named case, each reverted byte-identical):
 *  - return `state` unfiltered from withoutSessionTokens → "drops the plain
 *    and the suffixed session token" and both "auth.setup.ts" cases;
 *  - put back `await page.context().storageState({ path: AUTH_FILE })` in the
 *    agency setup test → "saves the agency state without a session token";
 *    the same for CLIENT_AUTH_FILE → "saves the client state …";
 *  - delete the `tokens.length === 0` throw → "refuses a state with no
 *    session token";
 *  - delete the client_uat check → the two "refuses … __client_uat" cases,
 *    "reads __client_uat the way the middleware does" and "never repeats a
 *    cookie value in what it throws";
 *  - compare the raw string (`c.value !== "0"`) instead of parsing it →
 *    "reads __client_uat the way the middleware does".
 */

// Fake cookie values only. Nothing here is, or resembles, a real token.
const cookie = (name: string, value = "UNIT_TEST_ONLY") => ({
  name, value, domain: "localhost", path: "/", expires: -1,
  httpOnly: false, secure: false, sameSite: "Lax" as const,
});
const signedInState = () => ({
  cookies: [
    cookie("__session"), cookie("__session_5lB98H6L"),
    cookie("__client_uat", "1790351700"), cookie("__client_uat_5lB98H6L", "1790351700"),
    cookie("__clerk_db_jwt"), cookie("__clerk_db_jwt_5lB98H6L"),
    cookie("bis-theme", "dark"),
  ],
  origins: [{ origin: "http://localhost:3000", localStorage: [{ name: "k", value: "v" }] }],
});
const names = (s: { cookies: { name: string }[] }) => s.cookies.map((c) => c.name);

describe("withoutSessionTokens", () => {
  it("drops the plain and the suffixed session token, and nothing else", () => {
    const before = signedInState();
    const after = withoutSessionTokens(before);
    expect(names(after)).toEqual([
      "__client_uat", "__client_uat_5lB98H6L", "__clerk_db_jwt", "__clerk_db_jwt_5lB98H6L", "bis-theme",
    ]);
    expect(after.origins).toEqual(before.origins);
    // The input is not mutated; tenant-theme.spec.ts reads the file itself.
    expect(names(before)).toContain("__session");
  });

  it("matches only whole cookie names", () => {
    expect(SESSION_TOKEN_COOKIE.test("__session")).toBe(true);
    expect(SESSION_TOKEN_COOKIE.test("__session_5lB98H6L")).toBe(true);
    expect(SESSION_TOKEN_COOKIE.test("__sessionx")).toBe(false);
    expect(SESSION_TOKEN_COOKIE.test("x__session")).toBe(false);
    expect(SESSION_TOKEN_COOKIE.test("__client_uat")).toBe(false);
  });

  it("refuses a state with no session token (sign-in never finished, or Clerk renamed it)", () => {
    const state = signedInState();
    state.cookies = state.cookies.filter((c) => !c.name.startsWith("__session"));
    expect(() => withoutSessionTokens(state)).toThrow(/no Clerk __session cookie/);
  });

  it("refuses a state with no __client_uat, which would turn 'refresh me' into 'signed out'", () => {
    const state = signedInState();
    state.cookies = state.cookies.filter((c) => !c.name.startsWith("__client_uat"));
    expect(() => withoutSessionTokens(state)).toThrow(/no non-zero Clerk __client_uat/);
  });

  it("refuses a state whose __client_uat is 0 (Clerk's signed-out value)", () => {
    const state = signedInState();
    state.cookies = state.cookies.map((c) => (c.name.startsWith("__client_uat") ? { ...c, value: "0" } : c));
    expect(() => withoutSessionTokens(state)).toThrow(/no non-zero Clerk __client_uat/);
  });

  it("reads __client_uat the way the middleware does: a value that parses to nothing is 0", () => {
    const state = signedInState();
    state.cookies = state.cookies.map((c) => (c.name.startsWith("__client_uat") ? { ...c, value: "" } : c));
    expect(() => withoutSessionTokens(state)).toThrow(/no non-zero Clerk __client_uat/);
  });

  it("never repeats a cookie value in what it throws", () => {
    const state = signedInState();
    state.cookies = state.cookies.filter((c) => !c.name.startsWith("__client_uat"));
    let message = "";
    try { withoutSessionTokens(state); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/__client_uat/);
    expect(message).not.toContain("UNIT_TEST_ONLY");
  });
});

// --- auth.setup.ts, run against fakes ------------------------------------

const written = vi.hoisted(() => ({ files: {} as Record<string, string> }));
const registered = vi.hoisted(() => ({
  tests: [] as { title: string; fn: (args: { page: unknown }) => Promise<void> }[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    mkdirSync: vi.fn(),
    writeFileSync: (p: string, data: string) => { written.files[p] = String(data); },
  };
});
vi.mock("dotenv", async (importOriginal) => {
  const real = await importOriginal<typeof import("dotenv")>();
  return { ...real, config: vi.fn() };
});
vi.mock("@playwright/test", () => ({
  test: (title: string, fn: (args: { page: unknown }) => Promise<void>) => { registered.tests.push({ title, fn }); },
}));
vi.mock("@clerk/testing/playwright", () => ({ clerk: { signIn: vi.fn() }, clerkSetup: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { createUser: async () => ({ id: "user_UNIT", publicMetadata: {} }) },
    organizations: { createOrganization: async () => ({ id: "org_UNIT" }) },
  }),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  createAccount: async () => ({ id: "acc_UNIT" }),
  setClientAccess: vi.fn(), createContact: vi.fn(), setBranding: vi.fn(),
  uploadBrandLogo: async () => "acc_UNIT/logo.png",
  createForm: async () => ({ id: "form_UNIT", publicId: "pub_UNIT" }),
  updateForm: vi.fn(),
}));
vi.mock("./sweep", () => ({
  sweepStaleFixtures: async () => ({
    accounts: [], clerkUsers: [], clerkOrgs: [], orphanObjects: [], strandedForms: [], strandedBlueprints: [],
  }),
  formatSweepReport: vi.fn(),
}));

/** A page that is already where each setup test waits to be, whose context saves `signedInState()`. */
function fakePage() {
  const storageStateCalls: unknown[] = [];
  const context = {
    storageState: async (opts?: unknown) => { storageStateCalls.push(opts); return signedInState(); },
  };
  const page = {
    goto: vi.fn(), waitForURL: vi.fn(), waitForLoadState: vi.fn(), evaluate: vi.fn(),
    url: () => "http://localhost:3000/dashboard/accounts",
    getByRole: () => ({ click: vi.fn() }),
    context: () => context,
  };
  return { page, storageStateCalls };
}

async function runSetup(title: RegExp) {
  vi.resetModules();
  registered.tests = [];
  await import("../auth.setup");
  const t = registered.tests.find((x) => title.test(x.title));
  if (!t) throw new Error(`auth.setup.ts registered no test matching ${title}`);
  const { page, storageStateCalls } = fakePage();
  await t.fn({ page });
  return { storageStateCalls };
}

describe("auth.setup.ts", () => {
  beforeEach(() => {
    written.files = {};
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://odnobiodsftffphuuosz.supabase.invalid");
    vi.stubEnv("SUPABASE_DB_URL", undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("saves the agency state without a session token", async () => {
    const { storageStateCalls } = await runSetup(/agency_admin/);
    expect(storageStateCalls.filter(Boolean), "storageState({ path }) would save the token").toEqual([]);
    const saved = JSON.parse(written.files["e2e/.auth/state.json"] ?? "null") as { cookies: { name: string }[] } | null;
    expect(saved, "the agency state was never written").not.toBeNull();
    expect(names(saved!)).not.toContain("__session");
    expect(names(saved!)).not.toContain("__session_5lB98H6L");
    expect(names(saved!)).toContain("__client_uat_5lB98H6L");
  });

  it("saves the client state without a session token", async () => {
    const { storageStateCalls } = await runSetup(/client user/);
    expect(storageStateCalls.filter(Boolean), "storageState({ path }) would save the token").toEqual([]);
    const saved = JSON.parse(written.files["e2e/.auth/client-state.json"] ?? "null") as { cookies: { name: string }[] } | null;
    expect(saved, "the client state was never written").not.toBeNull();
    expect(names(saved!)).not.toContain("__session");
    expect(names(saved!)).not.toContain("__session_5lB98H6L");
    expect(names(saved!)).toContain("__client_uat_5lB98H6L");
    // The fixture record is still written alongside it.
    expect(written.files["e2e/.auth/client-fixture.json"]).toContain("acc_UNIT");
  });
});
