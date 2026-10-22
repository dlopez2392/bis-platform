import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// apps/web/scripts/realtime-spike.ts (S-47b Task 0) runs in sofia-corpus.yml,
// whose log is PUBLIC. It may print event types and a capped reply, never the
// key, a header, an environment value or an error's free-text message (a
// message can echo what was sent). These cases run it for real WITHOUT a key,
// so it must stop before opening any connection; nothing here touches the
// network.

const SPIKE = fileURLToPath(new URL("../scripts/realtime-spike.ts", import.meta.url));
const WEB = fileURLToPath(new URL("..", import.meta.url));
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

  it("never reads an error's message, and never prints the environment (mutation: log `ev.error?.message` → FAILS)", () => {
    const code = fs.readFileSync(SPIKE, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(code).not.toMatch(/\.message\b/);
    expect(code).not.toMatch(/console\.\w+\([^)]*process\.env/);
    expect(code).not.toMatch(/JSON\.stringify\(\s*process\.env/);
  });
});
