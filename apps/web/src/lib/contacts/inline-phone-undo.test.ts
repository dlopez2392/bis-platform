import { describe, it, expect, vi } from "vitest";
import { commitInlineUndo } from "./inline-phone-undo";

/**
 * inline-field.tsx's undo used to resubmit the PRIOR text through `save` for
 * every field, phone included. Because the phone column had since moved
 * (the edit wrote a different number), the write re-derived the flag from
 * the prior TEXT, and `normalisePhone` never re-flags a number already
 * carrying a country code — a flagged "+1…" undo always came back CONFIRMED.
 * `commitInlineUndo` is the fix's decision point: phone routes to the
 * dedicated action, which restores the number and the flag together;
 * every other field is untouched.
 */
describe("commitInlineUndo", () => {
  it("undoing a phone edit restores the prior number AND its flag, through the dedicated action, never save() (mutation: call save(prior) instead → FAILS)", async () => {
    const save = vi.fn();
    const undoPhone = vi.fn(async () => ({ ok: true as const }));
    const r = await commitInlineUndo("phone", "+19565550100", "+14155551234", true, save, undoPhone);
    expect(undoPhone).toHaveBeenCalledWith("+14155551234", "+19565550100", true);
    expect(save).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });

  it("every other field's undo is unchanged: it still resubmits the prior text through save (mutation: route email through undoPhone too → FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const undoPhone = vi.fn();
    const r = await commitInlineUndo("email", "old@example.com", "new@example.com", false, save, undoPhone);
    expect(save).toHaveBeenCalledWith("old@example.com");
    expect(undoPhone).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });

  it("without an undoPhone supplied, the phone field falls back to save(prior) too (mutation: throw instead of falling back → FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const r = await commitInlineUndo("phone", "+19565550100", "+14155551234", true, save, undefined);
    expect(save).toHaveBeenCalledWith("+19565550100");
    expect(r).toEqual({ ok: true });
  });
});
