import { describe, it, expect } from "vitest";
import { CHECKLIST_CATALOGUE, mergeChecklist } from "./checklist-catalogue";

describe("checklist catalogue", () => {
  it("every catalogue item states that it is done outside the platform", () => {
    // The one requirement that keeps this from being theatre: a checklist
    // implying the app will buy you a phone number is worse than none.
    for (const item of CHECKLIST_CATALOGUE) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.help.length).toBeGreaterThan(0);
      expect(typeof item.external).toBe("boolean");
    }
    // Assert the exact SET of internal items, not a count. A count plus a
    // spot-check on form_notify would still pass if some other item were
    // wrongly marked internal and form_notify external — the two errors
    // cancel. These two are the only ones the platform performs itself:
    // form_notify shows a live count of forms with no notify address, and
    // invite_owner moved in-app in M2 (Settings, under Client access).
    expect(CHECKLIST_CATALOGUE.filter((i) => !i.external).map((i) => i.key).sort())
      .toEqual(["form_notify", "invite_owner", "reply_to"]);
  });

  it("merges catalogue items with stored state, including untouched ones", () => {
    const entries = mergeChecklist([
      { id: "1", item_key: "phone_number", title: null, done_at: "2026-07-31T00:00:00Z",
        done_by: "user_1", note: "ported", position: 0 },
    ]);

    const phone = entries.find((e) => e.key === "phone_number")!;
    expect(phone.done).toBe(true);
    expect(phone.note).toBe("ported");
    expect(phone.title).toBe(CHECKLIST_CATALOGUE.find((i) => i.key === "phone_number")!.title);

    // An untouched catalogue item still appears, undone.
    expect(entries.find((e) => e.key === "a2p_registration")!.done).toBe(false);
    expect(entries).toHaveLength(CHECKLIST_CATALOGUE.length);
  });

  it("includes custom items and uses their stored title", () => {
    const entries = mergeChecklist([
      { id: "2", item_key: "custom:abc", title: "Order signage", done_at: null,
        done_by: null, note: null, position: 100 },
    ]);
    const custom = entries.find((e) => e.key === "custom:abc")!;
    expect(custom.title).toBe("Order signage");
    expect(custom.custom).toBe(true);
    expect(entries).toHaveLength(CHECKLIST_CATALOGUE.length + 1);
  });

  it("drops a stored row whose catalogue key no longer exists", () => {
    // Retiring a catalogue item must not crash every account that ticked it.
    const entries = mergeChecklist([
      { id: "3", item_key: "retired_item", title: null, done_at: null,
        done_by: null, note: null, position: 0 },
    ]);
    expect(entries.find((e) => e.key === "retired_item")).toBeUndefined();
    expect(entries).toHaveLength(CHECKLIST_CATALOGUE.length);
  });
});
