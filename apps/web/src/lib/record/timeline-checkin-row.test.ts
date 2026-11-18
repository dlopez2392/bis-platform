import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { timelineRows, timelineFailedText } from "./timeline-rows";
import { authorOf, authorMark } from "./author-mark";
import { makeTr } from "./copy";

/**
 * F-072 PR 4 (docs/superpowers/plans/2026-11-17-review-requests.md, D2 and D3): the customer's answer to the
 * after-the-job check-in on the record. The author is the CUSTOMER (the closed set of five, no sixth kind), the
 * answer is a dot and a word (DESIGN rule 3), and a "not great" row carries its To-do's state.
 */
const AT = "2026-10-17T15:00:00.000Z";
const checkin = (
  answer: "great" | "okay" | "not_great", todo: "open" | "done" | null = null,
  bookingStartsAt: string | null = "2026-10-16T15:00:00.000Z",
): TimelineEntry => ({ kind: "checkin", id: `ck-${answer}`, at: AT, contactId: "c1", checkin: { answer, bookingStartsAt, todo } }) as TimelineEntry;
const one = (e: TimelineEntry, locale: "en" | "es" = "en", pseudo = false) => {
  const tr = makeTr(locale, pseudo);
  return timelineRows([e], { zone: "America/Chicago", tr, author: { viewerId: null, names: {}, personaName: null, tr } })[0]!;
};

describe("a check-in answer's row (plan D2)", () => {
  it("is the customer's mark, with the answer as a dot and a word (mutations: the automation's mark; no status -> FAILS)", () => {
    const r = one(checkin("great"));
    expect(r.mark).toEqual({ kind: "customer", label: "Customer" });
    expect([r.verb, r.status]).toEqual(["answered the check-in", { tone: "good", word: "Great" }]);
    expect(one(checkin("okay")).status).toEqual({ tone: "muted", word: "Okay" });
    expect(one(checkin("not_great")).status).toEqual({ tone: "warn", word: "Not great" });
  });

  it("says the booking's day, and for a not-great answer the To-do's state (mutation: the To-do state on every answer -> FAILS)", () => {
    expect(one(checkin("great")).detail).toBe("Job: Oct 16, 2026");
    expect(one(checkin("not_great", "open")).detail).toBe("Job: Oct 16, 2026 · To-do open");
    expect(one(checkin("not_great", "done")).detail).toBe("Job: Oct 16, 2026 · To-do done");
    expect(one(checkin("not_great", null)).detail).toBe("Job: Oct 16, 2026");
    expect(one(checkin("okay", "open")).detail).toBe("Job: Oct 16, 2026");
    // A booking that cannot be read still shows the answer, never a blank or a broken date.
    expect(one(checkin("great", null, null)).detail).toBeNull();
  });

  it("reads in Spanish, with the customer's Spanish mark (mutation: read the words from m[...] -> English, FAILS)", () => {
    const r = one(checkin("not_great", "open"), "es");
    expect(r.mark).toEqual({ kind: "customer", label: "Cliente" });
    expect([r.verb, r.status?.word]).toEqual(["respondió cómo le fue", "No muy bien"]);
    expect(r.detail).toContain("Pendiente abierto");
    expect(r.detail).toContain("Trabajo:");
  });

  it("survives the pseudo-locale: the verb, the word, the detail and the mark all go through tr (mutation: build one without tr -> the plain string, FAILS)", () => {
    const r = one(checkin("not_great", "open"), "en", true);
    expect(r.verb).not.toBe("answered the check-in");
    expect(r.status?.word).not.toBe("Not great");
    expect(r.detail).not.toContain("To-do open");
    expect(r.detail).not.toContain("Job:");
    expect(r.mark.label).not.toBe("Customer");
  });

  it("a failed check-in read is named, in both languages", () => {
    expect(timelineFailedText(["checkins"], makeTr("en"))).toBe("Couldn't load check-in answers.");
    expect(timelineFailedText(["checkins"], makeTr("es"))).toBe("No se pudo cargar: respuestas de seguimiento.");
  });
});

describe("the closed set of author kinds still has five (DESIGN, Provenance; plan D2 and D3)", () => {
  const FIVE = ["person", "ai", "automation", "customer", "import"];
  const task = (over: Record<string, unknown>): TimelineEntry => ({ kind: "task", id: "t1", at: AT, contactId: "c1", task: {
    id: "t1", title: "x", due_at: null, completed_at: null, created_at: AT, consent_event_id: null, call_id: null,
    assigned_to: null, created_by: null, ...over } }) as unknown as TimelineEntry;

  it("a check-in answer is the customer kind, and its mark is one of the five (mutation: give the row a sixth kind -> FAILS)", () => {
    const entry = checkin("not_great", "open");
    expect(authorOf(entry)).toEqual({ kind: "customer", personId: null });
    const ctx = { viewerId: null, names: {}, personaName: null, tr: makeTr("en") };
    expect(FIVE).toContain(authorMark(entry, ctx).kind);
    expect(new Set(FIVE).size).toBe(5);
  });

  it("a To-do opened for a not-great answer is the automation's, as an expiry To-do is (mutation: drop the review_checkin_id case -> the person mark, FAILS)", () => {
    expect(authorOf(task({ review_checkin_id: "ck1" }))).toEqual({ kind: "automation", personId: null });
    // A To-do a person typed is still theirs.
    expect(authorOf(task({ created_by: "user_dan" }))).toEqual({ kind: "person", personId: "user_dan" });
  });
});
