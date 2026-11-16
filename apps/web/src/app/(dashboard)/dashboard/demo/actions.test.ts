import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The REAL requireAgency (lib/auth.ts) runs: only Clerk's auth() and Next's redirect are replaced, so a
// client Owner, Staff, Technician or a signed-out visitor is refused by the guard this page really uses.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

const db = vi.hoisted(() => ({
  countProspectDemosSince: vi.fn(),
  recordProspectDemo: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ tag: "service" }),
  countProspectDemosSince: (...a: unknown[]) => db.countProspectDemosSince(...a),
  recordProspectDemo: (...a: unknown[]) => db.recordProspectDemo(...a),
}));

import { TRADE_ENTRIES } from "@/lib/vetting/trades";
import { PROSPECT_DEMO_MAX_PER_USER_PER_DAY, type ProspectDemoForm } from "@/lib/voice/prospect-demo";
import { startProspectDemoAction } from "./actions";

const SECRET = "ek_test_never_logged_123";
const fetchMock = vi.fn();
const logSpy = vi.fn();

const FORM: ProspectDemoForm = {
  businessName: "Garza Lawn & Garden", trade: "landscaping", tradeOther: "", languages: "both",
  hours: {
    weekdays: { open: true, from: "08:00", to: "17:00" },
    saturday: { open: true, from: "08:00", to: "12:00" },
    sunday: { open: false, from: "", to: "" },
  },
  services: [{ name: "Lawn mowing", price: "45", minutes: "40" }],
};

function asAgency() {
  authMock.mockResolvedValue({ userId: "user_agency", sessionId: "sess_1", sessionClaims: { app_role: "agency_admin" } });
}
/** Every client role carries the same claims at this gate (the role lives in the database); an Owner is
 *  also an org admin in Clerk, which must not read as the agency. */
const CLIENTS = {
  owner: { userId: "user_owner", sessionClaims: { org_id: "org_client", org_role: "org:admin" } },
  staff: { userId: "user_staff", sessionClaims: { org_id: "org_client", org_role: "org:member" } },
  technician: { userId: "user_tech", sessionClaims: { org_id: "org_client", org_role: "org:member" } },
};

function minted() {
  return new Response(JSON.stringify({ value: SECRET, expires_at: 1_900_000_000 }), { status: 200 });
}
function mintBody(): { session: { tools: unknown[]; instructions: string } } {
  return JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
}
function everythingLogged(): string {
  return [...logSpy.mock.calls].map((c) => c.map(String).join(" ")).join("\n");
}

beforeEach(() => {
  authMock.mockReset();
  db.countProspectDemosSince.mockReset().mockResolvedValue(0);
  db.recordProspectDemo.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue(minted());
  logSpy.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(logSpy);
  vi.spyOn(console, "error").mockImplementation(logSpy);
  vi.spyOn(console, "warn").mockImplementation(logSpy);
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  asAgency();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("startProspectDemoAction: who may start one", () => {
  for (const [role, session] of Object.entries(CLIENTS)) {
    it(`refuses a client ${role} before anything is counted or minted (mutation: admit a client Owner -> FAILS)`, async () => {
      authMock.mockResolvedValue(session);
      await expect(startProspectDemoAction(FORM)).rejects.toThrow("REDIRECT:/");
      expect(db.countProspectDemosSince).not.toHaveBeenCalled();
      expect(db.recordProspectDemo).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("sends a signed-out visitor to sign in, minting nothing", async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null });
    await expect(startProspectDemoAction(FORM)).rejects.toThrow("REDIRECT:/sign-in");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints for the agency and hands the browser the secret, the length and the opening line", async () => {
    const r = await startProspectDemoAction(FORM);
    expect(r).toMatchObject({ ok: true, secret: SECRET, maxSeconds: 180 });
    expect(r.ok && r.greeting).toContain("Thanks for calling Garza Lawn & Garden.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.openai.com/v1/realtime/client_secrets");
  });
});

describe("startProspectDemoAction: what is minted", () => {
  it("mints a session with NO tools and the typed business in her instructions", async () => {
    await startProspectDemoAction(FORM);
    const { session } = mintBody();
    expect(session.tools).toEqual([]);
    expect(session.instructions).toContain("Garza Lawn & Garden");
    expect(session.instructions).toContain("The price for Lawn mowing is $45.");
    expect(session.instructions).toContain("You have already told the caller that you are Sofía, an AI assistant.");
  });

  it("refuses a held trade with the trade's own reason, minting nothing (mutation: drop the trade gate -> FAILS)", async () => {
    const r = await startProspectDemoAction({ ...FORM, trade: "medical" });
    expect(r).toEqual({ ok: false, error: TRADE_ENTRIES.find((e) => e.key === "medical")!.reason!.en });
    expect(db.recordProspectDemo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("startProspectDemoAction: the cap", () => {
  it(`refuses the ${PROSPECT_DEMO_MAX_PER_USER_PER_DAY + 1}st demo in 24 hours for the same person (mutation: skip the cap -> FAILS)`, async () => {
    db.countProspectDemosSince.mockResolvedValue(PROSPECT_DEMO_MAX_PER_USER_PER_DAY);
    const r = await startProspectDemoAction(FORM);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(String(PROSPECT_DEMO_MAX_PER_USER_PER_DAY));
    expect(db.recordProspectDemo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts THIS person's demos over the last 24 hours", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-16T15:00:00Z"), toFake: ["Date"] });
    try {
      await startProspectDemoAction(FORM);
    } finally {
      vi.useRealTimers();
    }
    expect(db.countProspectDemosSince).toHaveBeenCalledWith({ tag: "service" }, "user_agency", "2026-11-15T15:00:00.000Z");
  });

  it("allows the last one under the cap, recording it BEFORE the mint", async () => {
    db.countProspectDemosSince.mockResolvedValue(PROSPECT_DEMO_MAX_PER_USER_PER_DAY - 1);
    const order: string[] = [];
    db.recordProspectDemo.mockImplementation(async () => { order.push("record"); });
    fetchMock.mockImplementation(async () => { order.push("mint"); return minted(); });
    expect((await startProspectDemoAction(FORM)).ok).toBe(true);
    expect(db.recordProspectDemo).toHaveBeenCalledWith({ tag: "service" }, "user_agency");
    expect(order).toEqual(["record", "mint"]);
  });

  it("fails CLOSED when the count cannot be read", async () => {
    db.countProspectDemosSince.mockRejectedValue(new Error("db down"));
    expect((await startProspectDemoAction(FORM)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the demo cannot be recorded", async () => {
    db.recordProspectDemo.mockRejectedValue(new Error("db down"));
    expect((await startProspectDemoAction(FORM)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("startProspectDemoAction: failures and the log", () => {
  it("refuses with no OpenAI key, counting and minting nothing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await startProspectDemoAction(FORM)).ok).toBe(false);
    expect(db.recordProspectDemo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a refused mint with words, never OpenAI's body", async () => {
    fetchMock.mockResolvedValue(new Response("{\"error\":\"project proj_123 over quota\"}", { status: 429 }));
    const r = await startProspectDemoAction(FORM);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("proj_123");
  });

  it("logs one line per demo naming the business, and never the secret", async () => {
    await startProspectDemoAction(FORM);
    const minting = logSpy.mock.calls.filter((c) => String(c[0]).includes("demo minted"));
    expect(minting).toHaveLength(1);
    expect(String(minting[0]![0])).toContain("Garza Lawn & Garden");
    expect(everythingLogged()).not.toContain(SECRET);
  });
});
