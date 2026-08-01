import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listChecklistState, setChecklistItem, addCustomChecklistItem } from "../checklist";

describe("checklist state", () => {
  it("a fresh account has no rows — the catalogue lives in code", () =>
    withTestAccount(async (db, accountId) => {
      expect(await listChecklistState(db, accountId)).toHaveLength(0);
    }));

  it("ticking an item creates its row, and un-ticking clears done_at", () =>
    withTestAccount(async (db, accountId) => {
      await setChecklistItem(db, accountId, "phone_number", { done: true }, "user_test");
      let [row] = await listChecklistState(db, accountId);
      expect(row!.item_key).toBe("phone_number");
      expect(row!.done_at).not.toBeNull();
      expect(row!.done_by).toBe("user_test");

      await setChecklistItem(db, accountId, "phone_number", { done: false }, "user_test");
      [row] = await listChecklistState(db, accountId);
      expect(row!.done_at).toBeNull();
    }));

  it("setting the same item twice updates one row rather than adding another", () =>
    withTestAccount(async (db, accountId) => {
      await setChecklistItem(db, accountId, "a2p_registration", { done: true }, "user_test");
      await setChecklistItem(db, accountId, "a2p_registration", { note: "submitted 2026-07-31" }, "user_test");

      const rows = await listChecklistState(db, accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.note).toBe("submitted 2026-07-31");
      // A note must not silently un-tick the item.
      expect(rows[0]!.done_at).not.toBeNull();
    }));

  it("a custom item stores its own title and gets a custom: key", () =>
    withTestAccount(async (db, accountId) => {
      const { itemKey } = await addCustomChecklistItem(db, accountId, "Order branded signage");
      expect(itemKey).toMatch(/^custom:/);

      const [row] = await listChecklistState(db, accountId);
      expect(row!.title).toBe("Order branded signage");
    }));
});
