import { describe, it, expect } from "vitest";
import { TRADE_MODULES, TRADE_MODULE_IDS, tradeModuleBlock, tradeModuleStamp, type TradeModuleId } from "./index";
import { PIN_CONTEXTS, moduleTextSha256, SHA256_HISTORY } from "./pin";

const CTX = { businessName: "Rio Roofing", medium: "phone", handoffAvailable: false, canBook: false } as const;

describe("the registry", () => {
  it("holds exactly the two ids 0094's CHECK allows, in the Voice page's order", () => {
    expect(TRADE_MODULE_IDS).toEqual(["insurance_pc", "events"]);
    expect(Object.keys(TRADE_MODULES).sort()).toEqual(["events", "insurance_pc"]);
    for (const id of TRADE_MODULE_IDS) expect(TRADE_MODULES[id].id).toBe(id);
  });
  it("the two headings, word for word (spec section 5.2)", () => {
    expect(TRADE_MODULES.insurance_pc.heading).toBe("TRADE RULES — INSURANCE (PROPERTY AND CASUALTY):");
    expect(TRADE_MODULES.events.heading).toBe("TRADE RULES — EVENTS AND VENUES:");
  });
  it("no module and an unknown id give no lines and no stamp, together (mutation: return a stamp for an unknown id -> FAILS)", () => {
    for (const id of [null, undefined, "law" as TradeModuleId]) {
      expect(tradeModuleBlock(id, CTX)).toEqual([]);
      expect(tradeModuleStamp(id)).toBeNull();
    }
  });
  it("a module gives a blank line, its heading, then its own lines; its stamp is its VERSION", () => {
    const lines = tradeModuleBlock("events", CTX);
    expect(lines.slice(0, 2)).toEqual(["", "TRADE RULES — EVENTS AND VENUES:"]);
    expect(lines.slice(2)).toEqual(TRADE_MODULES.events.block(CTX));
    expect(tradeModuleStamp("events")).toEqual({ module: "events", version: TRADE_MODULES.events.version });
  });
});

describe("the text-hash pin (SD8): change a word and this fails until VERSION is bumped and a hash appended", () => {
  it("hashes 12 contexts (guards the pin from an empty context list)", () => {
    expect(PIN_CONTEXTS.length).toBe(12);
  });
  for (const id of TRADE_MODULE_IDS) {
    it(`${id}: history length is VERSION, the last entry is today's text, and no two versions share a hash (mutations: change one word in the module -> FAILS; bump VERSION without appending -> FAILS)`, () => {
      const mod = TRADE_MODULES[id];
      const history = SHA256_HISTORY[id];
      expect(Number.isInteger(mod.version) && mod.version >= 1).toBe(true);
      expect(history.length).toBe(mod.version);
      // M1: the entry exists and is a real hash BEFORE it is compared (an undefined entry must not read as a mismatch only).
      expect(history[mod.version - 1]).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(history[mod.version - 1]).toBe(moduleTextSha256(mod));
      expect(new Set(history).size).toBe(history.length);
      for (const h of history) expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
  }
  // M7: named for what it proves. Comments cannot move the hash because moduleTextSha256 reads only block()
  // and the heading; this case shows the heading is part of what it reads.
  it("the hash covers the heading as well as block() output (a one-space change to the heading moves it)", () => {
    const mod = TRADE_MODULES.events;
    expect(moduleTextSha256({ ...mod, heading: `${mod.heading} ` })).not.toBe(moduleTextSha256(mod));
  });
});
