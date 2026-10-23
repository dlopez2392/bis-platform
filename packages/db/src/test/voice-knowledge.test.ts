import { describe, it, expect } from "vitest";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { serviceDb } from "../service";
import { createForm } from "../forms";
import { upsertVoiceProfile, getVoiceProfile, assignPhoneNumber, startCallRow, type WeeklyHours } from "../voice";
import { createConciergeConversation } from "../concierge";
import {
  listVoiceServices, getKnowledgeSnapshot, getLatestKnowledgeVersion,
  saveVoiceKnowledge, ensureKnowledgeSnapshot, type VoiceServiceInput,
} from "../voice-knowledge";

/**
 * 0095 over PostgREST (S-47c). Every row here is written by the real writers, `upsertVoiceProfile` and
 * `saveVoiceKnowledge` / `ensureKnowledgeSnapshot` (the two service-role functions), never by a hand-shaped
 * insert: service_role holds no write on either new table, so a hand-shaped insert could not even run.
 */

const RUN = Math.random().toString(36).slice(2, 10);

/** One service row as the Voice page sends it: every key present, the absent ones null. */
function svc(o: Partial<VoiceServiceInput> & Pick<VoiceServiceInput, "name_en" | "price_kind">): VoiceServiceInput {
  return {
    name_es: null, description_en: null, description_es: null,
    amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null, ...o,
  };
}

const HOURS: WeeklyHours = { mon: [["08:00", "12:00"], ["13:00", "17:00"]], sat: [["09:00", "24:00"]] };

const LIST: VoiceServiceInput[] = [
  svc({ name_en: "Haircut", name_es: "Corte de cabello", price_kind: "fixed", amount_cents: 2500,
        description_es: "Lavado incluido, y peinado después" }),
  svc({ name_en: "Catering", price_kind: "per_unit", amount_cents: 1800, unit_en: "guest", unit_es: "invitado" }),
  svc({ name_en: "Estimate", price_kind: "free" }),
];

/** A nested payload carrying a string, a number, a null, an array and accented text (A3). */
const PAYLOAD = {
  schema: 1,
  facts: "Abrimos temprano; después de las 5 llame.",
  timezone: "America/Chicago",
  business_hours: null,
  hours_lines: ["Monday: 8:00 AM to 12:00 PM", "Sábado: cerrado"],
  services: [{ name_en: "Haircut", name_es: "Corte de cabello", position: 1, amount_cents: 2500, nested: { a: [1, null, "x"] } }],
  renderer_version: 1,
};

describe("voice knowledge accessors (0095, S-47c)", () => {
  it("saveVoiceKnowledge writes the list and the snapshot; listVoiceServices reads it in position order; getKnowledgeSnapshot returns the payload deep-equal to what was sent; getLatestKnowledgeVersion reads 1; getVoiceProfile reads the hours back (A3)", () =>
    withTestAccount(async (db, accountId) => {
      await upsertVoiceProfile(db, accountId, {}, "user_test");
      expect(await getLatestKnowledgeVersion(db, accountId)).toBe(0);

      const r = await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { facts: "Open early.", business_hours: HOURS, services: LIST },
        payload: PAYLOAD, baseVersion: 0,
      });
      expect(r).toEqual({ status: "ok", version: 1 });

      const rows = await listVoiceServices(db, accountId);
      expect(rows.map((s) => [s.position, s.name_en, s.name_es, s.price_kind, s.amount_cents, s.unit_en, s.unit_es]))
        .toEqual([
          [1, "Haircut", "Corte de cabello", "fixed", 2500, null, null],
          [2, "Catering", null, "per_unit", 1800, "guest", "invitado"],
          [3, "Estimate", null, "free", null, null, null],
        ]);
      expect(rows[0]!.description_es).toBe("Lavado incluido, y peinado después");
      expect(rows.every((s) => s.account_id === accountId)).toBe(true);

      const snap = await getKnowledgeSnapshot(db, accountId, 1);
      expect(snap?.version).toBe(1);
      expect(snap?.account_id).toBe(accountId);
      expect(snap?.created_by).toBe("user_test");
      expect(snap?.payload).toEqual(PAYLOAD);
      expect(await getLatestKnowledgeVersion(db, accountId)).toBe(1);

      const profile = await getVoiceProfile(db, accountId);
      expect(profile?.facts).toBe("Open early.");
      expect(profile?.business_hours).toEqual(HOURS);
    }));

  it("an equal payload sent again over PostgREST answers the same version (A3: jsonb equality survives the trip; mutation: the RPC always appends -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await upsertVoiceProfile(db, accountId, {}, "user_test");
      const first = await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { facts: "A" }, payload: PAYLOAD, baseVersion: 0,
      });
      expect(first).toEqual({ status: "ok", version: 1 });
      // A deep copy: equal by value, a different object in memory and a fresh JSON body on the wire.
      const again = await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { facts: "A" }, payload: JSON.parse(JSON.stringify(PAYLOAD)), baseVersion: 1,
      });
      expect(again).toEqual({ status: "ok", version: 1 });
      expect(await getLatestKnowledgeVersion(db, accountId)).toBe(1);
      // And a payload that differs by one value is a new version (the equality is not "always equal").
      const changed = await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { facts: "B" }, payload: { ...PAYLOAD, facts: "B" }, baseVersion: 1,
      });
      expect(changed).toEqual({ status: "ok", version: 2 });
    }));

  it("stale, no_profile and invalid come back as statuses, not throws; a transport error throws naming the function", () =>
    withTestAccount(async (db, accountId) => {
      // no_profile: the account exists, its voice profile does not yet.
      expect(await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { facts: "x" }, payload: { facts: "x" }, baseVersion: 0,
      })).toEqual({ status: "no_profile" });

      await upsertVoiceProfile(db, accountId, {}, "user_test");
      expect(await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { facts: "x" }, payload: { facts: "x" }, baseVersion: 0,
      })).toEqual({ status: "ok", version: 1 });

      // stale: someone saved version 1 since this action read 0.
      expect(await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { facts: "y" }, payload: { facts: "y" }, baseVersion: 0,
      })).toEqual({ status: "stale" });

      // invalid: a per_unit row without unit_es; everything else about it is valid, so the shape CHECK is the
      // only thing that can refuse it. Nothing is written: the facts sent beside it stay "x".
      expect(await saveVoiceKnowledge(db, accountId, {
        actor: "user_test",
        parts: { facts: "z", services: [svc({ name_en: "Catering", price_kind: "per_unit", amount_cents: 1800, unit_en: "guest" })] },
        payload: { facts: "z" }, baseVersion: 1,
      })).toEqual({ status: "invalid" });
      expect((await getVoiceProfile(db, accountId))?.facts).toBe("x");
      expect(await listVoiceServices(db, accountId)).toEqual([]);
      expect(await getLatestKnowledgeVersion(db, accountId)).toBe(1);

      // A real error (the function raises 22004 on a blank actor) throws, naming the wrapper.
      await expect(saveVoiceKnowledge(db, accountId, {
        actor: "   ", parts: { facts: "x" }, payload: { facts: "x" }, baseVersion: 1,
      })).rejects.toThrow(/^saveVoiceKnowledge failed: /);
      // ensure raises P0002 for an account that does not exist.
      await expect(ensureKnowledgeSnapshot(db, "00000000-0000-4000-8000-000000000000", { facts: "x" }))
        .rejects.toThrow(/^ensureKnowledgeSnapshot failed: /);
    }));

  it("ensureKnowledgeSnapshot returns the version as a number (not a string), and the same version for an equal payload", () =>
    withTestAccount(async (db, accountId) => {
      const v1 = await ensureKnowledgeSnapshot(db, accountId, PAYLOAD);
      expect(typeof v1).toBe("number");
      expect(v1).toBe(1);
      expect(await ensureKnowledgeSnapshot(db, accountId, JSON.parse(JSON.stringify(PAYLOAD)))).toBe(1);
      expect(await ensureKnowledgeSnapshot(db, accountId, { ...PAYLOAD, facts: "changed" })).toBe(2);
      const snap = await getKnowledgeSnapshot(db, accountId, 2);
      expect(snap?.created_by).toBe("system");
      expect(snap?.payload).toEqual({ ...PAYLOAD, facts: "changed" });
    }));

  it("listVoiceServices, getKnowledgeSnapshot and getLatestKnowledgeVersion read nothing of another account (mutation: drop .eq(\"account_id\") from any one -> FAILS)", () =>
    withTestAccount(async (db, a) => {
      await upsertVoiceProfile(db, a, {}, "user_test");
      expect(await saveVoiceKnowledge(db, a, {
        actor: "user_test", parts: { services: LIST }, payload: PAYLOAD, baseVersion: 0,
      })).toEqual({ status: "ok", version: 1 });
      await withTestAccount(async (_db, b) => {
        expect(await listVoiceServices(db, b)).toEqual([]);
        expect(await getKnowledgeSnapshot(db, b, 1)).toBeNull();
        expect(await getLatestKnowledgeVersion(db, b)).toBe(0);
      });
      // A's own reads still see A's rows, so the empty answers above are about B, not a broken read.
      expect((await listVoiceServices(db, a)).length).toBe(3);
      expect((await getKnowledgeSnapshot(db, a, 1))?.version).toBe(1);
      expect(await getLatestKnowledgeVersion(db, a)).toBe(1);
    }));

  it("the account teardown after a save, with a stamped call and a stamped chat, leaves nothing and throws nothing (SD4; mutation: add \"voice_services\" to ACCOUNT_OWNED_TABLES -> 42501, FAILS)", async () => {
    let gone = "";
    await withTestAccount(async (db, accountId) => {
      gone = accountId;
      await upsertVoiceProfile(db, accountId, {}, "user_test");
      const r = await saveVoiceKnowledge(db, accountId, {
        actor: "user_test", parts: { business_hours: HOURS, services: LIST }, payload: PAYLOAD, baseVersion: 0,
      });
      expect(r).toEqual({ status: "ok", version: 1 });
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, knowledgeVersion: 1 });
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: `vk-${RUN}`, locale: "en", attribution: {}, origin: null, knowledgeVersion: 1,
      });
    });
    expect(gone).not.toBe("");
    const svcDb = serviceDb();
    for (const table of ["voice_services", "voice_knowledge_snapshots", "accounts"] as const) {
      const col = table === "accounts" ? "id" : "account_id";
      const { data, error } = await svcDb.from(table).select("id").eq(col, gone);
      expect(error, `${table} read failed: ${error?.message}`).toBeNull();
      expect({ table, rows: data }).toEqual({ table, rows: [] });
    }
  });
});
