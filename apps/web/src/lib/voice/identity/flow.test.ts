import { describe, it, expect } from "vitest";
import { emptyCallState, withBooking } from "../call-state";
import type { Candidate } from "./match";
import { withConfirmed, withLocked, withMessageNameAsked } from "./state";
import {
  ASK_NAME, ASK_NAME_AND_EMAIL, ASK_NAME_AGAIN, ASK_EMAIL, CONFIRMED, MISS, LOCKED, CANNOT, NOT_CONFIRMED_YET,
  MESSAGE_ASK_NAME, readFailed, notTheirs, lockedResult,
} from "./results";
import {
  findStep, confirmStep, ownsStep, findNeedsRead, messageName, messageNeedsNameCheck, messageNameStep,
  type CandidateRead,
} from "./flow";

const NEXT = "NEXT";
const ANA: Candidate = { id: "ana", words: ["ana", "prueba"], emailKey: "ana@x.com" };
const BETO: Candidate = { id: "beto", words: ["beto", "prueba"], emailKey: null };

describe("findStep (find_my_booking)", () => {
  it("two candidates, rung 1 -> ASK_NAME, state unchanged, no event", () => {
    const state = emptyCallState();
    const read: CandidateRead = { ok: true, candidates: [ANA, BETO], truncated: false };
    const step = findStep(state, 1, read, NEXT);
    expect(step.kind).toBe("answer");
    expect(step).toMatchObject({ result: ASK_NAME, event: null });
    expect(step.state).toBe(state);
  });

  it("rung 2 with an email on file -> ASK_NAME_AND_EMAIL", () => {
    const state = emptyCallState();
    const read: CandidateRead = { ok: true, candidates: [ANA, BETO], truncated: false };
    const step = findStep(state, 2, read, NEXT);
    expect(step).toMatchObject({ kind: "answer", result: ASK_NAME_AND_EMAIL, event: null });
  });

  it("one candidate, rung 1 -> lookup by caller id, confirms it", () => {
    const state = emptyCallState();
    const read: CandidateRead = { ok: true, candidates: [ANA], truncated: false };
    const step = findStep(state, 1, read, NEXT);
    expect(step.kind).toBe("lookup");
    if (step.kind !== "lookup") throw new Error("unreachable");
    expect(step.contactId).toBe("ana");
    expect(step.by).toBe("caller_id");
    expect(step.event).toBe("confirmed rung 1 by caller-id");
    expect(step.state.identity.confirmed).toEqual({ contactId: "ana", rung: 1, by: "caller_id" });
  });

  it("a state already confirmed by name -> lookup with by 'name', no read needed, no event", () => {
    const confirmed = withConfirmed(emptyCallState(), { contactId: "ana", rung: 1, by: "name" });
    const step = findStep(confirmed, 1, null, NEXT);
    expect(step).toMatchObject({ kind: "lookup", contactId: "ana", by: "name", event: null });
  });

  it("truncated -> CANNOT, locks 'cannot', event 'locked (cannot)'", () => {
    const state = emptyCallState();
    const read: CandidateRead = { ok: true, candidates: [], truncated: true };
    const step = findStep(state, 1, read, NEXT);
    expect(step.kind).toBe("answer");
    if (step.kind !== "answer") throw new Error("unreachable");
    expect(step.result).toBe(CANNOT);
    expect(step.state.identity.locked).toBe("cannot");
    expect(step.event).toBe("locked (cannot)");
  });

  it("a failed read -> readFailed(NEXT), event 'read failed', misses untouched", () => {
    const state = emptyCallState();
    const step = findStep(state, 1, null, NEXT);
    expect(step.kind).toBe("answer");
    if (step.kind !== "answer") throw new Error("unreachable");
    expect(step.result).toEqual(readFailed(NEXT));
    expect(step.event).toBe("read failed");
    expect(step.state.identity.misses).toBe(0);
  });

  it("confirmed at the rung -> lookup with NO read needed (findNeedsRead is false)", () => {
    const confirmed = withConfirmed(emptyCallState(), { contactId: "ana", rung: 1, by: "caller_id" });
    expect(findNeedsRead(confirmed, 1)).toBe(false);
    const step = findStep(confirmed, 1, null, NEXT); // read is null; must not go through readFailed
    expect(step).toMatchObject({ kind: "lookup", contactId: "ana", by: "caller_id" });
  });

  it("confirmed at rung 1, an insurance call needs rung 2 -> findNeedsRead true, asks name AND email", () => {
    const confirmed = withConfirmed(emptyCallState(), { contactId: "ana", rung: 1, by: "caller_id" });
    expect(findNeedsRead(confirmed, 2)).toBe(true);
    const read: CandidateRead = { ok: true, candidates: [ANA], truncated: false };
    const step = findStep(confirmed, 2, read, NEXT);
    expect(step).toMatchObject({ kind: "answer", result: ASK_NAME_AND_EMAIL });
  });

  it("locked -> LOCKED for a misses lock, CANNOT for a cannot lock", () => {
    const misses = withLocked(emptyCallState(), "misses");
    expect(findStep(misses, 1, null, NEXT)).toMatchObject({ kind: "answer", result: LOCKED, event: null });
    const cannot = withLocked(emptyCallState(), "cannot");
    expect(findStep(cannot, 1, null, NEXT)).toMatchObject({ kind: "answer", result: CANNOT, event: null });
  });
});

describe("confirmStep (confirm_identity)", () => {
  it("Beto by name -> CONFIRMED, event 'confirmed rung 1 by name'", () => {
    const state = emptyCallState();
    const read: CandidateRead = { ok: true, candidates: [ANA, BETO], truncated: false };
    const step = confirmStep(state, 1, read, { fullName: "Beto Prueba" }, NEXT);
    expect(step.result).toBe(CONFIRMED);
    expect(step.event).toBe("confirmed rung 1 by name");
    expect(step.state.identity.confirmed).toEqual({ contactId: "beto", rung: 1, by: "name" });
  });

  it("then Ana -> the confirmation is REPLACED by Ana, not merged (S7)", () => {
    const state = emptyCallState();
    const read: CandidateRead = { ok: true, candidates: [ANA, BETO], truncated: false };
    const first = confirmStep(state, 1, read, { fullName: "Beto Prueba" }, NEXT);
    const second = confirmStep(first.state, 1, read, { fullName: "Ana Prueba" }, NEXT);
    expect(second.result).toBe(CONFIRMED);
    expect(second.state.identity.confirmed).toEqual({ contactId: "ana", rung: 1, by: "name" });
  });

  it("'Carla Prueba' -> MISS, event 'miss 1'; the same try again -> LOCKED, event 'locked (misses)'", () => {
    const state = emptyCallState();
    const read: CandidateRead = { ok: true, candidates: [ANA, BETO], truncated: false };
    const first = confirmStep(state, 1, read, { fullName: "Carla Prueba" }, NEXT);
    expect(first.result).toBe(MISS);
    expect(first.event).toBe("miss 1");
    expect(first.state.identity.misses).toBe(1);
    const second = confirmStep(first.state, 1, read, { fullName: "Carla Prueba" }, NEXT);
    expect(second.result).toBe(LOCKED);
    expect(second.event).toBe("locked (misses)");
    expect(second.state.identity.locked).toBe("misses");
  });

  it("a name miss and an email miss on an insurance call are the SAME MISS object, toEqual the typed-out sentence (E5)", () => {
    const read: CandidateRead = { ok: true, candidates: [ANA], truncated: false };
    const nameMiss = confirmStep(emptyCallState(), 2, read, { fullName: "Carla Prueba", email: "ana@x.com" }, NEXT);
    const emailMiss = confirmStep(emptyCallState(), 2, read, { fullName: "Ana Prueba", email: "wrong@x.com" }, NEXT);
    expect(nameMiss.result).toEqual(emailMiss.result);
    expect(nameMiss.result).toEqual({
      ok: false, confirmed: false,
      next: `Say: "I couldn't find it under those details." In Spanish: "No la encontré con esos datos." You may ask them once more and call confirm_identity again. You have not been told which detail did not match, so do not say or guess.`,
    });
  });

  it("'Ana' (one word) -> ASK_NAME_AGAIN, misses untouched", () => {
    const read: CandidateRead = { ok: true, candidates: [ANA], truncated: false };
    const step = confirmStep(emptyCallState(), 1, read, { fullName: "Ana" }, NEXT);
    expect(step.result).toBe(ASK_NAME_AGAIN);
    expect(step.state.identity.misses).toBe(0);
  });

  it("rung 2 with no email given -> ASK_EMAIL, misses untouched", () => {
    const read: CandidateRead = { ok: true, candidates: [ANA], truncated: false };
    const step = confirmStep(emptyCallState(), 2, read, { fullName: "Ana Prueba" }, NEXT);
    expect(step.result).toBe(ASK_EMAIL);
    expect(step.state.identity.misses).toBe(0);
  });

  it("a failed read -> readFailed, misses untouched (S5)", () => {
    const step = confirmStep(emptyCallState(), 1, { ok: false }, {}, NEXT);
    expect(step.result).toEqual(readFailed(NEXT));
    expect(step.event).toBe("read failed");
    expect(step.state.identity.misses).toBe(0);
  });

  it("no candidate at all -> a miss (it still counts as a try)", () => {
    const read: CandidateRead = { ok: true, candidates: [], truncated: false };
    const step = confirmStep(emptyCallState(), 1, read, {}, NEXT);
    expect(step.result).toBe(MISS);
    expect(step.event).toBe("miss 1");
    expect(step.state.identity.misses).toBe(1);
  });
});

describe("ownsStep (reschedule_appointment / cancel_appointment)", () => {
  const CALLER = "+19562921696";

  it("a booking made on THIS call is owned, even with nothing confirmed and no caller id", () => {
    const state = withBooking(emptyCallState(), { id: "bk1", contactName: "X", startsAt: "s", endsAt: "e" });
    const owns = ownsStep(state, 1, { bookingId: "bk1", contactId: "anyone", contactPhone: null, callerNumber: null }, NEXT);
    expect(owns).toEqual({ owned: true });
  });

  it("locked -> lockedResult", () => {
    const state = withLocked(emptyCallState(), "misses");
    const owns = ownsStep(state, 1, { bookingId: "bk2", contactId: "c1", contactPhone: null, callerNumber: null }, NEXT);
    expect(owns).toEqual({ owned: false, result: lockedResult("misses") });
  });

  it("confirmed this contact, rung met, phone is the caller id (legacy format included) -> owned", () => {
    const state = withConfirmed(emptyCallState(), { contactId: "c1", rung: 1, by: "caller_id" });
    const owns = ownsStep(state, 1, { bookingId: "bk3", contactId: "c1", contactPhone: "(956) 292-1696", callerNumber: CALLER }, NEXT);
    expect(owns).toEqual({ owned: true });
  });

  it("phone no longer the caller id -> NOT_CONFIRMED_YET", () => {
    const state = withConfirmed(emptyCallState(), { contactId: "c1", rung: 1, by: "caller_id" });
    const owns = ownsStep(state, 1, { bookingId: "bk4", contactId: "c1", contactPhone: "+15550000000", callerNumber: CALLER }, NEXT);
    expect(owns).toEqual({ owned: false, result: NOT_CONFIRMED_YET });
  });

  it("nothing confirmed -> NOT_CONFIRMED_YET", () => {
    const owns = ownsStep(emptyCallState(), 1, { bookingId: "bk5", contactId: "c1", contactPhone: CALLER, callerNumber: CALLER }, NEXT);
    expect(owns).toEqual({ owned: false, result: NOT_CONFIRMED_YET });
  });

  it("confirmed this contact at rung 1, rung 2 required -> NOT_CONFIRMED_YET, not notTheirs (P7)", () => {
    const state = withConfirmed(emptyCallState(), { contactId: "c1", rung: 1, by: "caller_id" });
    const owns = ownsStep(state, 2, { bookingId: "bk6", contactId: "c1", contactPhone: CALLER, callerNumber: CALLER }, NEXT);
    expect(owns).toEqual({ owned: false, result: NOT_CONFIRMED_YET });
  });

  it("confirmed ANOTHER contact -> notTheirs(NEXT)", () => {
    const state = withConfirmed(emptyCallState(), { contactId: "other", rung: 2, by: "name_email" });
    const owns = ownsStep(state, 1, { bookingId: "bk7", contactId: "c1", contactPhone: CALLER, callerNumber: CALLER }, NEXT);
    expect(owns).toEqual({ owned: false, result: notTheirs(NEXT) });
  });
});

describe("messageNeedsNameCheck (take_message, spec 5.10.5, plan P6)", () => {
  it("no caller id -> false", () => {
    expect(messageNeedsNameCheck(emptyCallState(), null, {})).toBe(false);
  });
  it("already confirmed -> false", () => {
    const state = withConfirmed(emptyCallState(), { contactId: "c1", rung: 1, by: "caller_id" });
    expect(messageNeedsNameCheck(state, "+19562921696", {})).toBe(false);
  });
  it("a name was given -> false", () => {
    expect(messageNeedsNameCheck(emptyCallState(), "+19562921696", { name: "Ana Prueba" })).toBe(false);
  });
  it("nameDeclined: true -> false", () => {
    expect(messageNeedsNameCheck(emptyCallState(), "+19562921696", { nameDeclined: true })).toBe(false);
  });
  it("already asked once this call -> false", () => {
    const state = withMessageNameAsked(emptyCallState());
    expect(messageNeedsNameCheck(state, "+19562921696", {})).toBe(false);
  });
  it("otherwise -> true", () => {
    expect(messageNeedsNameCheck(emptyCallState(), "+19562921696", {})).toBe(true);
  });
  // Owner decision 2026-10-26: a message on a locked call files on no customer, so a name would pick nothing.
  it("a locked call, by misses or by cannot -> false: the name would decide nothing (mutation: drop the lock check -> FAILS)", () => {
    expect(messageNeedsNameCheck(withLocked(emptyCallState(), "misses"), "+19562921696", {})).toBe(false);
    expect(messageNeedsNameCheck(withLocked(emptyCallState(), "cannot"), "+19562921696", {})).toBe(false);
  });
});

describe("messageNameStep", () => {
  it("two real candidates -> the refusal, with messageNameAsked set", () => {
    const read: CandidateRead = { ok: true, candidates: [ANA, BETO], truncated: false };
    const step = messageNameStep(emptyCallState(), read);
    expect(step).not.toBeNull();
    expect(step!.result).toBe(MESSAGE_ASK_NAME);
    expect(step!.state.identity.messageNameAsked).toBe(true);
    expect(step!.event).toBeNull();
  });
  it("one candidate -> null (not shared, record it)", () => {
    const read: CandidateRead = { ok: true, candidates: [ANA], truncated: false };
    expect(messageNameStep(emptyCallState(), read)).toBeNull();
  });
  it("truncated -> the refusal, even with few candidates back", () => {
    const read: CandidateRead = { ok: true, candidates: [], truncated: true };
    const step = messageNameStep(emptyCallState(), read);
    expect(step).not.toBeNull();
    expect(step!.result).toBe(MESSAGE_ASK_NAME);
  });
  it("a failed read -> null (a message is never lost on our outage)", () => {
    expect(messageNameStep(emptyCallState(), { ok: false })).toBeNull();
  });
});

describe("messageName", () => {
  it("collapses whitespace and trims; empty reads as null", () => {
    expect(messageName({ name: "  Ana   Prueba  " })).toBe("Ana Prueba");
    expect(messageName({ name: "   " })).toBeNull();
    expect(messageName({})).toBeNull();
  });
  // contact-archive spec §7.3: a placeholder name is the same as none given.
  it("a placeholder name reads as null, not a name (mutation: drop the isPlaceholderName check → FAILS)", () => {
    expect(messageName({ name: "Unknown" })).toBeNull();
    expect(messageName({ name: "Unknown Caller" })).toBeNull();
    expect(messageName({ name: "Desconocido" })).toBeNull();
  });
});
