import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { realtimeErrorWhy } from "../scripts/realtime-spike-why";

// apps/web/scripts/realtime-spike.ts (S-47b Task 0) runs in sofia-corpus.yml,
// whose log is PUBLIC. It may print event types and a capped reply, never the
// key, a header, an environment value or an error's free-text message (a
// message can echo what was sent). These cases run it for real WITHOUT a key,
// so it must stop before opening any connection; nothing here touches the
// network.

const SPIKE = fileURLToPath(new URL("../scripts/realtime-spike.ts", import.meta.url));
const SPIKE_WHY = fileURLToPath(new URL("../scripts/realtime-spike-why.ts", import.meta.url));
const WEB =fileURLToPath(new URL("..", import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

vi.setConfig({ testTimeout: 60_000 });

describe("realtime-spike.ts", () => {
  it("with no OPENAI_API_KEY, exits 2 naming the variable, before any connection, printing nothing on stdout", () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const r = spawnSync(process.execPath, [TSX_CLI, SPIKE], { cwd: WEB, env, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("OPENAI_API_KEY is not set");
    expect(r.stdout).toBe("");
  });

  describe("realtimeErrorWhy: an OpenAI error event's `error`, as the one `why` line the public log may show", () => {
    const SENTINEL = "SENTINEL-sk-proj-do-not-print";
    /** An error whose every free-text path (message, toString, toJSON, a nested object) carries the sentinel. */
    const hostile = () => ({
      code: "invalid_value", type: "invalid_request_error", param: "session.modalities",
      message: SENTINEL,
      details: { echoed: SENTINEL },
      toString: () => SENTINEL,
      toJSON: () => ({ message: SENTINEL }),
    });

    it("reads code, type and param, and nothing else (mutation: append JSON.stringify(error), `${error}` or error[\"message\"] → FAILS)", () => {
      const why = realtimeErrorWhy(hostile());
      expect(why).toBe("error: invalid_value / invalid_request_error / param session.modalities");
      expect(why).not.toContain("SENTINEL");
    });

    it("never stringifies a code, type or param that is not a plain string (an object's toString is free text)", () => {
      const sneaky = { toString: () => SENTINEL };
      const why = realtimeErrorWhy({ code: sneaky, type: sneaky, param: sneaky, message: SENTINEL });
      expect(why).toBe("error: no code / no type");
      expect(why).not.toContain("SENTINEL");
    });

    it("keeps only identifier characters, capped, so a code cannot smuggle a sentence", () => {
      const why = realtimeErrorWhy({ code: `bad code: ${SENTINEL} with spaces`, type: "x".repeat(200) });
      expect(why).not.toContain(" with ");
      expect(why).not.toContain(": SENTINEL");
      expect(why.length).toBeLessThan(200);
    });

    it("answers for an error that is missing, a string, or an Error instance without reading its text", () => {
      expect(realtimeErrorWhy(undefined)).toBe("error: no code / no type");
      expect(realtimeErrorWhy(SENTINEL)).toBe("error: no code / no type");
      const e = Object.assign(new Error(SENTINEL), { code: "rate_limit_exceeded" });
      expect(realtimeErrorWhy(e)).toBe("error: rate_limit_exceeded / no type");
    });
  });

  it("never reads an error's message, and never prints the environment (mutation: log `ev.error?.message` → FAILS)", () => {
    const code = [SPIKE, SPIKE_WHY].map((f) => fs.readFileSync(f, "utf8")).join("\n")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/\.message\b/);
    expect(code).not.toMatch(/console\.\w+\([^)]*process\.env/);
    expect(code).not.toMatch(/JSON\.stringify\(\s*process\.env/);
  });
});
