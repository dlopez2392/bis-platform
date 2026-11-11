import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordTransferFailed } from "./transfer-failed";

// F-077 part 1 (spec section 10, ruling 1): the handoff routes record a failed
// transfer WHEN it happens. They answer Telnyx's TeXML fetch on a hard
// deadline with a caller holding the line, so the write is a side-write that
// must never delay or break that answer. These tests pin the three ways it
// could: running before the response, throwing synchronously, rejecting.

const markTransferFailedMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({
  markTransferFailed: (...a: unknown[]) => markTransferFailedMock(...a),
}));

const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});

const DB = { tag: "the route's own service client" } as never;
const AT = new Date("2026-11-06T15:04:05.000Z");

async function runAfter(): Promise<void> {
  for (const [cb] of afterMock.mock.calls) await (cb as () => Promise<void>)();
}

beforeEach(() => {
  afterMock.mockReset();
  markTransferFailedMock.mockReset().mockResolvedValue(true);
  vi.restoreAllMocks();
});

describe("recordTransferFailed", () => {
  it("schedules the write in after(): nothing touches the database before the response (mutation: write inline → FAILS)", () => {
    const out = recordTransferFailed(DB, "acct1", "c1", "no_answer", AT, "handoff-result");
    expect(out).toBeUndefined();
    expect(afterMock).toHaveBeenCalledOnce();
    expect(markTransferFailedMock).not.toHaveBeenCalled();
  });

  it("writes with the route's own client, account, call, reason and instant, exactly", async () => {
    recordTransferFailed(DB, "acct1", "c1", "refused", AT, "handoff");
    await runAfter();
    expect(markTransferFailedMock).toHaveBeenCalledOnce();
    expect(markTransferFailedMock).toHaveBeenCalledWith(DB, "acct1", "c1", "refused", AT);
    expect(markTransferFailedMock.mock.calls[0]![0]).toBe(DB);
  });

  it("a database failure is swallowed and logged through loggableError, naming the call and account", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    markTransferFailedMock.mockRejectedValue(new Error("markTransferFailed failed: boom"));
    recordTransferFailed(DB, "acct1", "c1", "no_answer", AT, "handoff-result");
    await expect(runAfter()).resolves.toBeUndefined();
    const line = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(line).toContain("handoff-result");
    expect(line).toContain("c1");
    expect(line).toContain("acct1");
    // loggableError's shape: "<kind>: <message>".
    expect(line).toContain("Error: markTransferFailed failed: boom");
  });

  it("after() throwing synchronously (no request scope) never escapes into the route (mutation: drop the outer try → FAILS)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    afterMock.mockImplementation(() => { throw new Error("no request scope"); });
    expect(() => recordTransferFailed(DB, "acct1", "c1", "refused", AT, "handoff")).not.toThrow();
    expect(err).toHaveBeenCalled();
  });

  it("an already-recorded failure (a retried webhook: the CAS matched nothing) is not an error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    markTransferFailedMock.mockResolvedValue(false);
    recordTransferFailed(DB, "acct1", "c1", "no_answer", AT, "handoff-result");
    await expect(runAfter()).resolves.toBeUndefined();
    expect(err).not.toHaveBeenCalled();
  });
});
