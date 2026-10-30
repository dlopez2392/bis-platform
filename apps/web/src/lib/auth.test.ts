import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const getAccountByOrgId = vi.fn();
const ensureAccountRole = vi.fn();
const readStoredRole = vi.fn();
// M7a PR-4 (plan G11): the read-only guard reads the request's headers and the billing standing.
const readBillingStanding = vi.fn();
// F-118 part 1 (spec 3.1): the agency branch reads its live visit.
const agencyVisitLive = vi.fn();
const requestHeaders = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(requestHeaders.value) }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({ service: true }),
  getAccountByOrgId: (...a: unknown[]) => getAccountByOrgId(...a),
  readBillingStanding: (...a: unknown[]) => readBillingStanding(...a),
  agencyVisitLive: (...a: unknown[]) => agencyVisitLive(...a),
}));
vi.mock("./team/ensure-role", () => ({
  ensureAccountRole: (...a: unknown[]) => ensureAccountRole(...a),
  readStoredRole: (...a: unknown[]) => readStoredRole(...a),
}));

import {
  apiAccountAccess, apiAccountAccessWithRole, requireAccountAccess, requireAccountOwner, requireAgencyOnlyAccountAccess, requireNotTechnician, accountHome,
  seesWholeAccount,
} from "./auth";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const IN_FLIGHT = Promise.resolve("in-flight" as const);

function asAgency() {
  authMock.mockResolvedValue({ userId: "user_agency", sessionId: "sess_1", sessionClaims: { app_role: "agency_admin", org_id: "org_agency" } });
}
function asClient(role: "owner" | "staff" | "technician" | null) {
  authMock.mockResolvedValue({ userId: "user_client", sessionId: "sess_c", sessionClaims: { org_id: "org_client" } });
  getAccountByOrgId.mockResolvedValue({ id: OWN, client_access_enabled: true });
  ensureAccountRole.mockResolvedValue(role);
}

beforeEach(() => {
  authMock.mockReset(); getAccountByOrgId.mockReset(); ensureAccountRole.mockReset(); readStoredRole.mockReset();
  readStoredRole.mockReturnValue(IN_FLIGHT);
  readBillingStanding.mockReset();
  agencyVisitLive.mockReset();
  agencyVisitLive.mockResolvedValue("visit_1");
  requestHeaders.value = {};
  vi.unstubAllEnvs();
});

describe("requireAccountAccess carries the caller's role (spec §7)", () => {
  it("agency: no client role, may manage, and never enters the fallback or the stored read (mutation: call either for the agency -> FAILS)", async () => {
    asAgency();
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_agency", isAgency: true, role: null, canManage: true });
    expect(ensureAccountRole).not.toHaveBeenCalled();
    expect(readStoredRole).not.toHaveBeenCalled();
  });
  it("client Owner may manage, and never reads a visit (F-118 mutation: read the visit before the branch -> FAILS)", async () => {
    asClient("owner");
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_client", isAgency: false, role: "owner", canManage: true });
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
  it("client Staff may not manage, and never reads a visit (mutation: canManage = role !== null -> FAILS)", async () => {
    asClient("staff");
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_client", isAgency: false, role: "staff", canManage: false });
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
  it("asks the fallback about the account it judged, the session's org and user, handing over the read already in flight (mutation: swap args, or drop the in-flight read -> FAILS)", async () => {
    asClient("staff");
    await requireAccountAccess(OWN);
    expect(ensureAccountRole).toHaveBeenCalledWith(OWN, "org_client", "user_client", IN_FLIGHT);
  });
  it("starts the stored-role read BESIDE the account read, keyed on the requested id (mutation: start it after getAccountByOrgId resolves -> FAILS)", async () => {
    asClient("owner");
    let release!: (v: unknown) => void;
    getAccountByOrgId.mockReturnValue(new Promise((res) => { release = res; }));
    const p = requireAccountAccess(OWN);
    await vi.waitFor(() => expect(getAccountByOrgId).toHaveBeenCalled());
    expect(readStoredRole).toHaveBeenCalledWith(OWN, "user_client");
    release({ id: OWN, client_access_enabled: true });
    await p;
  });
  it("a client asking for another account is still sent to their own, with no Clerk call or write before the redirect (mutation: settle the role first -> FAILS)", async () => {
    asClient("owner");
    await expect(requireAccountAccess(OTHER)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/dashboard`);
    expect(ensureAccountRole).not.toHaveBeenCalled();
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
  it("client access off still redirects to /no-access?reason=off, before any Clerk call or write", async () => {
    asClient("owner");
    getAccountByOrgId.mockResolvedValue({ id: OWN, client_access_enabled: false });
    await expect(requireAccountAccess(OWN)).rejects.toThrow("REDIRECT:/no-access?reason=off");
    expect(ensureAccountRole).not.toHaveBeenCalled();
  });
});

describe("requireAccountOwner (spec §7)", () => {
  it("admits the agency", async () => {
    asAgency();
    expect(await requireAccountOwner(OWN)).toEqual({ userId: "user_agency", isAgency: true });
  });
  it("admits a client Owner", async () => {
    asClient("owner");
    expect(await requireAccountOwner(OWN)).toEqual({ userId: "user_client", isAgency: false });
  });
  it("sends Staff to their own dashboard (mutation: return instead of redirect -> FAILS)", async () => {
    asClient("staff");
    await expect(requireAccountOwner(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/dashboard`);
  });
  it("sends a client whose role could not be settled (Clerk down) the same way (mutation: role !== \"staff\" instead of role === \"owner\" -> FAILS)", async () => {
    asClient(null);
    await expect(requireAccountOwner(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/dashboard`);
  });
});

// F-085 part 1 (spec §7.1, §9): a Technician's home inside an account is To
// do, and the surfaces they do not work on send them there, never a 403.
describe("accountHome (spec §9)", () => {
  it("is To do for a Technician and the dashboard for everyone else (mutation: always dashboard -> FAILS)", () => {
    expect(accountHome("a1", "technician")).toBe("/dashboard/accounts/a1/tasks");
    expect(accountHome("a1", "staff")).toBe("/dashboard/accounts/a1/dashboard");
    expect(accountHome("a1", "owner")).toBe("/dashboard/accounts/a1/dashboard");
    expect(accountHome("a1", null)).toBe("/dashboard/accounts/a1/dashboard");
  });
});

// F-085 part 1: the one fail-closed rule for "sees and manages the whole
// account": the agency, an Owner, Staff. A Technician and a client whose
// role could not be settled (null) do not, everywhere this is asked.
describe("seesWholeAccount", () => {
  it.each([
    [true, null], [false, "owner"], [false, "staff"],
  ] as const)("isAgency=%s role=%s sees the whole account", (isAgency, role) => {
    expect(seesWholeAccount({ isAgency, role })).toBe(true);
  });
  it.each([
    [false, "technician"], [false, null],
  ] as const)("isAgency=%s role=%s does not (mutation: role !== technician -> the null case FAILS)", (isAgency, role) => {
    expect(seesWholeAccount({ isAgency, role })).toBe(false);
  });
});

describe("requireNotTechnician (spec §7.1)", () => {
  it("sends a Technician to To do, not the dashboard (mutation: redirect to …/dashboard -> FAILS)", async () => {
    asClient("technician");
    await expect(requireNotTechnician(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/tasks`);
  });
  // Fix round 1 (review M6): fails closed like the database. A client whose
  // role could not be settled (Clerk down, no membership yet) is admitted
  // only where a Technician is, and sent to To do, never to the dashboard,
  // which would refuse them again (To do never calls this guard: the
  // loop guard in technician-guards.test.ts).
  it("sends a client whose role could not be settled (null) to To do too, never the dashboard (mutation: admit null, or send it to accountHome(null) -> FAILS)", async () => {
    asClient(null);
    await expect(requireNotTechnician(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/tasks`);
  });
  it.each(["owner", "staff"] as const)("passes a client whose role is %s through with exactly what requireAccountAccess returns (mutation: refuse Staff too -> FAILS)", async (role) => {
    asClient(role);
    const expected = await requireAccountAccess(OWN);
    expect(expected).toMatchObject({ userId: "user_client", isAgency: false, role });
    expect(await requireNotTechnician(OWN)).toEqual(expected);
  });
  it("passes the agency through", async () => {
    asAgency();
    expect(await requireNotTechnician(OWN)).toEqual({ userId: "user_agency", isAgency: true, role: null, canManage: true });
  });
  it("a client asking for another account is still sent to their own first (requireAccountAccess runs before the role check)", async () => {
    asClient("technician");
    await expect(requireNotTechnician(OTHER)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/dashboard`);
  });
});

describe("the Owner-only and agency-only guards send a Technician to To do (spec §7.1, redirect loops)", () => {
  it("requireAccountOwner (mutation: keep the literal …/dashboard -> FAILS)", async () => {
    asClient("technician");
    await expect(requireAccountOwner(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/tasks`);
  });
  it("requireAgencyOnlyAccountAccess (mutation: keep the literal …/dashboard -> FAILS)", async () => {
    asClient("technician");
    await expect(requireAgencyOnlyAccountAccess(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/tasks`);
  });
  it("requireAgencyOnlyAccountAccess still sends Staff to the dashboard", async () => {
    asClient("staff");
    await expect(requireAgencyOnlyAccountAccess(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/dashboard`);
  });
});

// M7a PR-4 (plan G11): "dashboard read-only". With the switch on, a CLIENT's server action (the request
// carries next-action) on a paused account is sent back to the page it came from; the agency never is.
describe("a paused account is read-only for a client's server actions (plan G11)", () => {
  const PAUSED = {
    complimentary: false, pausedAt: "2026-10-20T08:00:00.000Z", subscriptionStatus: "past_due",
    features: { voice_receptionist: true, web_concierge: true },
  };
  const FROM = `/dashboard/accounts/${OWN}/contacts?q=ana`;
  function pausedAction() {
    vi.stubEnv("BILLING_ENFORCE", "1");
    readBillingStanding.mockResolvedValue(PAUSED);
    requestHeaders.value = { "next-action": "7f00", referer: `https://app.example${FROM}` };
  }

  it("a client's server action on a paused account is redirected, the agency's is not (mutation: refuse the agency too → FAILS)", async () => {
    pausedAction();
    asClient("owner");
    await expect(requireAccountAccess(OWN)).rejects.toThrow(`REDIRECT:${FROM}`);
    asAgency();
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_agency", isAgency: true, role: null, canManage: true });
  });

  it("with no usable referer a client is sent to their own home: To do for a Technician (mutation: fall back to the literal dashboard → FAILS)", async () => {
    pausedAction();
    requestHeaders.value = { "next-action": "7f00" };
    asClient("technician");
    await expect(requireAccountAccess(OWN)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/tasks`);
  });

  it("a page render (no next-action) and an unpaused account are untouched (mutation: drop the header check → FAILS)", async () => {
    pausedAction();
    requestHeaders.value = { referer: `https://app.example${FROM}` };
    asClient("staff");
    expect(await requireAccountAccess(OWN)).toMatchObject({ isAgency: false, role: "staff" });
    requestHeaders.value = { "next-action": "7f00" };
    readBillingStanding.mockResolvedValue({ ...PAUSED, pausedAt: null });
    expect(await requireAccountAccess(OWN)).toMatchObject({ isAgency: false, role: "staff" });
  });

  it("`duringPause: 'allow'` skips the refusal (mutation: ignore the option → FAILS)", async () => {
    pausedAction();
    asClient("owner");
    expect(await requireAccountAccess(OWN, { duringPause: "allow" })).toEqual({ userId: "user_client", isAgency: false, role: "owner", canManage: true });
  });

  it("requireAccountOwner and requireNotTechnician pass the option through (mutation: drop it in requireAccountOwner → FAILS)", async () => {
    pausedAction();
    asClient("owner");
    expect(await requireAccountOwner(OWN, { duringPause: "allow" })).toEqual({ userId: "user_client", isAgency: false });
    await expect(requireAccountOwner(OWN)).rejects.toThrow(`REDIRECT:${FROM}`);
    asClient("staff");
    expect(await requireNotTechnician(OWN, { duringPause: "allow" })).toMatchObject({ isAgency: false, role: "staff" });
    await expect(requireNotTechnician(OWN)).rejects.toThrow(`REDIRECT:${FROM}`);
  });

  it("the refusal comes after the account checks: a client asking for another account still goes to their own dashboard, unread (mutation: refuse before the account read → FAILS)", async () => {
    pausedAction();
    asClient("owner");
    await expect(requireAccountAccess(OTHER)).rejects.toThrow(`REDIRECT:/dashboard/accounts/${OWN}/dashboard`);
    expect(readBillingStanding).not.toHaveBeenCalled();
  });

  it("a failed billing read allows the action (fails open), and the switch off never reads (mutation: treat a read error as paused → FAILS)", async () => {
    pausedAction();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    readBillingStanding.mockRejectedValue(new Error("billing: standing read failed: down"));
    asClient("owner");
    expect(await requireAccountAccess(OWN)).toMatchObject({ isAgency: false, role: "owner" });
    err.mockRestore();
    vi.stubEnv("BILLING_ENFORCE", "");
    readBillingStanding.mockReset();
    expect(await requireAccountAccess(OWN)).toMatchObject({ isAgency: false, role: "owner" });
    expect(readBillingStanding).not.toHaveBeenCalled();
  });
});

// F-118 part 1 (spec 3.1, 2.4): the agency enters an account only on a live visit, chosen with a reason, and no
// session signed in AS someone else (Clerk's act claim, `actor` on auth()) enters at all.
describe("the reason gate in the agency branch (F-118 part 1, spec 3.1)", () => {
  it("with a live visit the agency gets exactly today's value, the visit read for this account, person and session", async () => {
    asAgency();
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_agency", isAgency: true, role: null, canManage: true });
    expect(agencyVisitLive).toHaveBeenCalledWith({ service: true }, OWN, { clerkUserId: "user_agency", sessionId: "sess_1" });
  });

  it("with no visit the agency is sent to the chooser carrying the path it asked for (mutation: return for the agency before the visit check -> FAILS)", async () => {
    asAgency();
    agencyVisitLive.mockResolvedValue(null);
    requestHeaders.value = { "x-bis-path": `/dashboard/accounts/${OWN}/contacts` };
    await expect(requireAccountAccess(OWN)).rejects.toThrow(
      `REDIRECT:/dashboard/enter/${OWN}?to=%2Fdashboard%2Faccounts%2F${OWN}%2Fcontacts`);
  });

  it("the guards built on it inherit the gate", async () => {
    asAgency();
    agencyVisitLive.mockResolvedValue(null);
    await expect(requireAccountOwner(OWN)).rejects.toThrow(`REDIRECT:/dashboard/enter/${OWN}`);
    await expect(requireNotTechnician(OWN)).rejects.toThrow(`REDIRECT:/dashboard/enter/${OWN}`);
    await expect(requireAgencyOnlyAccountAccess(OWN)).rejects.toThrow(`REDIRECT:/dashboard/enter/${OWN}`);
  });

  it("{ agencyVisit: \"not-required\" } reads no visit and returns the agency value (the work list's carve-out, C11)", async () => {
    asAgency();
    agencyVisitLive.mockResolvedValue(null);
    expect(await requireAccountAccess(OWN, { agencyVisit: "not-required" })).toEqual({ userId: "user_agency", isAgency: true, role: null, canManage: true });
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });

  it("a failed visit read rejects with that error (owner ruling 4: fail closed)", async () => {
    asAgency();
    const boom = new Error("agencyVisitLive failed: down");
    agencyVisitLive.mockRejectedValue(boom);
    await expect(requireAccountAccess(OWN)).rejects.toBe(boom);
  });

  it("a non-UUID account id is a 404 for the agency, with no read (plan C12)", async () => {
    asAgency();
    await expect(requireAccountAccess("foo")).rejects.toThrow("NOT_FOUND");
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });

  it("apiAccountAccess: the agency with a visit gets its value, without one null, and a non-UUID id null with no read", async () => {
    asAgency();
    expect(await apiAccountAccess(OWN)).toEqual({ userId: "user_agency", isAgency: true });
    expect(agencyVisitLive).toHaveBeenCalledWith({ service: true }, OWN, { clerkUserId: "user_agency", sessionId: "sess_1" });
    agencyVisitLive.mockResolvedValue(null);
    expect(await apiAccountAccess(OWN)).toBeNull();
    agencyVisitLive.mockClear();
    expect(await apiAccountAccess("foo")).toBeNull();
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });

  it("apiAccountAccess: a failed visit read rejects, never null-as-allowed or null-as-refused", async () => {
    asAgency();
    agencyVisitLive.mockRejectedValue(new Error("down"));
    await expect(apiAccountAccess(OWN)).rejects.toThrow("down");
  });

  it("apiAccountAccess: a client never reads a visit", async () => {
    asClient("owner");
    expect(await apiAccountAccess(OWN)).toEqual({ userId: "user_client", isAgency: false });
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
});

describe("a session signed in as someone else is refused (owner ruling 5, spec 2.4)", () => {
  const ACTOR = { sub: "user_staff" };
  it("a client session carrying actor goes to /no-access?reason=none before the account read (mutation: drop the actor check -> FAILS)", async () => {
    asClient("owner");
    authMock.mockResolvedValue({ userId: "user_client", sessionId: "sess_c", sessionClaims: { org_id: "org_client" }, actor: ACTOR });
    await expect(requireAccountAccess(OWN)).rejects.toThrow("REDIRECT:/no-access?reason=none");
    expect(getAccountByOrgId).not.toHaveBeenCalled();
  });
  it("an agency session carrying actor goes there too, with no visit read (mutation: drop the actor check -> FAILS)", async () => {
    authMock.mockResolvedValue({ userId: "user_agency", sessionId: "sess_1", sessionClaims: { app_role: "agency_admin" }, actor: ACTOR });
    await expect(requireAccountAccess(OWN)).rejects.toThrow("REDIRECT:/no-access?reason=none");
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
  it("apiAccountAccess answers null for both (mutation: drop the actor check -> FAILS)", async () => {
    asClient("owner");
    authMock.mockResolvedValue({ userId: "user_client", sessionId: "sess_c", sessionClaims: { org_id: "org_client" }, actor: ACTOR });
    expect(await apiAccountAccess(OWN)).toBeNull();
    authMock.mockResolvedValue({ userId: "user_agency", sessionId: "sess_1", sessionClaims: { app_role: "agency_admin" }, actor: ACTOR });
    expect(await apiAccountAccess(OWN)).toBeNull();
    expect(getAccountByOrgId).not.toHaveBeenCalled();
    expect(agencyVisitLive).not.toHaveBeenCalled();
  });
});

/**
 * The shell's own read (the agency refresh loop after the reason chooser, 2026-10-30): the shell's badges
 * read through a plain GET route, which needs the caller's role (a Technician's narrow shell) but must
 * never redirect. Same admission as apiAccountAccess, plus the role a client's server action would get.
 */
describe("apiAccountAccessWithRole: apiAccountAccess plus the role, never a redirect", () => {
  it("the agency with a live visit: isAgency, role null", async () => {
    asAgency();
    expect(await apiAccountAccessWithRole(OWN)).toEqual({ userId: "user_agency", isAgency: true, role: null });
  });

  it("the agency with NO live visit is null, never a redirect to the chooser (mutation: call requireAgencyVisit -> FAILS)", async () => {
    asAgency();
    agencyVisitLive.mockResolvedValue(null);
    requestHeaders.value = { "x-bis-path": `/dashboard/accounts/${OWN}/setup` };
    expect(await apiAccountAccessWithRole(OWN)).toBeNull();
  });

  it("a client in their own account gets the settled role; a Technician stays a Technician", async () => {
    asClient("technician");
    expect(await apiAccountAccessWithRole(OWN)).toEqual({ userId: "user_client", isAgency: false, role: "technician" });
    expect(ensureAccountRole).toHaveBeenCalledWith(OWN, "org_client", "user_client", IN_FLIGHT);
  });

  it("a client asking for another account is null, never redirected to their own, and settles no role", async () => {
    asClient("owner");
    expect(await apiAccountAccessWithRole(OTHER)).toBeNull();
    expect(ensureAccountRole).not.toHaveBeenCalled();
  });

  it("a client with access switched off, or no org, is null", async () => {
    asClient("owner");
    getAccountByOrgId.mockResolvedValue({ id: OWN, client_access_enabled: false });
    expect(await apiAccountAccessWithRole(OWN)).toBeNull();
    authMock.mockResolvedValue({ userId: "user_client", sessionId: "sess_c", sessionClaims: {} });
    expect(await apiAccountAccessWithRole(OWN)).toBeNull();
  });

  it("signed out, or signed in as someone else, is null", async () => {
    authMock.mockResolvedValue({ userId: null, sessionId: null, sessionClaims: null });
    expect(await apiAccountAccessWithRole(OWN)).toBeNull();
    authMock.mockResolvedValue({ userId: "user_agency", sessionId: "sess_1", sessionClaims: { app_role: "agency_admin" }, actor: { sub: "user_x" } });
    expect(await apiAccountAccessWithRole(OWN)).toBeNull();
  });

  // Hotfix review: fails closed when the visit lookup itself fails — it must REJECT, never resolve to
  // "allowed" (mutation: wrap the agency branch's read in `agencyVisitOk(...).catch(() => true)` -> FAILS,
  // since that mutation would resolve to `{ isAgency: true, role: null }` instead of rejecting).
  it("the agency's visit read failing rejects the call, never a fallback access grant", async () => {
    asAgency();
    const boom = new Error("agencyVisitLive failed: down");
    agencyVisitLive.mockRejectedValue(boom);
    await expect(apiAccountAccessWithRole(OWN)).rejects.toBe(boom);
  });
});
