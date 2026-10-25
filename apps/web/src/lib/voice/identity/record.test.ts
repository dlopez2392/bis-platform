// S-47e (E7, spec 5.10.0 as amended by plan P26, P27): which record a voice write lands on. Literal candidates.
import { describe, it, expect } from "vitest";
import { pickRecordOnNumber, leadNeedsWhoseCheck, leadWhoseStep } from "./record";
import { candidateOf, type Candidate } from "./match";
import { emptyCallState } from "../call-state";
import { withLeadWhoseAsked } from "./state";
import { LEAD_ASK_WHOSE } from "./results";

const cand = (id: string, first: string | null, last: string | null, emailKey: string | null = null): Candidate =>
  candidateOf({ id, first_name: first, last_name: last, email_key: emailKey });
type Input = Parameters<typeof pickRecordOnNumber>[0];
const pick = (onNumber: Candidate[], over: Partial<Input> = {}) =>
  pickRecordOnNumber({ onNumber, truncated: false, name: null, email: null, confirmedId: null, ...over });

const DAN = cand("d", "Dan", "Lopez");
const ANA = cand("a", "Ana", "Prueba", "ana@x.com");
const BETO = cand("b", "Beto", "Prueba");

describe("pickRecordOnNumber: nobody on the number", () => {
  it("is today's path", () => {
    expect(pick([], { name: "Ana Prueba" })).toEqual({ kind: "today" });
  });
});

describe("pickRecordOnNumber: ONE contact, no forSomeoneElse", () => {
  it("a sole 'Caller' placeholder: any name is today's path", () => {
    expect(pick([cand("c", "Caller", null)], { name: "Ana Prueba" })).toEqual({ kind: "today" });
  });
  it("the same name, or its first name alone, is today's path", () => {
    expect(pick([DAN], { name: "Dan Lopez" })).toEqual({ kind: "today" });
    expect(pick([DAN], { name: "Dan" })).toEqual({ kind: "today" });
  });
  it("every record word spoken ('María García López' for a sole 'María García') is today's path (P26)", () => {
    expect(pick([cand("m", "María", "García")], { name: "María García López" })).toEqual({ kind: "today" });
  });
  it("a record of a first name alone and the full name spoken is today's path", () => {
    expect(pick([cand("d", "Dan", null)], { name: "Dan Lopez" })).toEqual({ kind: "today" });
  });
  it("a different name asks whose it is (mutation: today's S20 create -> FAILS)", () => {
    expect(pick([DAN], { name: "Daniel Lopez" })).toEqual({ kind: "ask_whose" });
    expect(pick([cand("r", "Roberto", "Prueba")], { name: "Beto Prueba" })).toEqual({ kind: "ask_whose" });
  });
  it("no name at all is today's path", () => {
    expect(pick([DAN])).toEqual({ kind: "today" });
    expect(pick([DAN], { name: "   " })).toEqual({ kind: "today" });
  });
});

describe("pickRecordOnNumber: ONE contact, the caller answered forSomeoneElse", () => {
  it("true creates, even when the name agrees (a son 'José Garza' beside a sole 'José Luis Garza')", () => {
    expect(pick([cand("f", "José Luis", "Garza")], { name: "José Garza", forSomeoneElse: true })).toEqual({ kind: "create" });
    expect(pick([DAN], { name: "Dan Lopez", forSomeoneElse: true })).toEqual({ kind: "create" });
  });
  it("false is the sole contact whatever the name (mutation: ignore false -> FAILS)", () => {
    expect(pick([DAN], { name: "Daniel Lopez", forSomeoneElse: false })).toEqual({ kind: "existing", contactId: "d" });
  });
});

describe("pickRecordOnNumber: more than the read's limit", () => {
  it("is ambiguous, even with a name that matches", () => {
    expect(pick([ANA, BETO], { truncated: true, name: "Ana Prueba", email: "ana@x.com" })).toEqual({ kind: "ambiguous" });
    expect(pick([ANA], { truncated: true, name: "Ana Prueba" })).toEqual({ kind: "ambiguous" });
  });
});

describe("pickRecordOnNumber: several, one of them confirmed on the caller ID", () => {
  const on = [DAN, ANA, BETO];
  it("no name, a first name alone, or the full name: the confirmed contact", () => {
    expect(pick(on, { confirmedId: "a" })).toEqual({ kind: "existing", contactId: "a" });
    expect(pick(on, { confirmedId: "a", name: "Ana" })).toEqual({ kind: "existing", contactId: "a" });
    expect(pick(on, { confirmedId: "a", name: "Ana Prueba" })).toEqual({ kind: "existing", contactId: "a" });
  });
  it("forSomeoneElse false with any name: the confirmed contact", () => {
    expect(pick(on, { confirmedId: "a", name: "Carla Prueba", forSomeoneElse: false })).toEqual({ kind: "existing", contactId: "a" });
  });
  it("a name of someone else on the number wins", () => {
    expect(pick(on, { confirmedId: "a", name: "Beto Prueba" })).toEqual({ kind: "existing", contactId: "b" });
  });
  it("a confirmation that is not on this number is ignored", () => {
    expect(pick(on, { confirmedId: "zz" })).toEqual({ kind: "ask_name" });
  });
});

describe("pickRecordOnNumber: several, nobody confirmed", () => {
  it("one word asks for the full name", () => {
    expect(pick([DAN, ANA, BETO], { name: "Beto" })).toEqual({ kind: "ask_name" });
    expect(pick([DAN, ANA, BETO])).toEqual({ kind: "ask_name" });
  });
  it("a full name that is one of them is that one; a new full name creates", () => {
    expect(pick([DAN, ANA, BETO], { name: "Beto Prueba" })).toEqual({ kind: "existing", contactId: "b" });
    expect(pick([DAN, ANA, BETO], { name: "Carla Prueba" })).toEqual({ kind: "create" });
  });
  it("father 'José Luis Garza' and son 'José Garza': each name is its own (P26; mutation: pool exact and partial -> FAILS)", () => {
    const on = [cand("f", "José Luis", "Garza"), cand("s", "José", "Garza")];
    expect(pick(on, { name: "José Garza" })).toEqual({ kind: "existing", contactId: "s" });
    expect(pick(on, { name: "José Luis Garza" })).toEqual({ kind: "existing", contactId: "f" });
  });
  it("two of the same name: the email picks one, else ambiguous", () => {
    const on = [cand("a1", "Ana", "Prueba", "ana@x.com"), cand("a2", "Ana", "Prueba", "k2")];
    expect(pick(on, { name: "Ana Prueba" })).toEqual({ kind: "ambiguous" });
    expect(pick(on, { name: "Ana Prueba", email: "ana@x.com" })).toEqual({ kind: "existing", contactId: "a1" });
    expect(pick(on, { name: "Ana Prueba", email: "zed@x.com" })).toEqual({ kind: "ambiguous" });
  });
});

describe("leadNeedsWhoseCheck", () => {
  it("asks only once, only unanswered, only with a name", () => {
    const s = emptyCallState();
    expect(leadNeedsWhoseCheck(withLeadWhoseAsked(s), "Ana Prueba", undefined)).toBe(false);
    expect(leadNeedsWhoseCheck(s, "Ana Prueba", false)).toBe(false);
    expect(leadNeedsWhoseCheck(s, "Ana Prueba", true)).toBe(false);
    expect(leadNeedsWhoseCheck(s, undefined, undefined)).toBe(false);
    expect(leadNeedsWhoseCheck(s, "  ", undefined)).toBe(false);
    expect(leadNeedsWhoseCheck(s, "Ana Prueba", undefined)).toBe(true);
  });
});

describe("leadWhoseStep", () => {
  const ok = (candidates: Candidate[]) => ({ ok: true as const, candidates, truncated: false });
  it("a sole 'Dan Lopez' and a lead for 'Ana Prueba': the ask, and the call remembers it asked", () => {
    const step = leadWhoseStep(emptyCallState(), ok([DAN]), "Ana Prueba");
    expect(step?.result).toEqual(LEAD_ASK_WHOSE);
    expect(step?.state.identity.leadWhoseAsked).toBe(true);
  });
  it("a name that agrees, two contacts, or a failed read: no ask", () => {
    expect(leadWhoseStep(emptyCallState(), ok([cand("a", "Ana", "Prueba")]), "Ana Prueba")).toBeNull();
    expect(leadWhoseStep(emptyCallState(), ok([DAN, BETO]), "Ana Prueba")).toBeNull();
    expect(leadWhoseStep(emptyCallState(), { ok: false }, "Ana Prueba")).toBeNull();
  });
});
