import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchKnowledge, __resetKnowledgeCache, KNOWLEDGE_MAX_CHARS, KNOWLEDGE_TTL_MS } from "./knowledge";

const ok = (text: string) => async () => ({ ok: true, text: async () => text });

describe("fetchKnowledge", () => {
  beforeEach(() => __resetKnowledgeCache());

  it("returns the trimmed body, capped, and caches it for the TTL", async () => {
    const fetchImpl = vi.fn(ok("hello" + "x".repeat(KNOWLEDGE_MAX_CHARS)));
    let now = 1_000_000;
    const first = await fetchKnowledge("https://example.com/pack", { fetchImpl, now: () => now });
    expect(first!.length).toBe(KNOWLEDGE_MAX_CHARS);
    expect(first!.startsWith("hello")).toBe(true);
    now += KNOWLEDGE_TTL_MS - 1;
    await fetchKnowledge("https://example.com/pack", { fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 2;
    await fetchKnowledge("https://example.com/pack", { fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never throws: a non-2xx, a network error and a bad URL are all null — and the failure is cached too", async () => {
    const failing = vi.fn(async () => { throw new Error("boom"); });
    expect(await fetchKnowledge("https://example.com/down", { fetchImpl: failing })).toBeNull();
    expect(await fetchKnowledge("https://example.com/down", { fetchImpl: failing })).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await fetchKnowledge("https://example.com/404", { fetchImpl: async () => ({ ok: false, text: async () => "no" }) })).toBeNull();
    const never = vi.fn();
    expect(await fetchKnowledge("not a url", { fetchImpl: never })).toBeNull();
    expect(await fetchKnowledge("ftp://example.com/x", { fetchImpl: never })).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });

  it("an empty body is null, not an empty knowledge block", async () => {
    expect(await fetchKnowledge("https://example.com/empty", { fetchImpl: ok("   ") })).toBeNull();
  });
});
