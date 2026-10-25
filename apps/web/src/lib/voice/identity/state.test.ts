import { describe, it, expect } from "vitest";
import { emptyCallState } from "../call-state";
import {
  MAX_MISSES, withConfirmed, withMiss, withLocked, withMessageNameAsked, withLeadWhoseAsked, isLocked,
  confirmedFor,
} from "./state";

describe("withLeadWhoseAsked", () => {
  it("sets leadWhoseAsked and leaves the rest of identity untouched", () => {
    const before = withConfirmed(emptyCallState(), { contactId: "c1", rung: 1, by: "caller_id" });
    const after = withLeadWhoseAsked(before);
    expect(after.identity).toEqual({ ...before.identity, leadWhoseAsked: true });
    expect(before.identity.leadWhoseAsked).toBe(false);
  });
});

describe("withMiss", () => {
  it("once: misses 1, not locked", () => {
    const s = withMiss(emptyCallState());
    expect(s.identity.misses).toBe(1);
    expect(s.identity.locked).toBeNull();
  });

  it("twice: locks 'misses' (mutation: MAX_MISSES 3 -> FAILS)", () => {
    expect(MAX_MISSES).toBe(2);
    const s = withMiss(withMiss(emptyCallState()));
    expect(s.identity.misses).toBe(2);
    expect(s.identity.locked).toBe("misses");
  });

  it("clears a confirmation made by a name or a name and email (Task 6 review ruling; mutation: keep it -> FAILS)", () => {
    for (const by of ["name", "name_email"] as const) {
      const s = withMiss(withConfirmed(emptyCallState(), { contactId: "c2", rung: 1, by }));
      expect(s.identity.confirmed, by).toBeNull();
      expect(s.identity.misses, by).toBe(1);
    }
  });

  it("keeps a confirmation made by the caller ID alone", () => {
    const s = withMiss(withConfirmed(emptyCallState(), { contactId: "c1", rung: 1, by: "caller_id" }));
    expect(s.identity.confirmed).toEqual({ contactId: "c1", rung: 1, by: "caller_id" });
  });
});

describe("withLocked", () => {
  it("the first lock wins: 'cannot' then 'misses' keeps 'cannot'", () => {
    const s = withLocked(withLocked(emptyCallState(), "cannot"), "misses");
    expect(s.identity.locked).toBe("cannot");
  });

  it("isLocked reads the flag", () => {
    expect(isLocked(emptyCallState())).toBe(false);
    expect(isLocked(withLocked(emptyCallState(), "cannot"))).toBe(true);
  });
});

describe("confirmedFor", () => {
  it("true at the rung and above, false for another contact, false for a higher rung than confirmed, false for rung 3", () => {
    const s = withConfirmed(emptyCallState(), { contactId: "c1", rung: 1, by: "caller_id" });
    expect(confirmedFor(s, "c1", 1)).toBe(true);
    expect(confirmedFor(s, "c2", 1)).toBe(false);
    // rung 2 asked of a rung-1 confirmation
    expect(confirmedFor(s, "c1", 2)).toBe(false);
    expect(confirmedFor(s, "c1", 3)).toBe(false);

    const s2 = withConfirmed(emptyCallState(), { contactId: "c1", rung: 2, by: "name_email" });
    expect(confirmedFor(s2, "c1", 1)).toBe(true);
    expect(confirmedFor(s2, "c1", 2)).toBe(true);
    expect(confirmedFor(s2, "c1", 3)).toBe(false);
  });
});

describe("withMessageNameAsked", () => {
  it("sets the flag", () => {
    expect(emptyCallState().identity.messageNameAsked).toBe(false);
    const s = withMessageNameAsked(emptyCallState());
    expect(s.identity.messageNameAsked).toBe(true);
  });
});

describe("purity — every helper returns a NEW state and leaves the old one unchanged", () => {
  it("withConfirmed", () => {
    const before = emptyCallState();
    const after = withConfirmed(before, { contactId: "c1", rung: 1, by: "caller_id" });
    expect(after).not.toBe(before);
    expect(before.identity.confirmed).toBeNull();
  });
  it("withMiss", () => {
    const before = emptyCallState();
    const after = withMiss(before);
    expect(after).not.toBe(before);
    expect(before.identity.misses).toBe(0);
  });
  it("withLocked", () => {
    const before = emptyCallState();
    const after = withLocked(before, "cannot");
    expect(after).not.toBe(before);
    expect(before.identity.locked).toBeNull();
  });
  it("withMessageNameAsked", () => {
    const before = emptyCallState();
    const after = withMessageNameAsked(before);
    expect(after).not.toBe(before);
    expect(before.identity.messageNameAsked).toBe(false);
  });
  it("withLeadWhoseAsked", () => {
    const before = emptyCallState();
    const after = withLeadWhoseAsked(before);
    expect(after).not.toBe(before);
    expect(before.identity.leadWhoseAsked).toBe(false);
  });
});
