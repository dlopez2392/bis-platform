import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { commitInlineUndo, type PhoneInlineUndo } from "./inline-phone-undo";

/**
 * inline-field.tsx's undo used to resubmit the PRIOR text through `save` for
 * every field, phone included, or capture the flag from the client's summary
 * (stale, or defaulted false). `commitInlineUndo` is the fix's decision
 * point: phone routes the SERVER's own undo payload to the dedicated
 * action; every other field is untouched.
 */
const UNDO: PhoneInlineUndo = { priorPhone: "+19565550100", priorUnconfirmed: true, editedPhone: "+14155551234" };

describe("commitInlineUndo", () => {
  it("undoing a phone edit hands the server's OWN undo payload to the dedicated action, never save() (mutation: call save(prior) instead → FAILS)", async () => {
    const save = vi.fn();
    const undoPhone = vi.fn(async () => ({ ok: true as const }));
    const r = await commitInlineUndo("phone", "+19565550100", UNDO, save, undoPhone);
    expect(undoPhone).toHaveBeenCalledWith(UNDO);
    expect(save).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });

  it("every other field's undo is unchanged: it still resubmits the prior text through save (mutation: route email through undoPhone too → FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const undoPhone = vi.fn();
    const r = await commitInlineUndo("email", "old@example.com", undefined, save, undoPhone);
    expect(save).toHaveBeenCalledWith("old@example.com");
    expect(undoPhone).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });

  // Round 3 (CRITICAL): the phone field NEVER falls back to save(prior) —
  // that path is exactly what re-derives the flag from text and lost it on
  // a clear. Without a payload (or no undoPhone wired), it answers failed.
  it("without a phoneUndo payload, the phone field does NOT fall back to save(prior) — it answers failed (mutation: fall back to save(priorValue) → FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const r = await commitInlineUndo("phone", "+19565550100", undefined, save, vi.fn());
    expect(save).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
  });

  it("without undoPhone wired (even with a payload), the phone field still refuses rather than falling back", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const r = await commitInlineUndo("phone", "+19565550100", UNDO, save, undefined);
    expect(save).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
  });

  it("a null editedPhone (the prior edit CLEARED the number) is a valid payload, routed the same way", async () => {
    const save = vi.fn();
    const undoPhone = vi.fn(async () => ({ ok: true as const }));
    const cleared: PhoneInlineUndo = { ...UNDO, editedPhone: null };
    const r = await commitInlineUndo("phone", "+19565550100", cleared, save, undoPhone);
    expect(undoPhone).toHaveBeenCalledWith(cleared);
    expect(save).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });
});
