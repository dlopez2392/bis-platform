import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TRADES, TRADE_ENTRIES, TRADE_GROUPS, TRADE_OTHER_MAX, tradeEntry, tradeVerdict, creatableTradeKeys,
  checkTradeChoice, sofiaGate, canUseSofia,
} from "./trades";

/** The spec's section 3 table, key and verdict, in its order. A changed verdict must change this list
 *  (a dated owner decision, V3) - the module cannot drift from the spec silently. */
const SPEC: [string, string][] = [
  ["hvac", "allowed"], ["plumbing", "allowed"], ["electrical", "allowed"], ["roofing", "allowed"],
  ["landscaping", "allowed"], ["pool", "allowed"], ["pest_control", "allowed"], ["cleaning", "allowed"],
  ["painting", "allowed"], ["remodeling", "allowed"], ["woodworking", "allowed"], ["handyman", "allowed"],
  ["auto", "allowed"], ["beauty", "allowed"], ["fitness", "allowed"], ["insurance", "allowed"],
  ["real_estate", "allowed"], ["events", "allowed"], ["law", "held"], ["tax", "held"],
  ["restaurant", "crm_only"], ["child_care", "crm_only"], ["medical", "held"], ["dental", "held"],
  ["therapy", "held"], ["chiropractic", "held"], ["other_health", "held"], ["adult_day_care", "turned_away"],
  ["home_health", "turned_away"], ["other", "allowed"],
];

describe("the trade list (spec section 3)", () => {
  it("is the spec's 30 keys with the spec's verdicts, in its order (mutation: make 'law' allowed -> FAILS)", () => {
    expect(TRADES.map((e) => [e.key, e.verdict])).toEqual(SPEC);
  });

  it("every entry has an English and a Spanish label, and a group that exists", () => {
    const groups = new Set(TRADE_GROUPS.map((g) => g.key));
    for (const e of TRADE_ENTRIES) {
      expect(e.label.en.trim(), e.key).not.toBe("");
      expect(e.label.es.trim(), e.key).not.toBe("");
      expect(groups.has(e.group), e.key).toBe(true);
    }
    for (const g of TRADE_GROUPS) expect(TRADE_ENTRIES.some((e) => e.group === g.key), g.key).toBe(true);
  });

  it("held and turned-away entries carry an en/es reason; creatable ones carry none (mutation: drop dental's reason -> FAILS)", () => {
    for (const e of TRADE_ENTRIES) {
      if (e.verdict === "held" || e.verdict === "turned_away") {
        expect(e.reason?.en.trim(), e.key).toBeTruthy();
        expect(e.reason?.es.trim(), e.key).toBeTruthy();
      } else {
        expect(e.reason, e.key).toBeUndefined();
      }
    }
  });

  it("the Spanish reasons are in usted (mutation: 'puedes' for 'podemos'-style tu forms -> FAILS)", () => {
    for (const e of TRADE_ENTRIES) {
      if (e.reason) expect(e.reason.es, e.key).not.toMatch(/\b(puedes|tienes|quieres|elige|escribe)\b/i);
    }
  });

  it("the creatable keys are every allowed and crm_only key, other included - 21 of them", () => {
    expect(creatableTradeKeys()).toEqual(SPEC.filter(([, v]) => v === "allowed" || v === "crm_only").map(([k]) => k));
    expect(creatableTradeKeys()).toHaveLength(21);
  });
});

describe("migration 0101 and the module cannot drift (spec section 4)", () => {
  it("accounts_trade_check lists exactly creatableTradeKeys() (mutation: add 'law' to the migration's list, or make 'tax' allowed here -> FAILS)", () => {
    const file = path.resolve(__dirname, "../../../../../packages/db/supabase/migrations/0101_account_trade.sql");
    const sql = fs.readFileSync(file, "utf8");
    const list = /constraint accounts_trade_check check \(trade is null or trade in \(([^)]*)\)\)/.exec(sql);
    expect(list, "accounts_trade_check's list not found").not.toBeNull();
    const keys = [...list![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    expect([...keys].sort()).toEqual([...creatableTradeKeys()].sort());
  });
});

describe("tradeEntry / tradeVerdict", () => {
  it("finds a key, and answers null for a missing or unknown one", () => {
    expect(tradeEntry("hvac")?.label.en).toBe("Heating and air conditioning");
    expect(tradeVerdict("adult_day_care")).toBe("turned_away");
    for (const k of [null, undefined, "", "HVAC", "unknown"]) expect(tradeEntry(k)).toBeNull();
  });
});

describe("checkTradeChoice (the server's validation, spec 5.1)", () => {
  it("accepts an allowed trade and drops any description sent with it", () => {
    expect(checkTradeChoice("plumbing", "ignored")).toEqual({ ok: true, choice: { trade: "plumbing", tradeOther: null }, verdict: "allowed" });
  });
  it("accepts a crm_only trade, saying so", () => {
    expect(checkTradeChoice(" restaurant ", null)).toEqual({ ok: true, choice: { trade: "restaurant", tradeOther: null }, verdict: "crm_only" });
  });
  it.each([null, undefined, "", "  ", "HVAC", "nope", 5])("refuses %j as missing", (raw) => {
    expect(checkTradeChoice(raw, null)).toEqual({ ok: false, problem: "missing" });
  });
  it.each(["law", "tax", "medical", "dental", "therapy", "chiropractic", "other_health", "adult_day_care", "home_health"])(
    "refuses %s as not creatable, carrying its entry (mutation: let held through -> FAILS)", (key) => {
      const r = checkTradeChoice(key, null);
      expect(r).toMatchObject({ ok: false, problem: "not_creatable" });
      expect(r.ok === false && r.problem === "not_creatable" ? r.entry.key : null).toBe(key);
    });
  it.each([null, "", "   ", "x".repeat(TRADE_OTHER_MAX + 1)])("refuses other with description %j", (desc) => {
    expect(checkTradeChoice("other", desc)).toEqual({ ok: false, problem: "other_description" });
  });
  // The database's twin (0101 accounts_trade_other_check) must admit everything this accepts. Postgres text
  // cannot hold a NUL at all (22021, probed on the replica), so a NUL that got through here would surface as
  // a failed save - after Add company has already made the Clerk org - instead of this sentence. \s already
  // folds tab, newline and carriage return into spaces; every other control character is refused.
  it.each([0, 1, 27, 127])("refuses other with a control character (code %i) inside (mutation: drop the control-character check -> FAILS)", (code) => {
    expect(checkTradeChoice("other", `Sign${String.fromCharCode(code)}painting`)).toEqual({ ok: false, problem: "other_description" });
  });
  it("accepts other with a description, trimmed and on one line, up to 120 characters", () => {
    expect(checkTradeChoice("other", "  Marketing   and\nAI agency ")).toEqual({
      ok: true, choice: { trade: "other", tradeOther: "Marketing and AI agency" }, verdict: "allowed",
    });
    expect(checkTradeChoice("other", "x".repeat(TRADE_OTHER_MAX))).toMatchObject({ ok: true });
  });
});

describe("sofiaGate (spec 5.3)", () => {
  it("opens for an allowed trade, other included", () => {
    expect(sofiaGate("hvac")).toEqual({ ok: true });
    expect(sofiaGate("other")).toEqual({ ok: true });
    expect(canUseSofia("events")).toBe(true);
  });
  it("closes for a crm_only trade, naming it (mutation: treat crm_only as allowed -> FAILS)", () => {
    expect(sofiaGate("restaurant")).toEqual({ ok: false, reason: "crm_only", trade: "restaurant" });
    expect(sofiaGate("child_care")).toEqual({ ok: false, reason: "crm_only", trade: "child_care" });
  });
  it.each([null, undefined, "", "unknown", "law"])("closes as no_trade for %j", (t) => {
    expect(sofiaGate(t)).toEqual({ ok: false, reason: "no_trade" });
    expect(canUseSofia(t)).toBe(false);
  });
});
