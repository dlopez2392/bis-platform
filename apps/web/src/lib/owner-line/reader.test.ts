import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ownerLineReadClient } from "./reader";
import { mintOwnerLineToken, OWNER_LINE_TOKEN_TTL_SECONDS } from "./token";

const SECRET = "j".repeat(40);
const env = { SUPABASE_JWT_SECRET: SECRET } as NodeJS.ProcessEnv;
const T0 = 1_800_000_000_000;
const decode = (tok: string) => JSON.parse(Buffer.from(tok.split(".")[1]!, "base64url").toString());

describe("mintOwnerLineToken (decision T; the shape the Task 0 spike proved)", () => {
  it("carries exactly role, aud, sub, org_id, iat, exp, and NEVER app_role (mutation: add app_role -> FAILS)", () => {
    const tok = mintOwnerLineToken({ clerkUserId: "user_1", clerkOrgId: "org_1" }, T0, env);
    const claims = decode(tok);
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "org_id", "role", "sub"]);
    expect(claims).toMatchObject({ role: "authenticated", aud: "authenticated", sub: "user_1", org_id: "org_1" });
    expect(claims.exp - claims.iat).toBe(OWNER_LINE_TOKEN_TTL_SECONDS);
    const [h, b, s] = tok.split(".");
    expect(s).toBe(createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url"));
  });
  it("refuses to mint without a usable secret", () => {
    expect(() => mintOwnerLineToken({ clerkUserId: "u", clerkOrgId: "o" }, T0, {} as NodeJS.ProcessEnv)).toThrow(/SUPABASE_JWT_SECRET/);
  });
});

describe("ownerLineReadClient: the ONE place the data path is decided (plan SC-2)", () => {
  const S = { role: "technician" as const, clerkUserId: "user_t", clerkOrgId: "org_a" };
  it("token: the client reads AS the person (a minted token for their Clerk ids), never as the service role", () => {
    const userDb = vi.fn(() => "USER" as never);
    const serviceDb = vi.fn(() => "SERVICE" as never);
    const mint = vi.fn(() => "TOKEN");
    expect(ownerLineReadClient(S, new Date(T0), { path: "token", userDb, serviceDb, mint })).toBe("USER");
    expect(mint).toHaveBeenCalledWith({ clerkUserId: "user_t", clerkOrgId: "org_a" }, T0);
    expect(userDb).toHaveBeenCalledWith("TOKEN");
    expect(serviceDb).not.toHaveBeenCalled();
  });
  it("service (F2): Owner and Staff read through the service role; a Technician is refused, never given unscoped reads (mutation: drop the technician refusal -> FAILS)", () => {
    const deps = { path: "service" as const, userDb: vi.fn(), serviceDb: vi.fn(() => "SERVICE" as never), mint: vi.fn() };
    expect(ownerLineReadClient({ ...S, role: "staff" }, new Date(T0), deps)).toBe("SERVICE");
    expect(() => ownerLineReadClient(S, new Date(T0), deps)).toThrow(/Technician/);
  });
});
