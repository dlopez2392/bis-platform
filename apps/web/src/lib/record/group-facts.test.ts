import { describe, it, expect } from "vitest";
import type { GroupFacts } from "@bis/db";
import { groupFactsView, groupCapLine } from "./group-facts";
import { makeTr } from "./copy";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-12T14:00:00Z"); // 9:00 AM in Chicago (CDT)
const tr = makeTr("en");
const ctx = { zone: ZONE, now: NOW, tr };
const ok = <T,>(value: T) => ({ ok: true as const, value });
const quiet: GroupFacts = { bookingsMade: ok(0), lastTalked: ok(null) };

describe("the group summary's fact line (S-03 part 2b, spec §8.6)", () => {
  it("a narrow reader is told 'people you can see' whenever they are narrow, whether or not anything is hidden (C4; the view takes no hidden count, so it cannot branch on one; mutation: qualify only when a hidden count is above zero -> FAILS)", () => {
    expect(groupFactsView({ total: ok(3), narrow: true, facts: quiet, names: {} }, ctx).line).toEqual(["3 people you can see"]);
    expect(groupFactsView({ total: ok(1), narrow: true, facts: quiet, names: {} }, ctx).line).toEqual(["1 person you can see"]);
    expect(groupFactsView({ total: ok(3), narrow: false, facts: quiet, names: {} }, ctx).line).toEqual(["3 people"]);
    expect(groupFactsView({ total: ok(1), narrow: false, facts: quiet, names: {} }, ctx).line).toEqual(["1 person"]);
  });

  it("Last talked names the member: 'Last talked yesterday with Ana (text)' (C9; mutation: leave the name out -> FAILS)", () => {
    const facts: GroupFacts = { bookingsMade: ok(2), lastTalked: ok({ at: "2026-10-11T15:00:00Z", channel: "text", contactId: "c1" }) };
    const v = groupFactsView({ total: ok(3), narrow: false, facts, names: { c1: "Ana", c2: "Luis" } }, ctx);
    expect(v.line).toEqual(["3 people", "Booked 2 times", "Last talked yesterday with Ana (text)"]);
    expect(v.missing).toBeNull();
    // A member the page has no name for (someone this reader cannot see) is never invented.
    const unknown = groupFactsView({ total: ok(3), narrow: false, facts, names: {} }, ctx);
    expect(unknown.line[2]).toBe("Last talked yesterday with Someone on the team (text)");
  });

  it("a failed count is named, never zeroed: 'Couldn't count the people in this group.' (plan deviation 9; mutation: push '0 people' -> FAILS)", () => {
    const v = groupFactsView({ total: { ok: false }, narrow: false, facts: quiet, names: {} }, ctx);
    expect(v.line).toEqual([]);
    expect(v.missing).toBe("Couldn't count the people in this group.");
    expect(v.allFailed).toBe(false);
    const all = groupFactsView({ total: { ok: false }, narrow: false, facts: { bookingsMade: { ok: false }, lastTalked: { ok: false } }, names: {} }, ctx);
    expect(all.allFailed).toBe(true);
    expect(all.missing).toBe("Couldn't count the people in this group, bookings, and the last conversation.");
  });

  it("Spanish: '3 personas', 'Última conversación … con Ana (texto)' (mutation: read the English catalogue -> FAILS)", () => {
    const es = makeTr("es");
    const facts: GroupFacts = { bookingsMade: ok(0), lastTalked: ok({ at: "2026-10-11T15:00:00Z", channel: "text", contactId: "c1" }) };
    const v = groupFactsView({ total: ok(3), narrow: false, facts, names: { c1: "Ana" } }, { zone: ZONE, now: NOW, tr: es });
    expect(v.line).toEqual(["3 personas", "Última conversación ayer con Ana (texto)"]);
    expect(groupFactsView({ total: ok(1), narrow: true, facts: quiet, names: {} }, { zone: ZONE, now: NOW, tr: es }).line)
      .toEqual(["1 persona que usted puede ver"]);
  });
});

describe("the cap line (S-03 part 2b, D7, plan deviation 12)", () => {
  it("shows only past 50, in words, qualified for a narrow reader (mutation: >= instead of > -> FAILS at exactly 50)", () => {
    expect(groupCapLine({ total: ok(50), shown: 50, narrow: false }, tr)).toBeNull();
    expect(groupCapLine({ total: ok(73), shown: 50, narrow: false }, tr))
      .toBe("Showing activity for 50 of 73 people. Open a person to see theirs.");
    expect(groupCapLine({ total: ok(73), shown: 50, narrow: true }, tr))
      .toBe("Showing activity for 50 of the 73 people you can see. Open a person to see theirs.");
    expect(groupCapLine({ total: { ok: false }, shown: 50, narrow: false }, tr)).toBeNull();
    expect(groupCapLine({ total: ok(73), shown: 50, narrow: false }, makeTr("es")))
      .toBe("Se muestra la actividad de 50 de 73 personas. Abra a una persona para ver la suya.");
  });
});
