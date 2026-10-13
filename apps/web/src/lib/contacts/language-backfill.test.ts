import { describe, it, expect } from "vitest";
import { planLanguageBackfill, planLanguageBackfillReport, backfillSql, backfillCounts, type Evidence } from "./language-backfill";

const A = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
const form = (contactId: string, at: string, locale: string | null, accountLanguage: "en" | "es" | null = null): Evidence =>
  ({ kind: "form", accountId: A, contactId, at, locale, accountLanguage });
const call = (contactId: string, at: string, callerText: string | null): Evidence => ({ kind: "call", accountId: A, contactId, at, callerText });

describe("planLanguageBackfill (spec §18.3, Q4)", () => {
  it("replays each contact's evidence OLDEST first, from forms by the page rule and calls by the strict reading (mutation: newest first -> FAILS)", () => {
    const plan = planLanguageBackfill([
      call(C1, "2026-09-05T10:00:00Z", "hello, I need an appointment please"),
      form(C1, "2026-09-01T10:00:00Z", "es"),
      form(C2, "2026-09-02T10:00:00Z", "en"),
      call(C2, "2026-09-03T10:00:00Z", "hi"),
    ]);
    expect(plan).toEqual([
      { accountId: A, contactId: C1, language: "es", source: "form", at: "2026-09-01T10:00:00.000Z" },
      { accountId: A, contactId: C1, language: "en", source: "call", at: "2026-09-05T10:00:00.000Z" },
    ]);
  });

  it("never reads calls.language: an English-only line's Spanish caller is Spanish (the evidence carries only the caller's words)", () => {
    expect(planLanguageBackfill([call(C1, "2026-09-05T10:00:00Z", "hola, necesito una cita")])[0]!.language).toBe("es");
  });

  it("a form in the account's own language, an unknown locale, or a bad id or time gives nothing (mutation: accept any uuid-ish id -> FAILS)", () => {
    expect(planLanguageBackfill([
      form(C1, "2026-09-01T10:00:00Z", "es", "es"),
      form(C1, "2026-09-01T10:00:00Z", "fr"),
      form(C1, "2026-09-01T10:00:00Z", null),
      form("x'); drop table contacts; --", "2026-09-01T10:00:00Z", "es"),
      form(C1, "not a time", "es"),
    ])).toEqual([]);
  });
});

describe("the future-date guard (0076's record_language_signal raises SQLSTATE 22023 on a p_at more than a day ahead, which would abort the whole batch)", () => {
  it("drops evidence more than a day in the future and reports how many it dropped (mutation: keep such a row -> the generated SQL contains it -> FAILS)", () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const { signals, droppedForTime } = planLanguageBackfillReport([
      form(C1, farFuture, "es"),
      form(C2, "2026-09-01T10:00:00Z", "es"),
    ]);
    expect(signals).toEqual([{ accountId: A, contactId: C2, language: "es", source: "form", at: "2026-09-01T10:00:00.000Z" }]);
    expect(droppedForTime).toBe(1);
    const sql = backfillSql(signals);
    expect(sql).not.toContain(C1);
  });

  it("planLanguageBackfill itself (not just the report) drops the same future row", () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(planLanguageBackfill([form(C1, farFuture, "es")])).toEqual([]);
  });
});

describe("backfillSql: one statement per sign, the event written only when the language was set", () => {
  it("each statement calls record_language_signal inside the event insert's WHERE, as the system (mutation: insert the event unconditionally -> FAILS)", () => {
    const sql = backfillSql([{ accountId: A, contactId: C1, language: "es", source: "form", at: "2026-09-01T10:00:00.000Z" }]);
    expect(sql).toBe(
      "insert into public.events (account_id, type, actor_type, actor_id, payload) " +
      `select '${A}', 'contact.language_set', 'system', 'backfill-0076', jsonb_build_object('contactId', '${C1}', 'language', 'es', 'source', 'form') ` +
      `where public.record_language_signal('${A}', '${C1}', 'es', 'form', '2026-09-01T10:00:00.000Z');\n`);
  });
  it("is ASCII with no backslash, the MCP apply rule", () => {
    const sql = backfillSql(planLanguageBackfill([form(C1, "2026-09-01T10:00:00Z", "es"), call(C2, "2026-09-03T10:00:00Z", "hola, necesito una cita")]));
    expect([...sql].every((ch) => ch.charCodeAt(0) < 128 && ch !== "\\")).toBe(true);
  });
  it("counts what it will do", () => {
    const plan = planLanguageBackfill([form(C1, "2026-09-01T10:00:00Z", "es"), call(C1, "2026-09-05T10:00:00Z", "hello, I need an appointment please")]);
    expect(backfillCounts(plan)).toEqual({ contacts: 1, signals: 2, es: 1, en: 1, form: 1, call: 1 });
  });
});
