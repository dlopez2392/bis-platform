import { describe, it, expect, vi } from "vitest";
import { resolveHandoffTarget, newHandoffToken, handoffLine, transferFailedLine } from "./handoff";

describe("resolveHandoffTarget", () => {
  it("is unavailable when no number is configured — the field IS the switch", () => {
    expect(resolveHandoffTarget(null, ["+19565061545"]))
      .toEqual({ available: false, reason: "not-configured" });
  });
  it("is available when a number is set and is not ours", () => {
    expect(resolveHandoffTarget("+19562921696", ["+19565061545"]))
      .toEqual({ available: true, to: "+19562921696" });
  });
  it("REFUSES a number this account owns — transferring there loops the caller back into Sofía", () => {
    expect(resolveHandoffTarget("+19565061545", ["+19565061545"]))
      .toEqual({ available: false, reason: "own-number" });
  });
  it("compares the WHOLE number: a near-miss on either end is somebody else's phone", () => {
    // The positive fixture above (+19562921696) is six digits away from the
    // owned number, so on its own it cannot tell exact equality from a loose
    // comparison. Two near-misses are needed, not one, and that is load
    // bearing — each catches a different sloppy comparison, and neither
    // catches the other's (both verified by mutation):
    //   · one digit off at the END defeats a shared-prefix compare
    //     (startsWith / first-N digits),
    //   · a DIFFERENT number sharing the last four digits defeats the
    //     last-4 compare people reach for when a number arrives formatted.
    // Refusing either of these strands a caller who asked for a person, so
    // "close enough" is the wrong direction to be wrong in here.
    expect(resolveHandoffTarget("+19565061546", ["+19565061545"]))
      .toEqual({ available: true, to: "+19565061546" });
    expect(resolveHandoffTarget("+19565551545", ["+19565061545"]))
      .toEqual({ available: true, to: "+19565551545" });
    // …and the exact match is still refused, so this is not just "everything
    // is available now".
    expect(resolveHandoffTarget("+19565061545", ["+19565061545"]))
      .toEqual({ available: false, reason: "own-number" });
  });
  it("refuses a SECOND owned number, not only the one calls arrive on", () => {
    // refusesAlertLoop's own history: it was widened from the single resolved
    // sender to every owned number because a second, still-provisioning number
    // was an unguarded loop.
    expect(resolveHandoffTarget("+19565550111", ["+19565061545", "+19565550111"]))
      .toEqual({ available: false, reason: "own-number" });
  });
  it("is available when the owned list is empty", () => {
    expect(resolveHandoffTarget("+19562921696", []))
      .toEqual({ available: true, to: "+19562921696" });
  });
});

describe("newHandoffToken", () => {
  it("is unique across calls and shaped the way every consumer's regex expects", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newHandoffToken()));
    expect(seen.size).toBe(500);
    for (const t of seen) expect(t).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });

  /**
   * Uniqueness and character shape are NOT entropy: a monotonic counter and a
   * `Math.random().toString(36)` generator both satisfy the test above, and
   * both are guessable credentials on a route that dials a phone number at
   * the tenant's cost. Entropy is not observable from the output of a
   * finite sample, so this asserts the SOURCE instead — the CSPRNG was
   * called. That is the property that is actually checkable here.
   */
  it("draws from the CSPRNG — not a counter, not Math.random", () => {
    const uuid = vi.spyOn(crypto, "randomUUID");
    const random = vi.spyOn(Math, "random");
    try {
      const token = newHandoffToken();
      expect(uuid).toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
      expect(token).not.toContain("-");
    } finally {
      uuid.mockRestore();
      random.mockRestore();
    }
  });
});

/**
 * TWO FAMILIES, and they are not interchangeable — see handoff.ts's own doc
 * blocks. `handoffLine` is a MODEL INSTRUCTION, handed to the OpenAI socket
 * as `response.instructions` while it is still open, so it carries the "Say
 * exactly this and nothing else" wrapper its sibling `silenceGoodbye` uses.
 * `transferFailedLine` is TeXML `<Say>` TEXT, emitted by a route after the
 * socket is closed and there is no model left to instruct, so it is a bare
 * sentence like `texml/route.ts`'s own COPY. Putting one family's shape on
 * the other's function means the caller literally hears the wrapper.
 */
describe("handoffLine — a model instruction", () => {
  it("carries the constrained 'say exactly this' wrapper, like silenceGoodbye", () => {
    expect(handoffLine("en")).toMatch(/^Say exactly this and nothing else: "/);
  });
  it("says something different in Spanish, and `both` takes English like the greeting does", () => {
    expect(handoffLine("es")).not.toBe(handoffLine("en"));
    expect(handoffLine("both")).toBe(handoffLine("en"));
  });
});

describe("transferFailedLine — text for a TeXML <Say>", () => {
  it("is a BARE sentence: no model wrapper, no quote characters", () => {
    // Its consumer is `<Say>{this}</Say>`. A "Say exactly this and nothing
    // else:" prefix would be READ ALOUD to the caller, and the wrapper's
    // double quotes would go into the XML element with it.
    for (const lang of ["en", "es", "both"] as const) {
      const line = transferFailedLine(lang);
      expect(line, lang).not.toMatch(/^Say exactly/);
      expect(line, lang).not.toContain('"');
      // Nothing that would have to be escaped to be valid XML text either.
      expect(line, lang).not.toMatch(/[<>&]/);
    }
  });

  it("says something different in Spanish — the caller was just addressed in Spanish", () => {
    // The moment the transfer fails is the moment a Spanish-speaking caller
    // who was told IN SPANISH that they were being connected would otherwise
    // hear English. Collapsing the ternary to English-only must fail here.
    expect(transferFailedLine("es")).not.toBe(transferFailedLine("en"));
    expect(transferFailedLine("both")).toBe(transferFailedLine("en"));
  });

  it("does not guess the caller's gender", () => {
    // "no pudimos comunicarLO" addresses a masculine third person. We do not
    // know who is on the phone. `handoffLine` two functions up uses the
    // gender-neutral formal dative ("Le voy a comunicar…"), as does the
    // repo's existing refusal copy.
    expect(transferFailedLine("es"))
      .not.toMatch(/(?:comunicar|conectar|atender|pasar|transferir|ayudar)(?:lo|la|los|las)\b/i);
  });

  it("does not promise a callback nobody scheduled", () => {
    // The caller was already told they were being put through. The line must
    // say plainly that nobody picked up — not "we will call you back", which
    // nothing in this flow arranges.
    expect(transferFailedLine("en").toLowerCase()).not.toContain("call you back");
    expect(transferFailedLine("es").toLowerCase()).not.toContain("llamaremos");
  });
});
