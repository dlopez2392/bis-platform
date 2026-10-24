import { describe, it, expect } from "vitest";
import { buildKnowledgePayload, parseKnowledgePayload, knowledgeFromLive, promptKnowledge, usableHours, KNOWLEDGE_RENDERER_VERSION } from "./payload";

const SVC = { name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null,
  price_kind: "fixed" as const, amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null };
// S-47d (plan Task 10): closedDays and today are now required on every call — [] / an arbitrary date for the
// tests above this file's own "schema 2" describe block, which overrides both per case.
const INPUT = { facts: "We fix roofs.", servicesText: "Roofs", timezone: "America/Chicago",
  businessHours: { tue: [["13:00", "18:00"], ["08:00", "12:00"]] }, services: [SVC, { ...SVC, name_en: "Shave", name_es: null, price_kind: "free" as const, amount_cents: null }],
  closedDays: [], today: "2026-01-01" };

describe("buildKnowledgePayload (spec 4.2)", () => {
  it("is exactly the spec's object: fixed keys, positions 1..n, both sentences, spans sorted, no row id (mutation: drop renderer_version -> FAILS)", () => {
    const p = buildKnowledgePayload(INPUT);
    expect(Object.keys(p)).toEqual(["schema", "facts", "services_text", "timezone", "business_hours", "hours_lines", "services", "closed_days", "renderer_version"]);
    expect(p).toStrictEqual({
      schema: 2, facts: "We fix roofs.", services_text: "Roofs", timezone: "America/Chicago",
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
      closed_days: [],
      renderer_version: KNOWLEDGE_RENDERER_VERSION,
    });
    expect(KNOWLEDGE_RENDERER_VERSION).toBe(2);
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
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: [SVC], closedDays: [], today: "2026-01-01" });
    expect([r.recordable, r.listUnavailable]).toEqual([true, false]);
    expect(r.payload.services.map((s) => s.sentence_en)).toEqual(["The price for Haircut is $25."]);
  });
  it("the services read failed (null): free text and hours kept, no list, NOT recordable, list unavailable (C20; mutation: recordable true -> FAILS)", () => {
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: null, closedDays: [], today: "2026-01-01" });
    expect(r).toMatchObject({ recordable: false, listUnavailable: true, payload: { facts: "We fix roofs.", services: [], business_hours: { tue: [["08:00", "12:00"]] } } });
  });
  it("a row that cannot render (bad data) is treated as a failed read, never a throw", () => {
    const bad = { ...SVC, price_kind: "per_unit" as const, unit_en: "hour", unit_es: null };
    expect(knowledgeFromLive({ profile, timezone: "America/Chicago", services: [bad], closedDays: [], today: "2026-01-01" })).toMatchObject({ recordable: false, listUnavailable: true, payload: { services: [] } });
  });
  it("an EMPTY list read is not a failure: recordable, list available (C20: today's price line; mutation: treat [] as a failed read -> FAILS)", () => {
    expect(knowledgeFromLive({ profile, timezone: "America/Chicago", services: [], closedDays: [], today: "2026-01-01" })).toMatchObject({ recordable: true, listUnavailable: false });
  });
  it("a stored row's id, account and created_at never enter the payload", () => {
    const row = { ...SVC, id: "11111111-1111-1111-1111-111111111111", account_id: "acc", position: 9, created_at: "2027-01-01T00:00:00Z" };
    const s = knowledgeFromLive({ profile, timezone: "America/Chicago", services: [row], closedDays: [], today: "2026-01-01" }).payload.services[0]!;
    expect(Object.keys(s).sort()).toEqual(["amount_cents", "amount_max_cents", "description_en", "description_es", "name_en", "name_es",
      "position", "price_kind", "sentence_en", "sentence_es", "unit_en", "unit_es"]);
    expect(s.position).toBe(1);
  });
});

describe("promptKnowledge", () => {
  it("an empty list and no hours give nulls, so the prompt is byte-identical (C3)", () => {
    const p = buildKnowledgePayload({ ...INPUT, businessHours: null, services: [] });
    expect(promptKnowledge(p)).toEqual({ facts: "We fix roofs.", services: "Roofs", businessHours: null, priceList: null, closedDays: null });
  });
  it("a list gives name, descriptions and both sentences only", () => {
    expect(promptKnowledge(buildKnowledgePayload(INPUT)).priceList![0]).toStrictEqual({
      name_en: "Haircut", name_es: "Corte", description_en: "Wash and cut.", description_es: null,
      sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte es $25." });
  });
});

// S-47d (spec 4.2): schema 2 carries the upcoming closed days, each with the line she reads.
describe("the knowledge payload, schema 2 (S-47d)", () => {
  const TODAY = "2026-12-22";
  const XMAS = { starts_on: "2026-12-24", ends_on: "2026-12-25", reason: "holiday" as const };
  const NEW_YEAR = { starts_on: "2026-12-28", ends_on: "2027-01-01", reason: "vacation" as const };
  const XMAS_LINE = { ...XMAS, line: "- Thursday, December 24 to Friday, December 25, 2026 (holiday)" };
  const NEW_YEAR_LINE = { ...NEW_YEAR, line: "- Monday, December 28, 2026 to Friday, January 1, 2027 (vacation)" };
  type Range = { starts_on: string; ends_on: string; reason: "holiday" | "vacation" | "other" | null };
  const withoutClosedDays = <T extends { closed_days?: unknown }>(o: T): Omit<T, "closed_days"> => {
    const c: Partial<T> = { ...o };
    delete c.closed_days;
    return c as Omit<T, "closed_days">;
  };
  const built = (closedDays: readonly Range[]) => buildKnowledgePayload({ ...INPUT, closedDays, today: TODAY });

  it("a build writes schema 2 and renderer_version 2, closed_days before renderer_version, each range by its fields (mutation: closed_days after renderer_version -> FAILS)", () => {
    const row = { ...NEW_YEAR, id: "11111111-1111-1111-1111-111111111111", account_id: "acc", created_by: "user_1", created_at: "2026-12-01T00:00:00Z" };
    const p = built([row, XMAS]);
    expect(p.schema).toBe(2);
    expect(p.renderer_version).toBe(2);
    expect(Object.keys(p).slice(-2)).toEqual(["closed_days", "renderer_version"]);
    expect(p.closed_days).toStrictEqual([XMAS_LINE, NEW_YEAR_LINE]);
    expect(Object.keys(p.closed_days[1]!)).toEqual(["starts_on", "ends_on", "reason", "line"]);
  });
  it("drops ranges that ended before today, keeps one ending today", () => {
    const past = { starts_on: "2026-12-18", ends_on: "2026-12-21", reason: null };
    const endsToday = { starts_on: "2026-12-21", ends_on: "2026-12-22", reason: null };
    expect(built([past, endsToday]).closed_days.map((d) => d.starts_on)).toEqual(["2026-12-21"]);
  });
  it("orders by starts_on, then ends_on, whatever the input order (deterministic)", () => {
    const a = { starts_on: "2027-02-01", ends_on: "2027-02-03", reason: null };
    const b = { starts_on: "2027-02-01", ends_on: "2027-02-01", reason: "other" as const };
    const order = (p: ReturnType<typeof built>) => p.closed_days.map((d) => `${d.starts_on}/${d.ends_on}`);
    expect(order(built([a, NEW_YEAR, b, XMAS]))).toEqual(["2026-12-24/2026-12-25", "2026-12-28/2027-01-01", "2027-02-01/2027-02-01", "2027-02-01/2027-02-03"]);
    expect(JSON.stringify(built([a, NEW_YEAR, b, XMAS]))).toBe(JSON.stringify(built([XMAS, b, NEW_YEAR, a])));
  });
  it("keeps at most 20, the soonest (mutation: no cap -> FAILS)", () => {
    const many = Array.from({ length: 25 }, (_v, i) => {
      const k = `2027-03-${String(25 - i).padStart(2, "0")}`;
      return { starts_on: k, ends_on: k, reason: null };
    });
    const p = built(many);
    expect(p.closed_days.length).toBe(20);
    expect([p.closed_days[0]!.starts_on, p.closed_days[19]!.starts_on]).toEqual(["2027-03-01", "2027-03-20"]);
  });
  it("round-trips through JSON and through jsonb's key order", () => {
    const p = built([XMAS, NEW_YEAR]);
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(p)))).toStrictEqual(p);
    const reorder = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0)));
    const jsonb = { ...reorder(p as unknown as Record<string, unknown>), closed_days: p.closed_days.map((d) => reorder(d as unknown as Record<string, unknown>)) };
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(jsonb)))).toStrictEqual(p);
  });
  it("a schema-1 payload stored before S-47d still reads, with closed_days [] (mutation: refuse schema 1 -> FAILS)", () => {
    const rest = withoutClosedDays(buildKnowledgePayload(INPUT));
    const stored = { ...rest, schema: 1, renderer_version: 1 };
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(stored)))).toStrictEqual({ ...rest, schema: 1, closed_days: [], renderer_version: 1 });
  });
  const P2 = built([XMAS]);
  const P2_NO_DAYS = withoutClosedDays(P2);
  it.each([
    ["schema 2 without closed_days", P2_NO_DAYS],
    ["schema 1 WITH closed_days (no build wrote one)", { ...P2, schema: 1 }],
    ["closed_days that is not an array", { ...P2, closed_days: {} }],
    ["a range with a reason outside the list", { ...P2, closed_days: [{ ...XMAS_LINE, reason: "storm" }] }],
    ["a range with no line", { ...P2, closed_days: [XMAS] }],
    ["a range whose starts_on is not a string", { ...P2, closed_days: [{ ...XMAS_LINE, starts_on: 20261224 }] }],
    ["a range that is not an object", { ...P2, closed_days: ["- Thursday"] }],
    ["schema 3", { ...P2, schema: 3 }],
  ])("refuses %s", (_n, raw) => {
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(raw)))).toBeNull();
  });
  it("a range with a null reason is accepted", () => {
    const p = built([{ ...XMAS, reason: null }]);
    expect(parseKnowledgePayload(JSON.parse(JSON.stringify(p)))).toStrictEqual(p);
  });

  const profile = { facts: "We fix roofs.", services: "Roofs", business_hours: null };
  it("knowledgeFromLive: a FAILED closed-days read (null) is not recordable and carries none (C20's rule; mutation: recordable true -> FAILS)", () => {
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: [SVC], closedDays: null, today: TODAY });
    expect([r.recordable, r.listUnavailable, r.closedDaysUnavailable]).toEqual([false, false, true]);
    expect(r.payload.closed_days).toEqual([]);
    expect(r.payload.services.length).toBe(1);
  });
  it("knowledgeFromLive: read ranges reach the payload; an empty read is recordable", () => {
    const r = knowledgeFromLive({ profile, timezone: "America/Chicago", services: [SVC], closedDays: [XMAS], today: TODAY });
    expect([r.recordable, r.closedDaysUnavailable]).toEqual([true, false]);
    expect(r.payload.closed_days).toStrictEqual([XMAS_LINE]);
    expect(knowledgeFromLive({ profile, timezone: "America/Chicago", services: [], closedDays: [], today: TODAY }))
      .toMatchObject({ recordable: true, closedDaysUnavailable: false, payload: { closed_days: [] } });
  });
  it("knowledgeFromLive: both reads failed keeps both flags", () => {
    expect(knowledgeFromLive({ profile, timezone: "America/Chicago", services: null, closedDays: null, today: TODAY }))
      .toMatchObject({ recordable: false, listUnavailable: true, closedDaysUnavailable: true, payload: { closed_days: [], services: [] } });
  });
  it("promptKnowledge: closedDays is null when there are none, else the stored lines", () => {
    expect(promptKnowledge(built([])).closedDays).toBeNull();
    expect(promptKnowledge(built([XMAS, NEW_YEAR])).closedDays).toStrictEqual([XMAS_LINE, NEW_YEAR_LINE]);
  });
});
