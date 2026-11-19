// apps/web/src/lib/tools/belt.test.ts
// F-023: the belt's transport shapes and its one guard (plan §3.1).
import { describe, it, expect, vi, afterEach } from "vitest";
import { realtimeShape, chatShape, runOffered, errorClass, type ToolSpec } from "./belt";

// Keys deliberately NOT in the order the transports want, so an output that copied the spec's own order fails.
const SPEC = {
  parameters: { type: "object", properties: { range: { type: "string" } }, required: ["range"] },
  description: "What happened today.",
  audience: "staff",
  name: "calls_and_messages",
} as const satisfies ToolSpec<"staff">;

describe("realtimeShape: the flat GA Realtime format", () => {
  it("is type, name, description, parameters in that key order, with no audience and no function wrapper", () => {
    expect(JSON.stringify(realtimeShape(SPEC))).toBe(
      '{"type":"function","name":"calls_and_messages","description":"What happened today.",'
      + '"parameters":{"type":"object","properties":{"range":{"type":"string"}},"required":["range"]}}');
  });
});

describe("chatShape: the gateway's AiTool", () => {
  it("wraps name, description and parameters under function, in that key order, with no audience", () => {
    expect(JSON.stringify(chatShape(SPEC))).toBe(
      '{"type":"function","function":{"name":"calls_and_messages","description":"What happened today.",'
      + '"parameters":{"type":"object","properties":{"range":{"type":"string"}},"required":["range"]}}}');
  });
});

describe("errorClass", () => {
  it("is an Error's class name, or the thrown value's type, never its text", () => {
    expect(errorClass(new TypeError("Maria López"))).toBe("TypeError");
    expect(errorClass(new RangeError("x"))).toBe("RangeError");
    expect(errorClass("Maria López called")).toBe("string");
    expect(errorClass(undefined)).toBe("undefined");
  });
});

type Name = "a" | "b" | "c";
const CATALOGUE: readonly Name[] = ["a", "b", "c"];
const guard = (over: { offered?: readonly Name[]; name: string; run?: (n: Name, a: Record<string, unknown>) => Promise<string> }) => {
  const h = {
    run: vi.fn(over.run ?? (async (n: Name) => `ran ${n}`)),
    notOffered: vi.fn((n: Name) => `not offered ${n}`),
    unknown: vi.fn(() => "unknown"),
    onError: vi.fn((cls: string) => {
      console.error(`[test] tool ${over.name} failed: ${cls}`);
      return "failed";
    }),
  };
  const out = runOffered({ catalogue: CATALOGUE, offered: over.offered ?? ["a", "b"], name: over.name, args: { k: 1 }, ...h });
  return { out, ...h };
};

describe("runOffered: the one guard every runner goes through", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a name in no list is unknown, and nothing else is asked (mutation: check offered first -> notOffered, FAILS)", async () => {
    const g = guard({ name: "book_appointment" });
    expect(await g.out).toBe("unknown");
    expect(g.notOffered).not.toHaveBeenCalled();
    expect(g.run).not.toHaveBeenCalled();
  });

  it("the catalogue check is never skipped: a name offered but outside the catalogue is still unknown", async () => {
    const g = guard({ name: "book_appointment", offered: ["a", "book_appointment" as Name] });
    expect(await g.out).toBe("unknown");
    expect(g.run).not.toHaveBeenCalled();
  });

  it("a catalogue name this session was not offered gets the assistant's own refusal, and never runs (mutation: drop the offered check -> runs, FAILS)", async () => {
    const g = guard({ name: "c" });
    expect(await g.out).toBe("not offered c");
    expect(g.notOffered).toHaveBeenCalledWith("c");
    expect(g.unknown).not.toHaveBeenCalled();
    expect(g.run).not.toHaveBeenCalled();
  });

  it("an offered name runs once, with its arguments, and its result is the answer", async () => {
    const g = guard({ name: "b" });
    expect(await g.out).toBe("ran b");
    expect(g.run).toHaveBeenCalledTimes(1);
    expect(g.run).toHaveBeenCalledWith("b", { k: 1 });
    expect(g.unknown).not.toHaveBeenCalled();
    expect(g.notOffered).not.toHaveBeenCalled();
  });

  it("a run that rejects is the caller's failure result, handed the error's CLASS only (mutation: return run() without await -> rejects, FAILS)", async () => {
    const said = "Maria López called from +19565550177";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = guard({ name: "a", run: async () => { throw new TypeError(said); } });
    expect(await g.out).toBe("failed");
    expect(g.onError).toHaveBeenCalledWith("TypeError");
    const lines = log.mock.calls.map((args) => args.map(String).join(" "));
    expect(lines).toEqual(["[test] tool a failed: TypeError"]);
    for (const line of lines) expect(line).not.toMatch(/Maria|López|9565550177|called from/);
  });

  it("a non-Error throw is its type, never its text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = guard({ name: "a", run: async () => { throw "Maria López"; } });
    expect(await g.out).toBe("failed");
    expect(g.onError).toHaveBeenCalledWith("string");
    expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("Maria");
  });

  // A TYPE check: `pnpm --filter web typecheck` is what fails if "z" is ever accepted (the directive then has no
  // error to expect). At run time it only shows the call is otherwise well formed.
  it("by type, a session can be offered only names from the catalogue it runs against", async () => {
    const ok = () => "x";
    // @ts-expect-error "z" is not in this catalogue, so it cannot be on this session's offered list
    expect(await runOffered({ catalogue: CATALOGUE, offered: ["a", "z"], name: "a", args: {}, run: async () => "ran", notOffered: ok, unknown: ok, onError: ok })).toBe("ran");
  });
});
