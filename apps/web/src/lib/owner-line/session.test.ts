// apps/web/src/lib/owner-line/session.test.ts
// F-032 plan Task 12: decideOwnerSession, the ONE place a pass becomes an owner-line session (spec §4.3, §7).
import { describe, it, expect, vi } from "vitest";
vi.mock("@bis/db", () => ({ serviceDb: () => ({}), ownerLineSessionCheck: vi.fn(), OWNER_LINE_MAX_CALLS_PER_DAY: 10 }));
import { decideOwnerSession } from "./session";
import { signOwnerPass } from "@/lib/voice/sip-handoff-signature";

const SECRET = "s".repeat(40);
const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";
const U = "22222222-2222-4222-8222-222222222222";
const TOKEN = "t".repeat(32);
const NOW = new Date(1_800_000_000_000);
const CALLED = "+19565550100";
const OK_CHECK = { ok: true as const, calledE164: CALLED, callerE164: "+19565550142" };
const LIVE = { ok: true as const, name: "Dan Lopez", language: "es" as const, clerkUserId: "user_d", clerkOrgId: "org_a",
  timezone: "America/Chicago", accountLanguage: null };
process.env.VOICE_HANDOFF_SECRET = SECRET;
const pass = (over: Partial<{ accountId: string; role: "owner" | "staff" | "technician"; at: number }> = {}) =>
  signOwnerPass(TOKEN, { accountId: over.accountId ?? A, userId: U, role: over.role ?? "staff", calledE164: CALLED }, over.at ?? NOW.getTime())!;
type Live = typeof LIVE | { ok: false; reason: string } | (Omit<typeof LIVE, "language" | "accountLanguage"> & { language: "en" | "es" | null; accountLanguage: "en" | "es" | null });
const decide = (raw: string, over: Partial<Parameters<typeof decideOwnerSession>[0]> = {}, check = vi.fn(async (): Promise<Live> => LIVE)) =>
  decideOwnerSession({ db: {} as never, raw, handoffToken: TOKEN, handoffCheck: OK_CHECK, accountId: A, now: NOW, ...over },
    { check: check as never });

describe("decideOwnerSession: the pass is refused when (spec §7)", () => {
  it("all holds: a session for this person, in their language", async () => {
    expect(await decide(pass())).toEqual({ ok: true, session: { accountId: A, userId: U, role: "staff", clerkUserId: "user_d",
      clerkOrgId: "org_a", firstName: "Dan", actorName: "Dan Lopez", locale: "es", timezone: "America/Chicago" } });
  });
  it("its signature is tampered", async () => {
    expect(await decide(pass().replace(".staff.", ".owner."))).toEqual({ ok: false, reason: "pass-bad-signature" });
  });
  it("it is bound to another call's handoff token (single use is the webhook's row; this is the binding)", async () => {
    expect(await decide(pass(), { handoffToken: "u".repeat(32) })).toEqual({ ok: false, reason: "pass-bad-signature" });
    expect(await decide(pass(), { handoffToken: null })).toEqual({ ok: false, reason: "pass-bad-signature" });
  });
  it("it is expired at 61 s (SC-12: freshness is checked here, at redemption, and nowhere later)", async () => {
    expect(await decide(pass({ at: NOW.getTime() - 61_000 }))).toEqual({ ok: false, reason: "pass-expired" });
    expect((await decide(pass({ at: NOW.getTime() - 59_000 }))).ok).toBe(true);
  });
  it("it was minted for business A but is used on business B's number (mutation: drop the account comparison -> FAILS)", async () => {
    expect(await decide(pass(), { accountId: B })).toEqual({ ok: false, reason: "wrong-business" });
  });
  it("its called number is not the one the INVITE's own signed statement names (mutation: drop the called-number comparison -> FAILS)", async () => {
    expect(await decide(pass(), { handoffCheck: { ...OK_CHECK, calledE164: "+19565550111" } })).toEqual({ ok: false, reason: "wrong-business" });
  });
  it("the call itself did not come through our answer route (no X-BIS-Signature)", async () => {
    expect(await decide(pass(), { handoffCheck: { ok: false, reason: "absent" } })).toEqual({ ok: false, reason: "call-not-signed" });
  });
  it("its role is one this data path does not offer: a Technician under F2 is refused before any read (mutation: drop the OWNER_LINE_ROLES check -> FAILS)", async () => {
    const check = vi.fn(async (): Promise<Live> => LIVE);
    expect(await decide(pass({ role: "technician" }), {}, check)).toEqual({ ok: false, reason: "role-not-offered" });
    expect(check).not.toHaveBeenCalled();
  });
  it("the person was removed, or their role changed, after minting: the live re-read says so, with the minted role and today's limit (SC-8)", async () => {
    const check = vi.fn(async (): Promise<Live> => ({ ok: false, reason: "role_changed" }));
    expect(await decide(pass(), {}, check)).toEqual({ ok: false, reason: "role_changed" });
    expect(check).toHaveBeenCalledWith({}, { accountId: A, userId: U, role: "staff", maxCalls: 10 });
  });
  it("speaks the person's language, else the account's, else English (spec §4.4)", async () => {
    const live = (language: "en" | "es" | null, accountLanguage: "en" | "es" | null) => vi.fn(async (): Promise<Live> => ({ ...LIVE, language, accountLanguage }));
    const locale = async (c: ReturnType<typeof live>) => {
      const d = await decide(pass(), {}, c);
      return d.ok ? d.session.locale : null;
    };
    expect(await locale(live("es", "en"))).toBe("es");
    expect(await locale(live(null, "es"))).toBe("es");
    expect(await locale(live(null, null))).toBe("en");
  });
  it("a person with no name on file is greeted without one", async () => {
    const d = await decide(pass(), {}, vi.fn(async (): Promise<Live> => ({ ...LIVE, name: null as unknown as string })));
    expect(d.ok && d.session.firstName).toBe(null);
  });
});

// Task 10/11 review m-3: the per-tool re-check must tie the session to the person the database re-checked. Under the
// token path the read token is minted from session.clerkUserId/clerkOrgId, so a session whose Clerk ids are not the
// re-checked person's would read as someone else. Refused on any mismatch, before any read.
describe("recheckOwnerSession: the session is the person the database re-checked (review m-3)", () => {
  const S = { accountId: A, userId: U, role: "staff" as const, clerkUserId: "user_d", clerkOrgId: "org_a",
    firstName: "Dan", actorName: "Dan Lopez", locale: "en" as const, timezone: "America/Chicago" };
  async function recheck(row: Record<string, unknown>, session = S) {
    const db = await import("@bis/db");
    vi.mocked(db.ownerLineSessionCheck).mockReset().mockResolvedValue(row as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { recheckOwnerSession } = await import("./session");
    return { ok: await recheckOwnerSession(session, NOW), check: vi.mocked(db.ownerLineSessionCheck) };
  }
  it("the same person, the same Clerk ids: still valid, re-checked with the minted role and NO daily limit (the call is already counted)", async () => {
    const r = await recheck(LIVE);
    expect(r.ok).toBe(true);
    expect(r.check).toHaveBeenCalledWith({}, { accountId: A, userId: U, role: "staff", maxCalls: null });
  });
  it("a session whose clerkUserId is not the re-checked person's is refused (mutation: drop the clerkUserId comparison -> FAILS)", async () => {
    expect((await recheck(LIVE, { ...S, clerkUserId: "user_owner" })).ok).toBe(false);
  });
  it("a session whose clerkOrgId is not the re-checked person's business is refused (mutation: drop the clerkOrgId comparison -> FAILS)", async () => {
    expect((await recheck(LIVE, { ...S, clerkOrgId: "org_other" })).ok).toBe(false);
  });
  it("a refusal from the database is a refusal", async () => {
    expect((await recheck({ ok: false, reason: "locked" })).ok).toBe(false);
  });
});

// Task 10/11 review m-3: decideOwnerSession is the ONLY way an OwnerLineSession is built. A non-test source that types
// a value as one by annotation, `as`, `satisfies` or a declared return type is a second way to build it, and it FAILS
// here naming the file. A PARAMETER typed OwnerLineSession only consumes one, so it is allowed.
describe("only decideOwnerSession builds an OwnerLineSession (review m-3)", () => {
  it("no non-test source under apps/web/src annotates, casts to, satisfies or returns an OwnerLineSession (mutation: export a session literal from events.ts -> FAILS)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = fileURLToPath(new URL("../..", import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { if (n !== "node_modules") walk(p); }
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk(src);
    expect(files.some((f) => f.endsWith(join("owner-line", "session.ts")))).toBe(true);
    const BUILDS = /(?::\s*OwnerLineSession\s*=|\bas\s+OwnerLineSession\b|\bsatisfies\s+OwnerLineSession\b|\)\s*:\s*(?:Promise<\s*)?OwnerLineSession\b)/;
    const offenders = files
      .filter((f) => BUILDS.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
      .map((f) => relative(src, f).split("\\").join("/"));
    expect(offenders).toEqual([]);
  });
});
