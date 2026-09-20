import { describe, it, expect } from "vitest";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { withRollback } from "./db";
import { upsertVoiceProfile } from "../voice";

describe("0019 voice schema", () => {
  // MINOR (Task 1, second review): `voice-schema.test.ts` pinned four
  // defaults, not the column SET. A column added to the table and to
  // `VoiceProfileRow` but forgotten in `PROFILE_COLS` gives every reader
  // `undefined` for it, with no type error and no failing test -- the exact
  // drift that produced this task's Critical (a copied column list in
  // `concierge.ts` that silently fell out of step with `voice.ts`'s).
  //
  // Pinned against the TABLE, not against another reader of the constant:
  // `concierge.test.ts:330` already proves `getVoiceProfileByPublicId` and
  // `getVoiceProfile` return the same keys as EACH OTHER, which cannot fail
  // on a column both of them (wrongly) omit -- both read `PROFILE_COLS`, so
  // they always agree with each other even when they've drifted from the
  // table. This instead selects a REAL row through `upsertVoiceProfile`
  // (which is `PROFILE_COLS` under the hood) and compares its key set to
  // `information_schema.columns`' own account of `voice_profiles`, less the
  // two audit columns `PROFILE_COLS` deliberately omits (`created_at`,
  // `updated_at` are never rendered and carry no accessor-facing meaning).
  it("PROFILE_COLS returns exactly the voice_profiles columns it means to, pinned against the table itself", async () => {
    let selectedKeys: string[] = [];
    await withTestAccount(async (db, accountId) => {
      const row = await upsertVoiceProfile(db, accountId, {}, "user_test");
      selectedKeys = Object.keys(row).sort();
    });
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'voice_profiles'
            and column_name not in ('created_at', 'updated_at')`,
      );
      const tableCols = rows.map((r) => r.column_name).sort();
      expect(selectedKeys).toEqual(tableCols);
    });
  });

  it("phone_numbers accepts a valid row and rejects a bad e164", async () => {
    await withTestAccount(async (db, accountId) => {
      // Unique across every account, so the accepted number is drawn per run.
      // The REJECTED one stays a literal: it is refused by
      // `phone_numbers_e164_check` before uniqueness is ever consulted, and
      // its exact shape — a number written the way a human writes it — is the
      // point of the assertion.
      const ok = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id, status").single();
      expect(ok.error, `phone_numbers insert failed: ${ok.error?.message}`).toBeNull();
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
        .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();
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
