import { describe, it, expect, vi } from "vitest";
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

  it("without a phoneUndo payload (the save didn't return one), the phone field falls back to save(prior) too (mutation: throw instead of falling back → FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const r = await commitInlineUndo("phone", "+19565550100", undefined, save, vi.fn());
    expect(save).toHaveBeenCalledWith("+19565550100");
    expect(r).toEqual({ ok: true });
  });
});
