import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workRowText } from "./work-row";

describe("workRowText", () => {
  it("leads with the total and adds the overdue breakdown when there is one", () => {
    expect(workRowText(7, 2)).toBe("7 things to do · 2 overdue");
  });
  it("omits the breakdown when nothing is dated", () => {
    expect(workRowText(7, 0)).toBe("7 things to do");
  });
  it("says so plainly when the queue is empty, rather than vanishing", () => {
    expect(workRowText(0, 0)).toBe("Nothing needs you right now.");
  });
  // A count of exactly one is the designed first experience (spec §3 —
  // dismissing is what first populates `tasks`), not an edge case, and this
  // namespace's own convention (contacts.count/contacts.countOne in
  // messages.ts) is a whole-phrase pick by count, never a plural template
  // reused for one.
  it("takes the singular phrase when the total is exactly one", () => {
    expect(workRowText(1, 0)).toBe("1 thing to do");
  });
  it("keeps the singular phrase ahead of an overdue breakdown too", () => {
    expect(workRowText(1, 1)).toBe("1 thing to do · 1 overdue");
  });

  // Every default-omitting call above is unaffected (English, same as
  // before). Since lane B (#317) every key here has a real `.es` twin.
  it("passing locale 'es' reads real Spanish, singular at one on BOTH halves (mutation: overdue through t() instead of plural() → '1 atrasadas' → FAILS)", () => {
    expect(workRowText(0, 0, "es")).toBe("No hay nada que necesite su atención en este momento.");
    expect(workRowText(7, 2, "es")).toBe("7 cosas por hacer · 2 atrasadas");
    expect(workRowText(1, 1, "es")).toBe("1 cosa por hacer · 1 atrasada");
  });
});

// Coordinator follow-up (lane A): the read SHAPE, not just the output — a
// function that silently ignored `locale` and kept reading m[...] directly
// must fail here as well as above.
describe("work-row.tsx reads work.title/work.empty/work.row.* through the locale (mutation: revert any one call to a raw m[...] read → FAILS)", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "work-row.tsx"), "utf8",
  );
  it("workRowText routes through t()/plural(), and WorkRowCard reads work.title the same way", () => {
    expect(src).not.toMatch(/\bm\[/);
    expect(src).toMatch(/t\(m, "work\.empty", locale\)/);
    expect(src).toMatch(/plural\(m, "work\.row\.count", total, locale/);
    expect(src).toMatch(/plural\(m, "work\.row\.overdue", overdue, locale/);
    expect(src).toMatch(/t\(m, "work\.title", locale\)/);
  });
});
