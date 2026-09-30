import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConsentHistoryRow } from "@bis/db";

// Same repo-root resolution scans.test.ts uses (same directory depth).
const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));

const db = vi.hoisted(() => ({ readConsentHistory: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { textsViewOf, howOf, readTextsView, RESUMABLE_METHODS } from "./texts-view";

let n = 0;
const row = (action: ConsentHistoryRow["action"], method: ConsentHistoryRow["method"], at: string, evidence: Record<string, unknown> = {}): ConsentHistoryRow =>
  ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, action, method, occurred_at: at, evidence, note: null, actor_id: null });
const OK = { unconfirmed: false };

describe("textsViewOf — spec §6's Texts row, in the gate's order (plan G18)", () => {
  it("no textable number is no row at all (mutation: allowed → FAILS)", () => {
    expect(textsViewOf([], null)).toEqual({ kind: "no_number" });
  });

  it("a keyword stop reads 'they texted …' in the spaced spelling, and staff may NOT resume it (choice 19; mutation: canResume for every stop → FAILS)", () => {
    const stop = row("revoked", "keyword", "2026-10-03T15:00:00Z", { keyword: "OPTOUT" });
    expect(textsViewOf([stop], OK)).toEqual({
      kind: "stopped", eventId: stop.id, since: stop.occurred_at, how: { kind: "keyword", word: "OPT OUT" }, canResume: false,
    });
  });

  it("a staff stop and a confirmed free-text stop may be resumed; a carrier stop may not (mutation: add carrier_block to RESUMABLE_METHODS → FAILS)", () => {
    expect((textsViewOf([row("revoked", "staff", "2026-10-03T15:00:00Z")], OK) as { canResume: boolean }).canResume).toBe(true);
    const confirmed = row("revoked", "free_text", "2026-10-03T15:00:00Z", { excerpt: "ya no me manden mensajes", actorName: "Ana" });
    expect(textsViewOf([confirmed], OK)).toMatchObject({ how: { kind: "free_text", excerpt: "ya no me manden mensajes", by: "Ana" }, canResume: true });
    expect(textsViewOf([row("revoked", "carrier_block", "2026-10-03T15:00:00Z")], OK)).toMatchObject({ how: { kind: "carrier" }, canResume: false });
    expect([...RESUMABLE_METHODS].sort()).toEqual(["backfill_0049", "free_text", "staff"]);
  });

  it("a hold shows what they wrote; a hold beats the Check number state (mutation: check the flag first → check_number, FAILS)", () => {
    const hold = row("held", "free_text", "2026-10-03T15:00:00Z", { excerpt: "remove me please" });
    expect(textsViewOf([hold], { unconfirmed: true })).toEqual({ kind: "held", eventId: hold.id, since: hold.occurred_at, excerpt: "remove me please" });
  });

  it("Check number shows only while nothing stops or holds the number (mutation: never show it → allowed, FAILS)", () => {
    expect(textsViewOf([], { unconfirmed: true })).toEqual({ kind: "check_number" });
  });

  it("allowed carries the newest deciding row's id for the next action's compare-and-set, never a grant's (plan G6; mutation: newestId from rows[0] → the grant, FAILS)", () => {
    const stop = row("revoked", "keyword", "2026-10-01T10:00:00Z");
    const lift = row("resubscribed", "start_keyword", "2026-10-02T10:00:00Z");
    const grant = row("granted", "form", "2026-10-03T10:00:00Z");
    expect(textsViewOf([grant, lift, stop], OK)).toEqual({ kind: "allowed", newestId: lift.id });
    expect(textsViewOf([], OK)).toEqual({ kind: "allowed", newestId: null });
  });

  it("howOf maps the unsubscribe methods to the link and 0049 to 'you recorded it' (mutation: fall through to carrier → FAILS)", () => {
    expect(howOf(row("revoked", "one_click", "2026-10-03T15:00:00Z"))).toEqual({ kind: "unsubscribe_link" });
    expect(howOf(row("revoked", "backfill_0049", "2026-10-03T15:00:00Z"))).toEqual({ kind: "staff" });
    expect(howOf(row("revoked", "backfill_telnyx", "2026-10-03T15:00:00Z"))).toEqual({ kind: "carrier" });
  });
});

describe("readTextsView — the Check number rule PR-1's page tests pinned, now on the function the page calls (review R3-I7)", () => {
  beforeEach(() => { db.readConsentHistory.mockReset().mockResolvedValue([]); });

  it("a stored number that will not parse is no row, and the ledger is not read (mutation: read the ledger with the raw phone → FAILS)", async () => {
    expect(await readTextsView({} as never, "a1", { phone: "call me", phone_country_unconfirmed: false })).toEqual({ kind: "no_number" });
    expect(db.readConsentHistory).not.toHaveBeenCalled();
  });

  it("a number that reads both ways is Check number even with the flag false — flag OR the number ([contactId]/page.test.ts's case, moved; mutation: pass the flag alone → FAILS)", async () => {
    expect(await readTextsView({} as never, "a1", { phone: "55 1234 5678", phone_country_unconfirmed: false })).toEqual({ kind: "check_number" });
  });

  it("the flag alone raises it too; a plainly US number with no flag is Allowed, read under its E.164 key (mutation: ignore the flag → FAILS; key the read by the phone as stored → FAILS)", async () => {
    expect(await readTextsView({} as never, "a1", { phone: "(956) 292-1696", phone_country_unconfirmed: true })).toEqual({ kind: "check_number" });
    expect(await readTextsView({} as never, "a1", { phone: "(956) 292-1696", phone_country_unconfirmed: false })).toEqual({ kind: "allowed", newestId: null });
    expect(db.readConsentHistory).toHaveBeenLastCalledWith({}, "a1", "sms", "+19562921696");
  });
});

describe("RESUMABLE_METHODS stays identical to 0055's staff-Resume rule (choice 19)", () => {
  // The exact branch: `elsif p_action = 'resubscribed' and p_method = 'staff' then
  // v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in (...)`.
  // Extracted from the migration text itself, never re-typed, so a change to
  // either side of the parity is what makes this fail — never a copy/paste of
  // the same literal into both places.
  function priorMethodsForStaffResume(sql: string): string[] {
    const branch = sql.match(
      /p_action = 'resubscribed' and p_method = 'staff' then\s*\n\s*v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in \(([^)]*)\)/,
    );
    if (!branch) throw new Error("could not find 0055's staff-Resume branch");
    return [...branch[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  }

  it("extracts exactly the three methods 0055 names (mutation: change the extractor's regex group to grab nothing → the SQL literal test below FAILS)", () => {
    const sample = `
      elsif p_action = 'resubscribed' and p_method = 'staff' then
        v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'free_text', 'backfill_0049');`;
    expect(priorMethodsForStaffResume(sample)).toEqual(["staff", "free_text", "backfill_0049"]);
  });

  it("a changed SQL list makes the extractor return the changed list, not the old one (mutation: hardcode the extractor's return → this FAILS on the 'x' it should see)", () => {
    const sample = `
      elsif p_action = 'resubscribed' and p_method = 'staff' then
        v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'x');`;
    expect(priorMethodsForStaffResume(sample)).toEqual(["staff", "x"]);
  });

  it("0055_consent_writes.sql's staff-Resume list equals RESUMABLE_METHODS, as a set (mutation: add a method to RESUMABLE_METHODS in texts-view.ts → FAILS)", () => {
    const sql = readFileSync(
      join(REPO, "packages", "db", "supabase", "migrations", "0055_consent_writes.sql"), "utf-8",
    );
    const fromSql = priorMethodsForStaffResume(sql);
    expect([...fromSql].sort()).toEqual([...RESUMABLE_METHODS].sort());
  });
});
