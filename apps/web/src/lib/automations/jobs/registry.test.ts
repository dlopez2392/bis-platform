import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { JOB_HANDLERS, JOB_KINDS, handlerFor } from "./registry";
import { JOB_KIND_PATTERN, JOB_TIMEOUT_MAX_MS } from "./types";
import { platformPing } from "./platform-ping";

describe("JOB_HANDLERS — the registry every job kind is claimed through", () => {
  it("every handler's timeoutMs, maxAttempts and kind are in range and self-consistent", () => {
    for (const [key, h] of Object.entries(JOB_HANDLERS)) {
      expect(h.timeoutMs).toBeGreaterThanOrEqual(1_000);
      expect(h.timeoutMs).toBeLessThanOrEqual(JOB_TIMEOUT_MAX_MS);
      expect(Number.isInteger(h.maxAttempts)).toBe(true);
      expect(h.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(h.maxAttempts).toBeLessThanOrEqual(25);
      expect(h.kind).toMatch(JOB_KIND_PATTERN);
      expect(h.kind).toBe(key);
    }
  });

  it("JOB_KIND_PATTERN is 0102's own kind check, read from the migration file", () => {
    const file = path.resolve(__dirname, "../../../../../../packages/db/supabase/migrations/0102_jobs.sql");
    const sql = fs.readFileSync(file, "utf8");
    const match = sql.match(/kind ~ '([^']*)'/);
    expect(match).not.toBeNull();
    expect(JOB_KIND_PATTERN.source).toBe(match![1]);
  });

  it("JOB_KINDS lists every handler's kind, once each", () => {
    expect(JOB_KINDS).toEqual(Object.keys(JOB_HANDLERS));
  });

  it("handlerFor finds a registered kind and answers null for an unknown one", () => {
    expect(handlerFor("platform.ping")).toBe(platformPing);
    expect(handlerFor("nope.kind")).toBeNull();
  });
});

describe("platformPing — the rollout check (spec section 12): proves enqueue -> claim -> complete", () => {
  it("is registered as platform.ping, one attempt, 5 s", () => {
    expect(platformPing.kind).toBe("platform.ping");
    expect(platformPing.maxAttempts).toBe(1);
    expect(platformPing.timeoutMs).toBe(5_000);
  });

  it("parses any plain object down to an empty one", () => {
    expect(platformPing.parse({})).toEqual({});
    expect(platformPing.parse({ ignored: "field" })).toEqual({});
  });

  it("refuses anything that is not a plain object", () => {
    for (const bad of [null, undefined, "x", 1, [], true]) {
      expect(() => platformPing.parse(bad)).toThrow("platform.ping takes an empty object");
    }
  });

  it("run resolves and does nothing observable", async () => {
    await expect(platformPing.run({} as never, {})).resolves.toBeUndefined();
  });
});
