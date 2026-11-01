import { describe, it, expect, vi, beforeEach } from "vitest";

const getContact = vi.hoisted(() => vi.fn());
const serviceDb = vi.hoisted(() => vi.fn(() => ({ writer: true })));
vi.mock("@bis/db", () => ({ getContact, serviceDb }));

const dbForRequest = vi.hoisted(() => vi.fn(async () => ({ requestClient: true })));
vi.mock("@/lib/db", () => ({ dbForRequest }));

const actorName = vi.hoisted(() => vi.fn(async () => "Ana"));
vi.mock("./actor", () => ({ actorName }));

import { m } from "@/lib/messages";
import { textsContextFor } from "./texts-context";

beforeEach(() => {
  getContact.mockReset();
  dbForRequest.mockReset().mockResolvedValue({ requestClient: true });
  actorName.mockReset().mockResolvedValue("Ana");
});

/**
 * Review fix round 1, item 1: a caller (tasks/actions.ts's `decideFromTask`)
 * must tell "this contact has no textable number" apart from "the read
 * itself failed" WITHOUT comparing copy strings — a discriminant field, not
 * the error text, is the contract.
 */
describe("textsContextFor — the discriminant a caller needs to tell 'no number' from 'a failed read' apart (review fix round 1, item 1)", () => {
  it("a contact with no textable number fails with reason 'no_number' (mutation: drop the reason field, or reuse 'failed' for it → FAILS)", async () => {
    getContact.mockResolvedValue({ phone: null, phone_country_unconfirmed: false });
    const result = await textsContextFor("a1", "c1", "user_1");
    expect(result).toEqual({ ok: false, reason: "no_number", error: m["contact.texts.noNumber"] });
  });

  it("a contact read that throws fails with reason 'failed', never 'no_number' (mutation: reuse 'no_number' for a thrown error → FAILS)", async () => {
    getContact.mockRejectedValue(new Error("boom"));
    const result = await textsContextFor("a1", "c1", "user_1");
    expect(result).toEqual({ ok: false, reason: "failed", error: m["contact.texts.failed"] });
  });

  it("a contact with a real number still resolves a usable context, unaffected by the discriminant", async () => {
    getContact.mockResolvedValue({ phone: "+19565061545", phone_country_unconfirmed: false });
    const result = await textsContextFor("a1", "c1", "user_1");
    expect("ok" in result).toBe(false);
    if (!("ok" in result)) {
      expect(result.address).toBe("+19565061545");
    }
  });

  // S-10 leftovers (#317 follow-up, item 7): the no-number and failed-read errors read
  // m[...] directly — English always — and a usable context carried no locale at all for the
  // staff-actions module's own errors to read later.
  it("the no-number error reads Spanish when asked (mutation: read m[...] directly -> FAILS)", async () => {
    getContact.mockResolvedValue({ phone: null, phone_country_unconfirmed: false });
    const result = await textsContextFor("a1", "c1", "user_1", "es");
    expect(result).toEqual({ ok: false, reason: "no_number", error: m["contact.texts.noNumber.es"] });
  });

  it("the failed-read error reads Spanish when asked (mutation: read m[...] directly -> FAILS)", async () => {
    getContact.mockRejectedValue(new Error("boom"));
    const result = await textsContextFor("a1", "c1", "user_1", "es");
    expect(result).toEqual({ ok: false, reason: "failed", error: m["contact.texts.failed.es"] });
  });

  it("a usable context carries the locale it was given, for staff-actions.ts's own errors to read (mutation: drop locale from the returned object -> FAILS)", async () => {
    getContact.mockResolvedValue({ phone: "+19565061545", phone_country_unconfirmed: false });
    const result = await textsContextFor("a1", "c1", "user_1", "es");
    expect("ok" in result).toBe(false);
    if (!("ok" in result)) expect(result.locale).toBe("es");
  });

  it("defaults to English with no locale given, so a predating caller is unchanged", async () => {
    getContact.mockResolvedValue({ phone: null, phone_country_unconfirmed: false });
    const result = await textsContextFor("a1", "c1", "user_1");
    expect(result).toEqual({ ok: false, reason: "no_number", error: m["contact.texts.noNumber"] });
  });
});
