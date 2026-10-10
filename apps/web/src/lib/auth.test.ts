import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const getAccountByOrgId = vi.fn();
const ensureAccountRole = vi.fn();
const readStoredRole = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({ service: true }),
  getAccountByOrgId: (...a: unknown[]) => getAccountByOrgId(...a),
}));
vi.mock("./team/ensure-role", () => ({
  ensureAccountRole: (...a: unknown[]) => ensureAccountRole(...a),
  readStoredRole: (...a: unknown[]) => readStoredRole(...a),
}));

import { requireAccountAccess, requireAccountOwner } from "./auth";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const IN_FLIGHT = Promise.resolve("in-flight" as const);

function asAgency() {
  authMock.mockResolvedValue({ userId: "user_agency", sessionClaims: { app_role: "agency_admin", org_id: "org_agency" } });
}
function asClient(role: "owner" | "staff" | null) {
  authMock.mockResolvedValue({ userId: "user_client", sessionClaims: { org_id: "org_client" } });
  getAccountByOrgId.mockResolvedValue({ id: OWN, client_access_enabled: true });
  ensureAccountRole.mockResolvedValue(role);
}

beforeEach(() => {
  authMock.mockReset(); getAccountByOrgId.mockReset(); ensureAccountRole.mockReset(); readStoredRole.mockReset();
  readStoredRole.mockReturnValue(IN_FLIGHT);
});

describe("requireAccountAccess carries the caller's role (spec §7)", () => {
  it("agency: no client role, may manage, and never enters the fallback or the stored read (mutation: call either for the agency -> FAILS)", async () => {
    asAgency();
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_agency", isAgency: true, role: null, canManage: true });
    expect(ensureAccountRole).not.toHaveBeenCalled();
    expect(readStoredRole).not.toHaveBeenCalled();
  });
  it("client Owner may manage", async () => {
    asClient("owner");
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_client", isAgency: false, role: "owner", canManage: true });
  });
  it("client Staff may not manage (mutation: canManage = role !== null -> FAILS)", async () => {
    asClient("staff");
    expect(await requireAccountAccess(OWN)).toEqual({ userId: "user_client", isAgency: false, role: "staff", canManage: false });
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
