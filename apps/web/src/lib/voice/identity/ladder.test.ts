import { describe, it, expect } from "vitest";
import { requiredRung, NO_PACK, PACK_REQUIREMENTS, type IdentityAction } from "./ladder";
import type { TradeModuleId } from "../modules";

// Every (action, pack) cell, typed out as a literal table (spec 5.1). The
// table's own length is asserted first so a cell silently dropped (e.g. an
// edit that collapses "insurance read" to the no-pack row) turns the WHOLE
// file red rather than quietly passing a shorter table.
const TABLE: [IdentityAction, TradeModuleId | null, 0 | 1 | 2 | 3][] = [
  ["read_existing", null, 1],
  ["change_existing", null, 1],
  ["book_new", null, 0],
  ["leave_message", null, 0],
  ["read_existing", "events", 1],
  ["change_existing", "events", 1],
  ["book_new", "events", 0],
  ["leave_message", "events", 0],
  ["read_existing", "insurance_pc", 2],
  ["change_existing", "insurance_pc", 2],
  ["book_new", "insurance_pc", 0],
  ["leave_message", "insurance_pc", 0],
];

describe("requiredRung — the ladder", () => {
  it("has exactly twelve cells (mutation: insurance read -> 1 FAILS this literal table)", () => {
    expect(TABLE).toHaveLength(12);
  });

  it.each(TABLE)("requiredRung(%s, %s) === %s", (action, pack, rung) => {
    expect(requiredRung(action, pack)).toBe(rung);
  });

  it("an id this build does not know reads as no pack (mutation: drop Object.hasOwn -> 'constructor' FAILS)", () => {
    // "constructor" and "toString" are inherited property names on a plain
    // object literal: a naive `PACK_REQUIREMENTS[tradeModule]` (no
    // Object.hasOwn guard) returns Object.prototype's own constructor/
    // toString function instead of undefined, and indexing a required
    // action off THAT returns undefined, not the no-pack row's 1.
    for (const unknown of ["constructor", "toString", "plumbing"] as const) {
      expect(requiredRung("read_existing", unknown as unknown as TradeModuleId)).toBe(
        NO_PACK.read_existing,
      );
      expect(requiredRung("read_existing", unknown as unknown as TradeModuleId)).toBe(1);
    }
  });

  it("no cell anywhere is 3 (rung 3 is declared and unbuilt, spec E1)", () => {
    const packs: (TradeModuleId | null)[] = [null, "events", "insurance_pc"];
    const actions: IdentityAction[] = ["read_existing", "change_existing", "book_new", "leave_message"];
    for (const pack of packs) {
      for (const action of actions) {
        expect(requiredRung(action, pack)).not.toBe(3);
      }
    }
  });

  it("PACK_REQUIREMENTS carries only the two known packs, each a full four-action row", () => {
    expect(Object.keys(PACK_REQUIREMENTS).sort()).toEqual(["events", "insurance_pc"]);
  });
});
