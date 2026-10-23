import { describe, it, expect, vi, beforeEach } from "vitest";

// Bare factory: every @bis/db value save.ts calls is listed, so an unlisted call throws instead of passing.
const db = vi.hoisted(() => ({
  getVoiceProfile: vi.fn(), listVoiceServices: vi.fn(), readAccountTimezone: vi.fn(),
  getLatestKnowledgeVersion: vi.fn(), saveVoiceKnowledge: vi.fn(),
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

  it("second account: every read and the RPC name the given account and no other (mutation: a fixed id -> FAILS)", async () => {
    await saveKnowledgeParts(CLIENT, "acc-two", "user_1", { facts: "x" });
    for (const f of [db.getVoiceProfile, db.listVoiceServices, db.readAccountTimezone, db.getLatestKnowledgeVersion, db.saveVoiceKnowledge]) {
      expect(f.mock.calls.map((c) => c[1])).toEqual(["acc-two"]);
      expect(f.mock.calls.map((c) => c[0])).toEqual([CLIENT]);
    }
  });
});
