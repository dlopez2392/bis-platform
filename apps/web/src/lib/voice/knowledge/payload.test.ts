import { describe, it, expect } from "vitest";
import { buildKnowledgePayload, parseKnowledgePayload, knowledgeFromLive, promptKnowledge, usableHours, KNOWLEDGE_RENDERER_VERSION } from "./payload";

const SVC = { name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null,
  price_kind: "fixed" as const, amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null };
const INPUT = { facts: "We fix roofs.", servicesText: "Roofs", timezone: "America/Chicago",
  businessHours: { tue: [["13:00", "18:00"], ["08:00", "12:00"]] }, services: [SVC, { ...SVC, name_en: "Shave", name_es: null, price_kind: "free" as const, amount_cents: null }] };

describe("buildKnowledgePayload (spec 4.2)", () => {
  it("is exactly the spec's object: fixed keys, positions 1..n, both sentences, spans sorted, no row id (mutation: drop renderer_version -> FAILS)", () => {
    const p = buildKnowledgePayload(INPUT);
    expect(Object.keys(p)).toEqual(["schema", "facts", "services_text", "timezone", "business_hours", "hours_lines", "services", "renderer_version"]);
    expect(p).toStrictEqual({
      schema: 1, facts: "We fix roofs.", services_text: "Roofs", timezone: "America/Chicago",
      business_hours: { tue: [["08:00", "12:00"], ["13:00", "18:00"]] },
      hours_lines: ["Monday: closed", "Tuesday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM", "Wednesday: closed", "Thursday: closed",
        "Friday: closed", "Saturday: closed", "Sunday: closed"],
      services: [
        { position: 1, name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null, price_kind: "fixed",
          amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null,
          sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte es $25." },
        { position: 2, name_en: "Shave", name_es: null, description_en: "Wash and cut.", description_es: null, price_kind: "free",
          amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null,
          sentence_en: "There is no charge for Shave.", sentence_es: "Shave no tiene costo." },
      ],
      renderer_version: KNOWLEDGE_RENDERER_VERSION,
    });
    expect(KNOWLEDGE_RENDERER_VERSION).toBe(1);
  });
  it("is deterministic: the same input twice is deep-equal and serialises to the same string", () => {
    expect(JSON.stringify(buildKnowledgePayload(INPUT))).toBe(JSON.stringify(buildKnowledgePayload(structuredClone(INPUT))));
  });
  it("no hours, or hours with no open day, give null hours and null lines (SD17)", () => {
    for (const businessHours of [null, undefined, {}, { mon: [] }, "nonsense"]) {
      const p = buildKnowledgePayload({ ...INPUT, businessHours });
      expect([p.business_hours, p.hours_lines]).toEqual([null, null]);
    }
    expect(usableHours({ mon: [["08:00", "12:00"]] })).toEqual({ mon: [["08:00", "12:00"]] });
  });
});

describe("parseKnowledgePayload", () => {
  it("round-trips a built payload through JSON (what a jsonb read returns)", () => {
    const p = buildKnowledgePayload(INPUT);
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(p)))).toStrictEqual(p);
  });
  it("round-trips a payload whose keys come back in jsonb's order (shortest key first, then bytewise), not build's", () => {
    const p = buildKnowledgePayload(INPUT);
    const reorder = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)));
    const jsonb = { ...reorder(p as unknown as Record<string, unknown>),
      business_hours: reorder(p.business_hours as Record<string, unknown>),
      services: p.services.map((s) => reorder(s as unknown as Record<string, unknown>)) };
    expect(Object.keys(jsonb)[0]).toBe("facts");
    expect(parseKnowledgePayload(jsonb)).toStrictEqual(p);
  });
  it.each([null, [], {}, { schema: 2 }, { ...buildKnowledgePayload(INPUT), services: [{ position: 1 }] }, { ...buildKnowledgePayload(INPUT), facts: 3 }])(
    "refuses %j (mutation: accept any object -> FAILS)", (raw) => { expect(parseKnowledgePayload(raw)).toBeNull(); });
  const P = buildKnowledgePayload(INPUT);
  it.each([
    ["positions out of order", { ...P, services: [P.services[1], P.services[0]] }],
    ["hours without their lines", { ...P, hours_lines: null }],
    ["lines without their hours", { ...P, business_hours: null }],
    ["hours that are not the normalized hours (a span that ends before it starts)", { ...P, business_hours: { tue: [["12:00", "08:00"], ["13:00", "18:00"]] } }],
    ["hours with an empty day (build never writes one)", { ...P, business_hours: { mon: [], tue: [["08:00", "12:00"], ["13:00", "18:00"]] } }],
    ["a row the shape CHECK refuses (a fixed price without its amount)", { ...P, services: [{ ...P.services[0], amount_cents: null }, P.services[1]] }],
    ["a renderer_version that is not a positive integer", { ...P, renderer_version: 0 }],
  ])("refuses a payload buildKnowledgePayload could not have built: %s", (_n, raw) => {
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(raw)))).toBeNull();
  });
});

describe("knowledgeFromLive (spec 5.5; SD9)", () => {
  const profile = { facts: "We fix roofs.", services: "Roofs", business_hours: { tue: [["08:00", "12:00"]] } };
  it("rows read: the payload carries them, is recordable, and the list is available", () => {
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: [SVC] });
    expect([r.recordable, r.listUnavailable]).toEqual([true, false]);
    expect(r.payload.services.map((s) => s.sentence_en)).toEqual(["The price for Haircut is $25."]);
  });
  it("the services read failed (null): free text and hours kept, no list, NOT recordable, list unavailable (C20; mutation: recordable true -> FAILS)", () => {
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: null });
    expect(r).toMatchObject({ recordable: false, listUnavailable: true, payload: { facts: "We fix roofs.", services: [], business_hours: { tue: [["08:00", "12:00"]] } } });
  });
  it("a row that cannot render (bad data) is treated as a failed read, never a throw", () => {
    const bad = { ...SVC, price_kind: "per_unit" as const, unit_en: "hour", unit_es: null };
    expect(knowledgeFromLive({ profile, timezone: "America/Chicago", services: [bad] })).toMatchObject({ recordable: false, listUnavailable: true, payload: { services: [] } });
  });
  it("an EMPTY list read is not a failure: recordable, list available (C20: today's price line; mutation: treat [] as a failed read -> FAILS)", () => {
    expect(knowledgeFromLive({ profile, timezone: "America/Chicago", services: [] })).toMatchObject({ recordable: true, listUnavailable: false });
  });
  it("a stored row's id, account and created_at never enter the payload", () => {
    const row = { ...SVC, id: "11111111-1111-1111-1111-111111111111", account_id: "acc", position: 9, created_at: "2027-01-01T00:00:00Z" };
    const s = knowledgeFromLive({ profile, timezone: "America/Chicago", services: [row] }).payload.services[0]!;
    expect(Object.keys(s).sort()).toEqual(["amount_cents", "amount_max_cents", "description_en", "description_es", "name_en", "name_es",
      "position", "price_kind", "sentence_en", "sentence_es", "unit_en", "unit_es"]);
    expect(s.position).toBe(1);
  });
});

describe("promptKnowledge", () => {
  it("an empty list and no hours give nulls, so the prompt is byte-identical (C3)", () => {
    const p = buildKnowledgePayload({ ...INPUT, businessHours: null, services: [] });
    expect(promptKnowledge(p)).toEqual({ facts: "We fix roofs.", services: "Roofs", businessHours: null, priceList: null });
  });
  it("a list gives name, descriptions and both sentences only", () => {
    expect(promptKnowledge(buildKnowledgePayload(INPUT)).priceList![0]).toStrictEqual({
      name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null,
      sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte es $25." });
  });
});
