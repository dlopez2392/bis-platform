import { describe, it, expect } from "vitest";
import { otherForSubmit, flagHintFor, flagHintText, hitsToShow, afterFailedAdd } from "./relationship-dialog";
import type { RelationshipView } from "./relationship-view";

const ANA = "abcdef12-2222-4222-8222-22222222222a";
const FRESH = { firstName: "Ana", lastName: "Ramírez", phone: "956 555 0142" };
const view = (over: Partial<RelationshipView>): RelationshipView => ({
  id: "r1", labelKey: "parent", customLabel: null, namedSide: "a", person: { id: ANA, firstName: "Ana", lastName: "Ramírez" },
  namedForm: "f", subjectForm: null, canPickUp: false, isEmergency: false, lockedFlag: null, ...over,
});
const names = { hidden: "someone not on your list", noName: "(no name)" };

describe("otherForSubmit: who the dialog sends as the other person", () => {
  it("a picked customer goes as existing; nobody picked sends nothing", () => {
    expect(otherForSubmit({ mode: "find", picked: { id: ANA }, fresh: FRESH, createdId: null })).toEqual({ kind: "existing", contactId: ANA });
    expect(otherForSubmit({ mode: "find", picked: null, fresh: FRESH, createdId: null })).toBeNull();
  });
  it("a new person goes as new, with what was typed", () => {
    expect(otherForSubmit({ mode: "new", picked: null, fresh: FRESH, createdId: null })).toEqual({ kind: "new", ...FRESH });
  });
  it("a new person the server already created goes as existing on the retry, never created twice (Task 4 review, finding 3; mutation: ignore createdId -> FAILS)", () => {
    expect(otherForSubmit({ mode: "new", picked: null, fresh: FRESH, createdId: ANA })).toEqual({ kind: "existing", contactId: ANA });
  });
});

describe("flagHintFor: the two people already have a row (Task 4 review, finding 5)", () => {
  it("picking Emergency contact for someone already related points at that row's emergency flag (mutation: always null -> FAILS)", () => {
    const mother = view({});
    expect(flagHintFor([mother], ANA, "emergency_contact", "a")).toEqual({ view: mother, flag: "isEmergency", on: false });
    expect(flagHintFor([mother], ANA, "authorized_pickup", "a")).toEqual({ view: mother, flag: "canPickUp", on: false });
  });
  it("matches the picked id in any case, as the server compares it", () => {
    expect(flagHintFor([view({})], ANA.toUpperCase(), "emergency_contact", "a")?.flag).toBe("isEmergency");
  });
  it("prefers a row that already has the flag on, and says so", () => {
    const landlord = view({ id: "r2", labelKey: "landlord" });
    const mother = view({ isEmergency: true });
    expect(flagHintFor([landlord, mother], ANA, "emergency_contact", "a")).toEqual({ view: mother, flag: "isEmergency", on: true });
  });
  it("no hint for any other label, for nobody picked, or for someone with no row yet (mutation: hint for every label -> FAILS)", () => {
    expect(flagHintFor([view({})], ANA, "caregiver", "a")).toBeNull();
    expect(flagHintFor([view({})], ANA, "parent", "b")).toBeNull();
    expect(flagHintFor([view({})], null, "emergency_contact", "a")).toBeNull();
    expect(flagHintFor([view({ person: { id: "other", firstName: "Leo", lastName: null } })], ANA, "emergency_contact", "a")).toBeNull();
  });
  it("a hidden person's row never matches: it carries no id (C5)", () => {
    expect(flagHintFor([view({ person: null })], ANA, "emergency_contact", "a")).toBeNull();
  });
});

describe("flagHintText: one short line naming the row and the flag", () => {
  it("names the row as its chip reads, with one colon only, and the flag to turn on INSTEAD, in English and Spanish (final review item 7; mutation: restore 'Already on this record: {row}' or Spanish 'ahí mismo' -> FAILS)", () => {
    const hint = { view: view({}), flag: "isEmergency" as const, on: false };
    expect(flagHintText(hint, "en", names)).toBe("Already on this record as “Mother: Ana Ramírez”. Turn on “Emergency contact” there instead.");
    expect(flagHintText(hint, "es", names)).toBe("Ya está en este registro como “Madre: Ana Ramírez”. En vez de agregar otra relación, active “Contacto de emergencia” ahí.");
  });
  it("says the flag is already on when it is (mutation: always say 'Turn on' -> FAILS)", () => {
    const hint = { view: view({ canPickUp: true }), flag: "canPickUp" as const, on: true };
    expect(flagHintText(hint, "en", names)).toBe("Already on this record as “Mother: Ana Ramírez”, with “Can pick up” on.");
  });
});

describe("hitsToShow: a result list belongs to the term it was searched for (final review item 7)", () => {
  const ana = { id: ANA, firstName: "Ana", lastName: "Ramírez", phone: null };
  it("shows nothing below two characters", () => {
    expect(hitsToShow({ term: "Ana", hits: [ana] }, "A")).toBe("idle");
  });
  it("hits for an earlier term are never shown under a new one: the list waits for its own answer (mutation: show the last answer whatever its term -> FAILS)", () => {
    expect(hitsToShow({ term: "Ana", hits: [ana] }, "Anab")).toBe("pending");
    expect(hitsToShow(null, "Ana")).toBe("pending");
  });
  it("the answer for this very term is shown, a failure included", () => {
    expect(hitsToShow({ term: "Ana", hits: [ana] }, "Ana")).toEqual([ana]);
    expect(hitsToShow({ term: "Ana", hits: "failed" }, "Ana")).toBe("failed");
  });
});

describe("afterFailedAdd: what the dialog keeps when an add fails (final review item 7)", () => {
  const start = { createdId: null, personSaved: false };
  it("a new person this call saved: retry by their id, and say they are saved", () => {
    expect(afterFailedAdd(start, "new", { contactId: ANA, created: true })).toEqual({ createdId: ANA, personSaved: true });
  });
  it("a new person who matched someone already saved: retry by their id, but never say 'saved' (mutation: personSaved whenever an id comes back -> FAILS)", () => {
    expect(afterFailedAdd(start, "new", { contactId: ANA, created: false })).toEqual({ createdId: ANA, personSaved: false });
  });
  it("a second failure on the retry keeps both: the person is still saved", () => {
    expect(afterFailedAdd({ createdId: ANA, personSaved: true }, "new", {})).toEqual({ createdId: ANA, personSaved: true });
  });
  it("nothing changes for a found customer, or when no one was made", () => {
    expect(afterFailedAdd(start, "find", { contactId: ANA, created: true })).toEqual(start);
    expect(afterFailedAdd(start, "new", {})).toEqual(start);
  });
});
