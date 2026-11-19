import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * The AI apps card's own boundary on the Team page (rule 5 extended to the card): a failed read of the switch costs
 * the card's place only, a failed read of the log costs the list only, and the name of whoever changed it is a nicety
 * that never fails anything. The log is read on the REQUEST's client (RLS decides who sees it), the rest on serviceDb.
 */
const mocks = vi.hoisted(() => {
  const calls = { from: [] as string[], eq: [] as [string, string][] };
  const nameRead = vi.fn();
  // The one inline read: users.name by id on serviceDb (lib/mcp/run.ts reads the same table the same way).
  const chain = {
    select: () => chain,
    eq: (col: string, id: string) => { calls.eq.push([col, id]); return chain; },
    maybeSingle: () => nameRead(),
  };
  return {
    sw: vi.fn(), zone: vi.fn(), log: vi.fn(), nameRead, calls, request: { tag: "request" },
    service: { tag: "service", from: (t: string) => { calls.from.push(t); return chain; } },
  };
});
vi.mock("@/lib/db", () => ({ dbForRequest: async () => mocks.request }));
vi.mock("@bis/db", () => ({
  serviceDb: () => mocks.service, readAiAppsSwitch: mocks.sw, readAccountTimezone: mocks.zone, readAiAppLog: mocks.log,
}));

const { AiAppsSection } = await import("./ai-apps-section");
const { AiAppsCard, AiAppsCardError } = await import("./ai-apps-card");

const STATE = { enabledAt: "2026-11-19T20:00:00.000Z", changedAt: "2026-11-19T20:00:00.000Z", changedBy: "u1" };
const set = async () => ({ ok: false as const, error: "x" });
const run = () => AiAppsSection({ accountId: "a1", viewer: "owner", locale: "en", pseudo: false, setSwitch: set }) as Promise<ReactElement<Record<string, unknown>>>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.from.length = 0;
  mocks.calls.eq.length = 0;
  mocks.sw.mockResolvedValue(STATE);
  mocks.zone.mockResolvedValue("America/Denver");
  mocks.log.mockResolvedValue([]);
  mocks.nameRead.mockResolvedValue({ data: { name: "Maria Lopez", email: "maria@example.com" }, error: null });
});

describe("AiAppsSection", () => {
  it("renders the card with the state, the account's zone, the Owner's name and the log read on the request client (mutation: read the log on serviceDb -> FAILS)", async () => {
    const el = await run();
    expect(el.type).toBe(AiAppsCard);
    expect(el.props).toMatchObject({ state: STATE, zone: "America/Denver", changedByName: "Maria Lopez", log: [], viewer: "owner" });
    expect(mocks.log).toHaveBeenCalledWith(mocks.request, "a1", 20);
    expect(mocks.sw).toHaveBeenCalledWith(mocks.service, "a1");
    expect(mocks.calls.from).toEqual(["users"]);
    expect(mocks.calls.eq).toEqual([["id", "u1"]]);
  });
  it("the name falls back to the email, then to none (mutation: show the email first -> FAILS)", async () => {
    mocks.nameRead.mockResolvedValue({ data: { name: " ", email: "maria@example.com" }, error: null });
    expect((await run()).props.changedByName).toBe("maria@example.com");
    mocks.nameRead.mockResolvedValue({ data: null, error: null });
    expect((await run()).props.changedByName).toBeNull();
  });
  it("never switched on: no name is looked up", async () => {
    mocks.sw.mockResolvedValue({ enabledAt: null, changedAt: null, changedBy: null });
    expect((await run()).props.changedByName).toBeNull();
    expect(mocks.calls.from).toEqual([]);
  });
  it("a zone that is not stored falls back to America/Chicago, the column default (mutation: drop the fallback -> FAILS)", async () => {
    mocks.zone.mockResolvedValue(null);
    expect((await run()).props.zone).toBe("America/Chicago");
  });
  it("a failed switch read is the card's own error state, logged by account (mutation: let it throw -> FAILS)", async () => {
    mocks.sw.mockRejectedValue(new Error("readAiAppsSwitch failed: denied"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run()).type).toBe(AiAppsCardError);
    expect(String(err.mock.calls[0]?.[0])).toContain("a1");
    err.mockRestore();
  });
  it("a failed log read leaves the card and its switch, with the list in its error state (mutation: fail the whole card -> FAILS)", async () => {
    mocks.log.mockRejectedValue(new Error("readAiAppLog failed: timeout"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await run();
    expect(el.type).toBe(AiAppsCard);
    expect(el.props.log).toBeNull();
    err.mockRestore();
  });
  it("a failed name read costs only the name (mutation: fail the card -> FAILS)", async () => {
    mocks.nameRead.mockResolvedValue({ data: null, error: { message: "boom" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await run();
    expect(el.type).toBe(AiAppsCard);
    expect(el.props.changedByName).toBeNull();
    err.mockRestore();
  });
});
