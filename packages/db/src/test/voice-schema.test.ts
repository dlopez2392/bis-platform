import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";

describe("0019 voice schema", () => {
  it("phone_numbers accepts a valid row and rejects a bad e164", async () => {
    await withTestAccount(async (db, accountId) => {
      const ok = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "+19565550111" }).select("id, status").single();
      expect(ok.error).toBeNull();
      expect(ok.data!.status).toBe("provisioned");
      const bad = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "956-555-0111" }).select("id");
      expect(bad.error).not.toBeNull();
    });
  });

  it("voice_profiles is one-per-account with the documented defaults", async () => {
    await withTestAccount(async (db, accountId) => {
      const first = await db.from("voice_profiles")
        .insert({ account_id: accountId }).select("persona_name, languages, booking_enabled, enabled").single();
      expect(first.error).toBeNull();
      expect(first.data).toEqual({
        persona_name: "Sofía", languages: "both", booking_enabled: true, enabled: false,
      });
      const dupe = await db.from("voice_profiles").insert({ account_id: accountId }).select("id");
      expect(dupe.error).not.toBeNull(); // unique(account_id)
    });
  });

  it("calls row lifecycle: insert minimal at accept, update at finish", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "+19565550112" }).select("id").single();
      const call = await db.from("calls")
        .insert({ account_id: accountId, phone_number_id: num.data!.id, caller_e164: "+19562921696" })
        .select("id, outcome, transcript").single();
      expect(call.error).toBeNull();
      expect(call.data!.outcome).toBe("abandoned");
      const upd = await db.from("calls")
        .update({ outcome: "lead", ended_at: new Date().toISOString(), duration_secs: 61, turn_count: 8, summary: "s" })
        .eq("id", call.data!.id).select("outcome").single();
      expect(upd.error).toBeNull();
      expect(upd.data!.outcome).toBe("lead");
    });
  });

  it("messages accepts channel 'voice'", async () => {
    await withTestAccount(async (db, accountId) => {
      const { createContact } = await import("../contacts");
      const { ensureConversation, createMessage } = await import("../messaging");
      const c = await createContact(db, accountId, { firstName: "V", phone: "+19565550113" }, "voice", "ai");
      const convo = await ensureConversation(db, accountId, c.id, "voice", "ai");
      await expect(createMessage(db, accountId, {
        conversationId: convo.id, channel: "voice", direction: "inbound", subject: "Phone call", body: "hi",
      }, "voice", "ai")).resolves.toHaveProperty("id");
    });
  });
});
