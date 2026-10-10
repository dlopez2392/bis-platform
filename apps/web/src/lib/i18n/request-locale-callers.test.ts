// RSC layouts cannot be rendered in this vitest; this pins the wiring.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../app");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe("every requestLocale call passes the person's own language (spec 5.2)", () => {
  it("names userLanguage in each call, and finds at least the three known sites (mutation: drop userLanguage from dashboard/layout.tsx -> FAILS naming it)", () => {
    const calls = files(APP).flatMap((f) => {
      const src = readFileSync(f, "utf8");
      return [...src.matchAll(/requestLocale\(\s*\{([\s\S]*?)\}\s*[,)]/g)].map((m) => ({ f: path.relative(APP, f), args: m[1]! }));
    });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.filter((c) => !/userLanguage\s*:/.test(c.args)).map((c) => c.f)).toEqual([]);
  });
});
