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

  it("derives A2P from account state, not from a stored tick", () => {
    const a2p = (entries: ReturnType<typeof mergeChecklist>) =>
      entries.find((e) => e.key === "a2p_registration")!;

    expect(a2p(mergeChecklist([], { a2pStatus: "approved" })).done).toBe(true);
    // Only `approved` counts — a registration still with the carriers, or one
    // the carriers rejected, cannot read as done.
    for (const status of ["not_started", "pending", "rejected"] as const) {
      expect(a2p(mergeChecklist([], { a2pStatus: status })).done, status).toBe(false);
    }

    // A stale manual tick must NOT win. The whole point of this phase is that
    // the item reflects what the carriers approved, so a row saying done under
    // a status saying otherwise resolves to NOT done — and this item can now
    // go BACKWARDS, which is new behaviour for the list and is intended.
    const ticked = [{
      id: "1", item_key: "a2p_registration", title: null,
      done_at: "2026-07-31T00:00:00Z", done_by: "user_1", note: null, position: 0,
    }];
    expect(a2p(mergeChecklist(ticked, { a2pStatus: "pending" })).done).toBe(false);
    // …and with no account read available, the stored row is still the answer,
    // which is what keeps an un-wired call site rendering something sane.
    expect(a2p(mergeChecklist(ticked)).done).toBe(true);
  });

  it("leaves every other item on its stored tick", () => {
    const entries = mergeChecklist([{
      id: "1", item_key: "phone_number", title: null,
      done_at: "2026-07-31T00:00:00Z", done_by: "user_1", note: null, position: 0,
    }], { a2pStatus: "not_started" });
    expect(entries.find((e) => e.key === "phone_number")!.done).toBe(true);
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
