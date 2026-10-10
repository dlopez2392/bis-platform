import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "app-sidebar.tsx"), "utf8",
);

describe("app-sidebar nav labels resolve through the locale helper", () => {
  it("no longer looks up m[item.labelKey] or m[group.label] directly (mutation: revert to the raw m[...] lookup → FAILS, both patterns reappear)", () => {
    expect(src).not.toMatch(/m\[item\.labelKey\]/);
    expect(src).not.toMatch(/m\[group\.label\]/);
    expect(src).toMatch(/t\(m, item\.labelKey, locale\)/);
    expect(src).toMatch(/t\(m, group\.label, locale\)/);
  });
});
