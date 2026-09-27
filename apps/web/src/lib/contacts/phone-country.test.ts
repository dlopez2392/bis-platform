import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import type { OptOutToast } from "./marketing-optout";
import {
  PHONE_CHECK_TREATMENT, pickPhoneCountry,
  type PhoneCountryPickResult, type PhoneCountryUndoResult, type PhoneCountryPrevious,
} from "./phone-country";

/**
 * The Texts row's Check number state (consent chain spec §6, F-009), minus
 * React: a pick runs at once, hides the row and offers Undo (DESIGN.md rule
 * 6); Undo puts the previous phone and flag back and brings the row back.
 */
const PREVIOUS: PhoneCountryPrevious = { phone: "+15512345678", unconfirmed: true };

function harness(o: {
  pick?: Array<PhoneCountryPickResult | Error>;
  undo?: Array<PhoneCountryUndoResult | Error>;
} = {}) {
  const picks = o.pick ?? [{ ok: true, phone: "+525512345678", previous: PREVIOUS }];
  const undos = o.undo ?? [{ ok: true }];
  const save = vi.fn(async (country: "US" | "MX") => {
    void country;
    const next = picks.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const undo = vi.fn(async (picked: string, previous: PhoneCountryPrevious) => {
    void picked; void previous;
    const next = undos.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const shown: boolean[] = [];
  let undoClick: (() => unknown) | null = null;
  const toast = {
    success: vi.fn((...[, opts]: [string, { action: { label: string; onClick: () => void } }]) => {
      undoClick = opts.action.onClick;
    }),
    error: vi.fn(),
  } satisfies OptOutToast;
  return { save, undo, shown, show: (v: boolean) => { shown.push(v); }, toast, click: () => undoClick };
}

describe("pickPhoneCountry", () => {
  it("Mexico: saves MX, hides the row, toasts the Mexican line with an Undo (mutation: toast the US line for MX → FAILS)", async () => {
    const h = harness();
    await pickPhoneCountry("MX", h.save, h.undo, h.show, h.toast);
    expect(h.save).toHaveBeenCalledWith("MX");
    expect(h.shown).toEqual([false]);
    expect(h.toast.success).toHaveBeenCalledWith(
      m["contact.phoneCountry.mxToast"],
      expect.objectContaining({ action: expect.objectContaining({ label: m["common.undo"] }) }),
    );
  });

  it("US toasts the US line", async () => {
    const h = harness({ pick: [{ ok: true, phone: "+15512345678", previous: { phone: "5512345678", unconfirmed: false } }] });
    await pickPhoneCountry("US", h.save, h.undo, h.show, h.toast);
    expect(h.toast.success.mock.calls[0]?.[0]).toBe(m["contact.phoneCountry.usToast"]);
  });

  it("a refused pick leaves the row and says the server's reason, no Undo offered (mutation: show(false) before the save → FAILS)", async () => {
    const h = harness({ pick: [{ ok: false, error: m["contact.phoneCountry.changed"] }] });
    await pickPhoneCountry("MX", h.save, h.undo, h.show, h.toast);
    expect(h.shown).toEqual([]);
    expect(h.toast.error).toHaveBeenCalledWith(m["contact.phoneCountry.changed"]);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("a REJECTED pick (a stale tab's action id) is the crashed toast, never silence", async () => {
    const h = harness({ pick: [new Error("Server Action not found")] });
    await pickPhoneCountry("MX", h.save, h.undo, h.show, h.toast);
    expect(h.toast.error).toHaveBeenCalledWith(m["inline.crashed"]);
    expect(h.shown).toEqual([]);
  });

  it("Undo hands back the phone the pick WROTE and the previous phone and flag, then shows the row again (mutation: pass previous.phone as picked → FAILS)", async () => {
    const h = harness();
    await pickPhoneCountry("MX", h.save, h.undo, h.show, h.toast);
    await h.click()!();
    expect(h.undo).toHaveBeenCalledWith("+525512345678", PREVIOUS);
    expect(h.shown).toEqual([false, true]);
  });

  it("a failed Undo says why and leaves the row hidden, as the server has it", async () => {
    const h = harness({ undo: [{ ok: false, error: m["contact.phoneCountry.changed"] }] });
    await pickPhoneCountry("MX", h.save, h.undo, h.show, h.toast);
    await h.click()!();
    expect(h.toast.error).toHaveBeenCalledWith(m["contact.phoneCountry.changed"]);
    expect(h.shown).toEqual([false]);
  });

  it("an Undo the guard refuses says so (the toast is already gone) and writes nothing (mutation: drop the ran === false branch → FAILS)", async () => {
    const h = harness();
    await pickPhoneCountry("MX", h.save, h.undo, h.show, h.toast, () => false);
    h.click()!();
    expect(h.toast.error).toHaveBeenCalledWith(m["contact.phoneCountry.undoBusy"]);
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("tells its host when the number changed (re-review minor 1) after a pick and after an Undo the server took, never after a refusal (mutation: drop either onChanged call → FAILS)", async () => {
    const refused = harness({ pick: [{ ok: false, error: m["contact.phoneCountry.changed"] }] });
    const onChangedRefused = vi.fn();
    await pickPhoneCountry("MX", refused.save, refused.undo, refused.show, refused.toast, undefined, onChangedRefused);
    expect(onChangedRefused).not.toHaveBeenCalled();

    const h = harness();
    const onChanged = vi.fn();
    await pickPhoneCountry("MX", h.save, h.undo, h.show, h.toast, undefined, onChanged);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await h.click()!();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});

describe("PHONE_CHECK_TREATMENT", () => {
  it("is a dot AND the word, in token classes only (rule 3; mutation: a hex colour → FAILS)", () => {
    expect(PHONE_CHECK_TREATMENT.label).toBe("Check number");
    expect(PHONE_CHECK_TREATMENT.dot).toBe("bg-warning");
    expect(`${PHONE_CHECK_TREATMENT.dot} ${PHONE_CHECK_TREATMENT.chip}`).not.toMatch(/#|rgb|hsl|oklch|\[/);
  });

  it("the spec's words, verbatim (§6)", () => {
    expect(m["contact.phoneCountry.line"]).toBe("This number could be Mexican or US.");
    expect(m["contact.phoneCountry.mx"]).toBe("Mexico (+52)");
    expect(m["contact.phoneCountry.us"]).toBe("US (+1)");
  });
});
