import { describe, it, expect, vi, beforeEach } from "vitest";

// Bare factory: every @bis/db value save.ts calls is listed, so an unlisted call throws instead of passing.
const db = vi.hoisted(() => ({
  getVoiceProfile: vi.fn(), listVoiceServices: vi.fn(), readAccountTimezone: vi.fn(),
  getLatestKnowledgeVersion: vi.fn(), saveVoiceKnowledge: vi.fn(),
  listClosedDaysFrom: vi.fn(),
}));
vi.mock("@bis/db", () => db);

import { saveKnowledgeParts } from "./save";

const CLIENT = { svc: true } as never;
const PROFILE = { facts: "We fix roofs.", services: "Roofs and gutters", business_hours: { mon: [["08:00", "17:00"]] } };
const ROWS = [
  { id: "r1", account_id: "acc", position: 1, created_at: "x", name_en: "Inspection", name_es: "Inspección",
    description_en: null, description_es: null, price_kind: "fixed", amount_cents: 9900, amount_max_cents: null, unit_en: null, unit_es: null },
];
const STORED_SERVICES = [{
  position: 1, name_en: "Inspection", name_es: "Inspección", description_en: null, description_es: null, price_kind: "fixed",
  amount_cents: 9900, amount_max_cents: null, unit_en: null, unit_es: null,
  sentence_en: "The price for Inspection is $99.", sentence_es: "El precio de Inspección es $99.",
}];

beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  db.getVoiceProfile.mockResolvedValue(PROFILE);
  db.listVoiceServices.mockResolvedValue(ROWS);
  db.readAccountTimezone.mockResolvedValue("America/Chicago");
  db.getLatestKnowledgeVersion.mockResolvedValue(4);
  db.saveVoiceKnowledge.mockResolvedValue({ status: "ok", version: 5 });
  // S-47d: no closed days planned, the default for an account that has never touched the switch.
  db.listClosedDaysFrom.mockResolvedValue([]);
});

type Sent = { actor: string; parts: Record<string, unknown>; payload: Record<string, unknown>; baseVersion: number };
const sent = (i = 0) => db.saveVoiceKnowledge.mock.calls[i]![2] as Sent;

describe("saveKnowledgeParts (spec 4.1, 5.7; SD10)", () => {
  it("an hours part: the payload is the STORED state with only the hours laid over (mutation: build services from [] -> FAILS)", async () => {
    const hours = { tue: [["09:00", "12:00"]] as [string, string][] };
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { business_hours: hours })).toEqual({ ok: true, version: 5 });
    expect(db.saveVoiceKnowledge).toHaveBeenCalledTimes(1);
    expect(db.saveVoiceKnowledge.mock.calls[0]![0]).toBe(CLIENT);
    expect(db.saveVoiceKnowledge.mock.calls[0]![1]).toBe("acc");
    const s = sent();
    expect(s.actor).toBe("user_1");
    expect(s.parts).toEqual({ business_hours: hours });
    expect(s.payload.facts).toBe("We fix roofs.");
    expect(s.payload.services_text).toBe("Roofs and gutters");
    expect(s.payload.timezone).toBe("America/Chicago");
    expect(s.payload.business_hours).toEqual({ tue: [["09:00", "12:00"]] });
    expect(s.payload.services).toEqual(STORED_SERVICES);
  });

  it("clearing the hours lays NULL over the stored hours (mutation: parts.business_hours ?? stored -> FAILS)", async () => {
    await saveKnowledgeParts(CLIENT, "acc", "user_1", { business_hours: null });
    expect(sent().parts).toEqual({ business_hours: null });
    expect(sent().payload.business_hours).toBeNull();
    expect(sent().payload.hours_lines).toBeNull();
  });

  it("a services part replaces the stored list in the payload, and the stored hours and text stay", async () => {
    const services = [{ name_en: "Gutter clean", name_es: null, description_en: null, description_es: null,
      price_kind: "free" as const, amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null }];
    await saveKnowledgeParts(CLIENT, "acc", "user_1", { services });
    expect(sent().parts).toEqual({ services });
    expect(sent().payload.services).toEqual([{ ...services[0], position: 1,
      sentence_en: "There is no charge for Gutter clean.", sentence_es: "Gutter clean no tiene costo." }]);
    expect(sent().payload.business_hours).toEqual({ mon: [["08:00", "17:00"]] });
    expect(sent().payload.facts).toBe("We fix roofs.");
  });

  it("a facts and services-text part lays both over, and the stored list stays", async () => {
    await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "New facts.", services_text: "New text" });
    expect(sent().payload.facts).toBe("New facts.");
    expect(sent().payload.services_text).toBe("New text");
    expect(sent().payload.services).toEqual(STORED_SERVICES);
  });

  it("baseVersion is the version read just before the save, 0 when there is none (mutation: a constant 0 -> FAILS)", async () => {
    await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" });
    expect(sent().baseVersion).toBe(4);
    db.getLatestKnowledgeVersion.mockResolvedValue(0);
    await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" });
    expect(sent(1).baseVersion).toBe(0);
  });

  it("stale then ok: everything is read twice, the RPC is called twice, and the retry carries the NEW reads (mutation: no retry -> FAILS)", async () => {
    db.getLatestKnowledgeVersion.mockResolvedValueOnce(4).mockResolvedValueOnce(6);
    db.getVoiceProfile.mockResolvedValueOnce(PROFILE).mockResolvedValueOnce({ ...PROFILE, facts: "Someone else's facts." });
    db.saveVoiceKnowledge.mockResolvedValueOnce({ status: "stale" }).mockResolvedValueOnce({ status: "ok", version: 7 });
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { business_hours: null })).toEqual({ ok: true, version: 7 });
    for (const f of [db.getVoiceProfile, db.listVoiceServices, db.readAccountTimezone, db.getLatestKnowledgeVersion]) {
      expect(f).toHaveBeenCalledTimes(2);
    }
    expect(db.saveVoiceKnowledge).toHaveBeenCalledTimes(2);
    expect(sent(1).baseVersion).toBe(6);
    // The other person's part survives: the retry's payload is built from the re-read, never the first read.
    expect(sent(1).payload.facts).toBe("Someone else's facts.");
    expect(sent(1).parts).toEqual({ business_hours: null });
  });

  it("stale twice: stale, after exactly two attempts (mutation: retry forever or three times -> FAILS)", async () => {
    db.saveVoiceKnowledge.mockResolvedValue({ status: "stale" });
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" })).toEqual({ ok: false, reason: "stale" });
    expect(db.saveVoiceKnowledge).toHaveBeenCalledTimes(2);
  });

  it("no_profile and invalid from the RPC are that reason, with no retry", async () => {
    db.saveVoiceKnowledge.mockResolvedValueOnce({ status: "invalid" });
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" })).toEqual({ ok: false, reason: "invalid" });
    db.saveVoiceKnowledge.mockResolvedValueOnce({ status: "no_profile" });
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" })).toEqual({ ok: false, reason: "no_profile" });
    expect(db.saveVoiceKnowledge).toHaveBeenCalledTimes(2);
  });

  it("no profile, or no zone: no_profile with NO RPC call (mutation: build with a default zone -> FAILS)", async () => {
    db.getVoiceProfile.mockResolvedValue(null);
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" })).toEqual({ ok: false, reason: "no_profile" });
    db.getVoiceProfile.mockResolvedValue(PROFILE);
    db.readAccountTimezone.mockResolvedValue(null);
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" })).toEqual({ ok: false, reason: "no_profile" });
    expect(db.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  it("a throw anywhere is failed, logged with ids only, never the message's data (mutation: log String(e) -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.listVoiceServices.mockRejectedValueOnce(new Error("listVoiceServices failed: We fix roofs."));
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "Secret fact" })).toEqual({ ok: false, reason: "failed" });
    db.saveVoiceKnowledge.mockRejectedValueOnce(new Error("saveVoiceKnowledge failed: Secret fact"));
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "Secret fact" })).toEqual({ ok: false, reason: "failed" });
    const logged = err.mock.calls.flat().join(" ");
    err.mockRestore();
    expect(logged).toContain("acc");
    expect(logged).toContain("listVoiceServices failed");
    expect(logged).toContain("saveVoiceKnowledge failed");
    expect(logged).not.toContain("We fix roofs");
    expect(logged).not.toContain("Secret fact");
  });

  it("a services part that cannot render is failed, never a throw into the action", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = [{ name_en: "X", name_es: null, description_en: null, description_es: null,
      price_kind: "fixed" as const, amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null }];
    expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { services: bad })).toEqual({ ok: false, reason: "failed" });
    err.mockRestore();
    expect(db.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  describe("insurance (C13, C21): a price is kept only by an unchanged stored row; every other priced row is after_visit", () => {
    const INSURANCE = { ...PROFILE, trade_module: "insurance_pc" };
    const svc = (o: Record<string, unknown>) => ({ name_en: "Policy review", name_es: null, description_en: null, description_es: null,
      price_kind: "after_visit" as const, amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null, ...o });
    /** The stored Inspection row (ROWS) as the card sends it back: same name, same price. */
    const INSPECTION = svc({ name_en: "Inspection", name_es: "Inspección", price_kind: "fixed", amount_cents: 9900 });

    it("a crafted priced row is SAVED as after_visit and no price is stored, in the parts or the payload (mutation: drop the insurance branch -> FAILS)", async () => {
      db.getVoiceProfile.mockResolvedValue(INSURANCE);
      const crafted = [svc({ name_en: "Crafted", price_kind: "fixed", amount_cents: 99900 })];
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { services: crafted as never })).toEqual({ ok: true, version: 5 });
      expect(sent().parts).toEqual({ services: [svc({ name_en: "Crafted" })] });
      expect(sent().payload.services).toEqual([{ ...svc({ name_en: "Crafted" }), position: 1,
        sentence_en: "The price for Crafted is given after a visit.", sentence_es: "El precio de Crafted se lo damos después de una visita." }]);
    });

    it("C21: the stored priced row RENAMED is saved as after_visit under its new name (mutation: drop the name_en comparison -> FAILS)", async () => {
      db.getVoiceProfile.mockResolvedValue(INSURANCE);
      const renamed = { ...INSPECTION, name_en: "Full inspection" };
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { services: [renamed, svc({})] as never })).toEqual({ ok: true, version: 5 });
      expect(sent().parts).toEqual({ services: [svc({ name_en: "Full inspection", name_es: "Inspección" }), svc({})] });
    });

    it("the stored priced row UNCHANGED keeps its price, beside a new after_visit row", async () => {
      db.getVoiceProfile.mockResolvedValue(INSURANCE);
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { services: [INSPECTION, svc({})] as never })).toEqual({ ok: true, version: 5 });
      expect(sent().parts).toEqual({ services: [INSPECTION, svc({})] });
    });

    it("two posted rows claiming the one stored row: the second is saved as after_visit (mutation: never consume a match -> FAILS)", async () => {
      db.getVoiceProfile.mockResolvedValue(INSURANCE);
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { services: [INSPECTION, INSPECTION] as never })).toEqual({ ok: true, version: 5 });
      expect(sent().parts).toEqual({ services: [INSPECTION, svc({ name_en: "Inspection", name_es: "Inspección" })] });
    });

    it("the rule reads the list re-read on the retry, never the first attempt's", async () => {
      db.getVoiceProfile.mockResolvedValue(INSURANCE);
      db.listVoiceServices.mockResolvedValueOnce(ROWS).mockResolvedValueOnce([]);
      db.saveVoiceKnowledge.mockResolvedValueOnce({ status: "stale" }).mockResolvedValueOnce({ status: "ok", version: 7 });
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { services: [INSPECTION] as never })).toEqual({ ok: true, version: 7 });
      expect(sent(0).parts).toEqual({ services: [INSPECTION] });
      expect(sent(1).parts).toEqual({ services: [svc({ name_en: "Inspection", name_es: "Inspección" })] });
    });

    it("off insurance a new priced row is an ordinary save, its price kept", async () => {
      const priced = [svc({ name_en: "New", price_kind: "fixed", amount_cents: 99900 })];
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { services: priced as never })).toEqual({ ok: true, version: 5 });
      expect(sent().parts).toEqual({ services: priced });
    });
  });

  it("second account: every read and the RPC name the given account and no other (mutation: a fixed id -> FAILS)", async () => {
    await saveKnowledgeParts(CLIENT, "acc-two", "user_1", { facts: "x" });
    for (const f of [db.getVoiceProfile, db.listVoiceServices, db.readAccountTimezone, db.getLatestKnowledgeVersion, db.saveVoiceKnowledge, db.listClosedDaysFrom]) {
      expect(f.mock.calls.map((c) => c[1])).toEqual(["acc-two"]);
      expect(f.mock.calls.map((c) => c[0])).toEqual([CLIENT]);
    }
  });

  describe("closed days (S-47d)", () => {
    const XMAS = { id: "cd1", account_id: "acc", starts_on: "2026-12-24", ends_on: "2026-12-25",
      reason: "holiday" as const, created_by: "owner_1", created_at: "2026-10-01T00:00:00Z" };

    it("the closed days read reaches the payload, each by the line she reads (mutation: omit closedDays from buildKnowledgePayload -> FAILS)", async () => {
      db.listClosedDaysFrom.mockResolvedValue([XMAS]);
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" })).toEqual({ ok: true, version: 5 });
      expect(sent().payload.closed_days).toEqual([
        { starts_on: "2026-12-24", ends_on: "2026-12-25", reason: "holiday", line: "- Thursday, December 24 to Friday, December 25, 2026 (holiday)" },
      ]);
    });

    it("a failed closed-days read FAILS the save — it never records a payload with none planned that the next call would contradict (mutation: ignore the throw -> FAILS)", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      db.listClosedDaysFrom.mockRejectedValue(new Error("listClosedDaysFrom failed: boom"));
      expect(await saveKnowledgeParts(CLIENT, "acc", "user_1", { facts: "x" })).toEqual({ ok: false, reason: "failed" });
      expect(db.saveVoiceKnowledge).not.toHaveBeenCalled();
      const logged = err.mock.calls.flat().join(" ");
      err.mockRestore();
      expect(logged).toContain("listClosedDaysFrom failed");
    });
  });
});
