import { describe, it, expect } from "vitest";
import {
  planLanguageBackfill, planLanguageBackfillReport, backfillSql, backfillSqlChunks, backfillCounts, type Evidence,
} from "./language-backfill";

const A = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
const C3 = "44444444-4444-4444-8444-444444444444";
const form = (contactId: string, at: string, locale: string | null, accountLanguage: "en" | "es" | null = null): Evidence =>
  ({ kind: "form", accountId: A, contactId, at, locale, accountLanguage });
const call = (contactId: string, at: string, callerText: string | null, outcome?: string | null): Evidence =>
  ({ kind: "call", accountId: A, contactId, at, callerText, outcome });

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

describe("kind is a closed set: only 'form' | 'call' ever reaches the SQL (never copied from the input verbatim)", () => {
  it("drops a quote-bearing kind and it never appears in the generated SQL (mutation: copy e.kind -> FAILS)", () => {
    const evil = "call', '2026-01-01'); drop table public.events; --";
    const { signals, dropped } = planLanguageBackfillReport([
      { kind: evil as "call", accountId: A, contactId: C1, at: "2026-09-01T10:00:00Z", callerText: "hola, necesito una cita" } as Evidence,
    ]);
    expect(signals).toEqual([]);
    expect(dropped.badKind).toBe(1);
    const sql = backfillSql(signals);
    expect(sql).toBe("");
    expect(sql).not.toContain("drop table");
  });
});

describe("the UUID check runs on every row — a malformed or upper-case id is counted, not silently dropped", () => {
  it("counts every drop by reason", () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const { signals, dropped } = planLanguageBackfillReport([
      form("X1X1X1X1-1111-4111-8111-111111111111", "2026-09-01T10:00:00Z", "es"), // badId: upper-case
      { kind: "nonsense", accountId: A, contactId: C1, at: "2026-09-01T10:00:00Z" } as unknown as Evidence, // badKind
      form(C1, farFuture, "es"), // badTime: future
      form(C1, "not a time", "es"), // badTime: non-finite
      form(C1, "2026-09-01T10:00:00Z", "fr"), // unknownLocale
      form(C1, "2026-09-01T10:00:00Z", null), // unknownLocale
      call(C1, "2026-09-01T10:00:00Z", null), // unclearCall: no text
      call(C1, "2026-09-01T10:00:00Z", "hi there, ok"), // unclearCall: ambiguous reading
      form(C2, "2026-09-01T10:00:00Z", "es"), // the one real signal
    ]);
    expect(signals).toEqual([{ accountId: A, contactId: C2, language: "es", source: "form", at: "2026-09-01T10:00:00.000Z" }]);
    expect(dropped).toEqual({ badId: 1, badKind: 1, badTime: 2, unknownLocale: 2, sameAsAccount: 0, unclearCall: 2, nonMeaningfulCall: 0 });
  });

  it("a call whose outcome is not meaningful (spam/abandoned/transferred) is dropped and counted, when the outcome is known", () => {
    const { signals, dropped } = planLanguageBackfillReport([
      call(C1, "2026-09-01T10:00:00Z", "hola, necesito una cita", "spam"),
      call(C1, "2026-09-02T10:00:00Z", "hello, I need an appointment please", "abandoned"),
      call(C2, "2026-09-01T10:00:00Z", "hola, necesito una cita", "booked"),
    ]);
    expect(signals).toEqual([{ accountId: A, contactId: C2, language: "es", source: "call", at: "2026-09-01T10:00:00.000Z" }]);
    expect(dropped.nonMeaningfulCall).toBe(2);
  });
});

describe("review M-4: every evidence row is either a signal or counted under one drop reason", () => {
  it("a form in the account's own language is counted as sameAsAccount, and evidence = signals + the sum of dropped (mutation: `continue` without counting it -> FAILS)", () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const evidence: Evidence[] = [
      form(C1, "2026-09-01T10:00:00Z", "es", "es"), // sameAsAccount
      form(C2, "2026-09-01T10:00:00Z", "en"), // sameAsAccount: English with no account language
      form(C3, "2026-09-01T10:00:00Z", "es"), // a signal
      call(C3, "2026-09-02T10:00:00Z", "hola, necesito una cita", "booked"), // a signal
      call(C3, "2026-09-03T10:00:00Z", "hi"), // unclearCall
      call(C3, "2026-09-03T10:00:00Z", "hola, necesito una cita", "spam"), // nonMeaningfulCall
      form(C1, farFuture, "es"), // badTime
      form(C1, "2026-09-01T10:00:00Z", "fr"), // unknownLocale
      form("nope", "2026-09-01T10:00:00Z", "es"), // badId
      { kind: "nonsense", accountId: A, contactId: C1, at: "2026-09-01T10:00:00Z" } as unknown as Evidence, // badKind
    ];
    const { signals, dropped } = planLanguageBackfillReport(evidence);
    expect(dropped.sameAsAccount).toBe(2);
    expect(signals.length + Object.values(dropped).reduce((a, b) => a + b, 0)).toBe(evidence.length);
  });
});

describe("the one-day future bound (0076's record_language_signal raises SQLSTATE 22023 past it, which would abort the whole batch)", () => {
  it("keeps a row about 23 hours ahead (mutation: widen ONE_DAY_MS -> FAILS)", () => {
    const soon = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    expect(planLanguageBackfill([form(C1, soon, "es")])).toHaveLength(1);
  });
  it("drops a row about 25 hours ahead (mutation: widen ONE_DAY_MS -> FAILS)", () => {
    const tooFar = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    expect(planLanguageBackfill([form(C1, tooFar, "es")])).toEqual([]);
  });
});

describe("backfillSql: one statement per sign, the event written only when the language was set, created_at pinned to the evidence time", () => {
  it("each statement calls record_language_signal inside the event insert's WHERE, as the system, and stamps created_at from the evidence (mutation: insert the event unconditionally -> FAILS; mutation: omit created_at -> FAILS)", () => {
    const sql = backfillSql([{ accountId: A, contactId: C1, language: "es", source: "form", at: "2026-09-01T10:00:00.000Z" }]);
    expect(sql).toBe(
      "insert into public.events (account_id, type, actor_type, actor_id, payload, created_at) " +
      `select '${A}', 'contact.language_set', 'system', 'backfill-0076', jsonb_build_object('contactId', '${C1}', 'language', 'es', 'source', 'form'), '2026-09-01T10:00:00.000Z' ` +
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

describe("backfillSqlChunks: splits on contact boundaries, applied in order", () => {
  it("never splits one contact's signals across two chunk files", () => {
    const plan = planLanguageBackfill([
      form(C1, "2026-09-01T10:00:00Z", "es"),
      call(C1, "2026-09-05T10:00:00Z", "hello, I need an appointment please"),
      form(C2, "2026-09-01T10:00:00Z", "es"),
      form(C3, "2026-09-01T10:00:00Z", "es"),
    ]);
    const chunks = backfillSqlChunks(plan, 2);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain(C1);
    expect(chunks[0]).toContain(C2);
    expect(chunks[0]).not.toContain(C3);
    expect(chunks[1]).toContain(C3);
    expect(chunks.join("")).toBe(backfillSql(plan));
  });
});
