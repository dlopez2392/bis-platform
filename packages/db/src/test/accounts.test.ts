import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { createAccount, listAccounts } from "../accounts";

const suffix = () => Math.random().toString(36).slice(2, 10);

describe("accounts service", () => {
  it("createAccount inserts row + emits account.created event", async () => {
    const db = serviceDb();
    const orgId = `org_test_${suffix()}`;
    const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Test Co", actorId: "user_test" });
    try {
      const { data: ev } = await db.from("events").select("type, actor_type, actor_id")
        .eq("account_id", id).eq("type", "account.created").single();
      expect(ev).toMatchObject({ type: "account.created", actor_type: "user", actor_id: "user_test" });
      const all = await listAccounts(db);
      expect(all.some(a => a.id === id)).toBe(true);
    } finally {
      await db.from("events").delete().eq("account_id", id);
      await db.from("accounts").delete().eq("id", id);
    }
  });
});
