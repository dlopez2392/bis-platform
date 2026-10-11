import { describe, it, expect, vi } from "vitest";
import { planInlineUndo, inlineSavedView, followedFieldKey } from "./inline-save";
import type { PhoneInlineUndo } from "./inline-phone-undo";
import { m } from "@/lib/messages";

const PHONE_UNDO: PhoneInlineUndo = { priorPhone: "+19565550100", priorUnconfirmed: false, editedPhone: "+19565550199" };
const PAYLOAD = { added: "m2", removed: null };

/** Every writer a field can hold, as spies, so a test can say which ONE ran. */
function writers() {
  return {
    save: vi.fn<(v: string) => Promise<{ ok: true }>>(async () => ({ ok: true })),
    undoPhone: vi.fn<(u: PhoneInlineUndo) => Promise<{ ok: true }>>(async () => ({ ok: true })),
    undoWith: vi.fn<(p: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  };
}

/**
 * S-02 §6 row 3: the Business name's Undo hands the server back its OWN record
 * of what the save replaced. Re-saving the prior text instead would relink the
 * existing group but lose its role, pays flag and age, so the decision of
 * whether Undo is offered, and which ONE writer it runs, is pinned here by
 * behaviour, not by the component's source text.
 */
describe("planInlineUndo: a field with its own server-built undo (undoWith)", () => {
  it("Undo calls undoWith once with exactly the save's payload, and no other writer (mutations: gate it on field === \"phone\"; also run save -> FAILS)", async () => {
    const w = writers();
    const undo = planInlineUndo({ field: "company_name", prior: "Acme", priorValid: true, phoneUndo: undefined, ownUndo: PAYLOAD, ...w });
    expect(undo).not.toBeNull();
    expect(await undo!()).toEqual({ ok: true });
    expect(w.undoWith).toHaveBeenCalledTimes(1);
    expect(w.undoWith).toHaveBeenCalledWith(PAYLOAD);
    expect(w.save).not.toHaveBeenCalled();
    expect(w.undoPhone).not.toHaveBeenCalled();
  });

  it("no payload (an unchanged name) offers no Undo, even though the prior text validates (mutation: fall back to priorValid -> FAILS)", () => {
    const w = writers();
    expect(planInlineUndo({ field: "company_name", prior: "Acme", priorValid: true, phoneUndo: undefined, ownUndo: undefined, ...w })).toBeNull();
  });

  it("planning runs nothing: no writer is called until Undo is pressed", () => {
    const w = writers();
    planInlineUndo({ field: "company_name", prior: "Acme", priorValid: true, phoneUndo: undefined, ownUndo: PAYLOAD, ...w });
    expect(w.undoWith).not.toHaveBeenCalled();
    expect(w.save).not.toHaveBeenCalled();
  });
});

describe("planInlineUndo: the phone and plain fields keep their rules", () => {
  it("phone with the server's payload undoes through undoPhone only", async () => {
    const w = writers();
    const undo = planInlineUndo({ field: "phone", prior: "+19565550100", priorValid: true, phoneUndo: PHONE_UNDO, ownUndo: undefined, ...w, undoWith: undefined });
    await undo!();
    expect(w.undoPhone).toHaveBeenCalledWith(PHONE_UNDO);
    expect(w.save).not.toHaveBeenCalled();
  });

  it("phone with no payload offers no Undo, even when the prior validates (mutation: phone falls back to priorValid -> FAILS)", () => {
    const w = writers();
    expect(planInlineUndo({ field: "phone", prior: "+19565550100", priorValid: true, phoneUndo: undefined, ownUndo: undefined, ...w, undoWith: undefined })).toBeNull();
  });

  it("a plain field re-saves the prior text when it validates, and offers nothing when it does not", async () => {
    const w = writers();
    const undo = planInlineUndo({ field: "email", prior: "old@example.com", priorValid: true, phoneUndo: undefined, ownUndo: undefined, ...w, undoWith: undefined });
    await undo!();
    expect(w.save).toHaveBeenCalledWith("old@example.com");
    expect(planInlineUndo({ field: undefined, prior: "", priorValid: false, phoneUndo: undefined, ownUndo: undefined, ...w, undoWith: undefined })).toBeNull();
  });
});

/**
 * I3 (orchestrator ruling): the field shows what the server STORED, and a save
 * that changed nothing because the business is already on the list under
 * another spelling says so in words rather than "saved".
 */
describe("inlineSavedView", () => {
  it("an unchanged save stored under another spelling says it is already on the list, and shows that spelling (mutation: ignore shown -> FAILS)", () => {
    expect(inlineSavedView("beta", "Business name", { shown: "Beta" })).toEqual({
      shown: "Beta", kind: "already",
      message: m["contact.business.alreadyAs"].replace("{name}", "Beta"),
    });
  });

  it("a real change shows the stored spelling and says saved", () => {
    expect(inlineSavedView("beta roofing", "Business name", { shown: "Beta Roofing", undoPayload: PAYLOAD })).toEqual({
      shown: "Beta Roofing", kind: "saved", message: m["inline.saved"].replace("{label}", "Business name"),
    });
  });

  it("an unchanged save whose spelling matches, and any field with no shown, just says saved with the typed text", () => {
    expect(inlineSavedView("Beta", "Business name", { shown: "Beta" }).kind).toBe("saved");
    expect(inlineSavedView("Ana", "First name", {})).toEqual({
      shown: "Ana", kind: "saved", message: m["inline.saved"].replace("{label}", "First name"),
    });
  });

  it("the copy reads plainly in both languages, with curly quotes around the name", () => {
    expect(m["contact.business.alreadyAs"]).toBe("Already on your list as “{name}”.");
    expect(m["contact.business.alreadyAs.es"]).toBe("Ya está en su lista como “{name}”.");
  });
});

/**
 * Final review minor 11: the Business name field remounts when the server
 * hands it a new name (a Groups card write changed it), but never while the
 * operator is typing in it: a remount mid-edit threw the typed text away.
 */
describe("followedFieldKey: follow the server's value only at rest (mutation: always follow the value -> FAILS)", () => {
  it("at rest, the key is the server's value, so a new name remounts the field", () => {
    expect(followedFieldKey(false, "Acme Roofing", "Beta Pools")).toBe("Beta Pools");
    expect(followedFieldKey(false, "Acme Roofing", null)).toBe("");
  });
  it("while editing, the key stays where it was, whatever the server sends", () => {
    expect(followedFieldKey(true, "Acme Roofing", "Beta Pools")).toBe("Acme Roofing");
    expect(followedFieldKey(true, "", null)).toBe("");
  });
});
