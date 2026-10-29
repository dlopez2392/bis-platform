import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const currentUser = vi.fn();
const requireAgency = vi.fn();
const startAgencyVisit = vi.fn();
const readAgencyActorName = vi.fn();
const newestAgencyVisitStart = vi.fn();
const SVC = { service: true };

vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock(), currentUser: () => currentUser() }));
vi.mock("@/lib/auth", () => ({ requireAgency: () => requireAgency() }));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    isAgencyVisitReason: real.isAgencyVisitReason,
    AGENCY_VISIT_HOURS: real.AGENCY_VISIT_HOURS,
    serviceDb: () => SVC,
    startAgencyVisit: (...a: unknown[]) => startAgencyVisit(...a),
    readAgencyActorName: (...a: unknown[]) => readAgencyActorName(...a),
    newestAgencyVisitStart: (...a: unknown[]) => newestAgencyVisitStart(...a),
  };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import { actorNameFor, startVisitForCaller, lastVisitEndedRecently } from "./visit";

const A = "11111111-1111-4111-8111-111111111111";
const ME = "user_agency";

function clerk(fullName: string | null, email: string | null, id = ME) {
  currentUser.mockResolvedValue({ id, fullName, primaryEmailAddress: email ? { emailAddress: email } : null });
}

beforeEach(() => {
  for (const m of [authMock, currentUser, requireAgency, startAgencyVisit, readAgencyActorName, newestAgencyVisitStart]) m.mockReset();
  requireAgency.mockResolvedValue({ userId: ME });
  authMock.mockResolvedValue({ userId: ME, sessionId: "sess_1" });
  readAgencyActorName.mockResolvedValue({ name: "Dan Lopez", email: "dan@bis.example" });
  clerk("Clerk Name", "clerk@bis.example");
});

/** F-118 part 1: the name an Owner reads on each visit, chosen once when the visit starts. */
describe("actorNameFor: the name order", () => {
  it("1. users.name comes first, without asking Clerk (mutation: ask Clerk first -> FAILS on the currentUser count)", async () => {
    expect(await actorNameFor(ME)).toBe("Dan Lopez");
    expect(readAgencyActorName).toHaveBeenCalledWith(SVC, ME);
    expect(currentUser).not.toHaveBeenCalled();
  });
  it("1. a blank users.name: Clerk's full name beats users.email", async () => {
    readAgencyActorName.mockResolvedValue({ name: "   ", email: "dan@bis.example" });
    expect(await actorNameFor(ME)).toBe("Clerk Name");
  });
  it("1. then users.email", async () => {
    readAgencyActorName.mockResolvedValue({ name: null, email: "dan@bis.example" });
    clerk(null, "clerk@bis.example");
    expect(await actorNameFor(ME)).toBe("dan@bis.example");
  });
  it("1. then Clerk's primary email (also with no users row at all)", async () => {
    readAgencyActorName.mockResolvedValue(null);
    clerk("  ", "clerk@bis.example");
    expect(await actorNameFor(ME)).toBe("clerk@bis.example");
  });
  it("1. then null", async () => {
    readAgencyActorName.mockResolvedValue({ name: "", email: null });
    clerk(null, null);
    expect(await actorNameFor(ME)).toBeNull();
  });
  it("1. trimmed, and clipped to 200 characters", async () => {
    readAgencyActorName.mockResolvedValue({ name: `  ${"x".repeat(250)}  `, email: null });
    expect(await actorNameFor(ME)).toBe("x".repeat(200));
    readAgencyActorName.mockResolvedValue({ name: "  Dan  ", email: null });
    expect(await actorNameFor(ME)).toBe("Dan");
  });
  it("1. Clerk's record is used only when it is THIS person's", async () => {
    readAgencyActorName.mockResolvedValue({ name: null, email: null });
    clerk("Someone Else", "else@bis.example", "user_other");
    expect(await actorNameFor(ME)).toBeNull();
  });
  it("2. a Clerk failure gives the next fallback, never a throw", async () => {
    readAgencyActorName.mockResolvedValue({ name: null, email: "dan@bis.example" });
    currentUser.mockRejectedValue(new Error("clerk down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await actorNameFor(ME)).toBe("dan@bis.example");
    readAgencyActorName.mockResolvedValue(null);
    expect(await actorNameFor(ME)).toBeNull();
    err.mockRestore();
  });
  it("a failed users read rejects (the visit's own start would fail on the same database)", async () => {
    readAgencyActorName.mockRejectedValue(new Error("readAgencyActorName failed: down"));
    await expect(actorNameFor(ME)).rejects.toThrow("readAgencyActorName failed: down");
  });
});

describe("startVisitForCaller", () => {
  it("3. an unknown reason or a non-UUID account starts nothing (mutation: validate after the RPC -> FAILS)", async () => {
    expect(await startVisitForCaller(A, "curious" as never)).toBeNull();
    expect(await startVisitForCaller("foo", "setup")).toBeNull();
    expect(startAgencyVisit).not.toHaveBeenCalled();
  });
  it("4. starts this person's visit in this session, with their name and the reason, and returns its id", async () => {
    startAgencyVisit.mockResolvedValue("visit_1");
    expect(await startVisitForCaller(A, "setup")).toBe("visit_1");
    expect(startAgencyVisit).toHaveBeenCalledWith(SVC, A, { clerkUserId: ME, sessionId: "sess_1", name: "Dan Lopez" }, "setup");
  });
  it("4. the wrapper's null (no such account) passes through", async () => {
    startAgencyVisit.mockResolvedValue(null);
    expect(await startVisitForCaller(A, "billing")).toBeNull();
  });
  it("4. a rejection rejects", async () => {
    startAgencyVisit.mockRejectedValue(new Error("startAgencyVisit failed: down"));
    await expect(startVisitForCaller(A, "support")).rejects.toThrow("startAgencyVisit failed: down");
  });
  it("5. requireAgency runs first: when it throws, nothing else runs", async () => {
    requireAgency.mockRejectedValue(new Error("REDIRECT:/"));
    await expect(startVisitForCaller(A, "setup")).rejects.toThrow("REDIRECT:/");
    expect(authMock).not.toHaveBeenCalled();
    expect(readAgencyActorName).not.toHaveBeenCalled();
    expect(startAgencyVisit).not.toHaveBeenCalled();
  });
  it("a session signed in AS someone else (Clerk actor) starts nothing in anyone's name (T3 review minor 3; mutation: drop the actor check -> FAILS)", async () => {
    authMock.mockResolvedValue({ userId: ME, sessionId: "sess_1", actor: { sub: "user_staff" } });
    await expect(startVisitForCaller(A, "setup")).rejects.toThrow("REDIRECT:/no-access?reason=none");
    expect(readAgencyActorName).not.toHaveBeenCalled();
    expect(startAgencyVisit).not.toHaveBeenCalled();
  });
  it("no session id sends the person to sign in, with nothing started", async () => {
    authMock.mockResolvedValue({ userId: ME, sessionId: null });
    await expect(startVisitForCaller(A, "setup")).rejects.toThrow("REDIRECT:/sign-in");
    expect(startAgencyVisit).not.toHaveBeenCalled();
  });
});

describe("lastVisitEndedRecently: the chooser's 'your last visit here ended' line (plan C15)", () => {
  const NOW = new Date("2026-10-29T20:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString().replace("Z", "+00:00");
  const H = 3_600_000, MIN = 60_000;

  it.each([
    ["exactly 2 h ago (ended)", 2 * H, true],
    ["1 h 59 min ago (still live; mutation: drop the lower bound -> FAILS)", 2 * H - MIN, false],
    ["13 h 59 min ago (ended within 12 hours)", 14 * H - MIN, true],
    ["14 h ago (too long ago)", 14 * H, false],
  ] as const)("a newest start %s (%i ms) gives %s", async (_label, ms, expected) => {
    newestAgencyVisitStart.mockResolvedValue(ago(ms));
    expect(await lastVisitEndedRecently(A, NOW)).toBe(expected);
    expect(newestAgencyVisitStart).toHaveBeenCalledWith(SVC, A, { clerkUserId: ME, sessionId: "sess_1" });
  });
  it("reads Postgres's microsecond timestamps", async () => {
    newestAgencyVisitStart.mockResolvedValue("2026-10-29T15:00:00.123456+00:00");
    expect(await lastVisitEndedRecently(A, NOW)).toBe(true);
  });
  it("no visit at all: false", async () => {
    newestAgencyVisitStart.mockResolvedValue(null);
    expect(await lastVisitEndedRecently(A, NOW)).toBe(false);
  });
  it("requireAgency first; a non-UUID id or no session: false with no read", async () => {
    expect(await lastVisitEndedRecently("foo", NOW)).toBe(false);
    authMock.mockResolvedValue({ userId: ME, sessionId: null });
    expect(await lastVisitEndedRecently(A, NOW)).toBe(false);
    expect(newestAgencyVisitStart).not.toHaveBeenCalled();
    requireAgency.mockRejectedValue(new Error("REDIRECT:/"));
    await expect(lastVisitEndedRecently(A, NOW)).rejects.toThrow("REDIRECT:/");
  });
});
