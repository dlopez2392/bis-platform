import { describe, it, expect, vi, beforeEach } from "vitest";

const getContact = vi.hoisted(() => vi.fn());
const serviceDb = vi.hoisted(() => vi.fn(() => ({ writer: true })));
vi.mock("@bis/db", () => ({ getContact, serviceDb }));

const dbForRequest = vi.hoisted(() => vi.fn(async () => ({ requestClient: true })));
vi.mock("@/lib/db", () => ({ dbForRequest }));

const actorName = vi.hoisted(() => vi.fn(async () => "Ana"));
vi.mock("./actor", () => ({ actorName }));

import { m } from "@/lib/messages";
import { emailContextFor } from "./email-context";

beforeEach(() => {
  getContact.mockReset();
  dbForRequest.mockReset().mockResolvedValue({ requestClient: true });
  actorName.mockReset().mockResolvedValue("Ana");
});

/**
 * S-10 leftovers (#317 follow-up, item 7): emailContextFor's own errors read m[...] directly —
 * English always — and a usable context carried no locale at all for email-staff-actions.ts's
 * own errors to read later. The Texts row's own fix (texts-context.ts), mirrored for email.
 */
describe("emailContextFor reads the reader's own locale (S-10 leftovers item 7)", () => {
  it("a contact with no email fails with reason 'no_email', in English by default", async () => {
    getContact.mockResolvedValue({ email: null });
    const result = await emailContextFor("a1", "c1", "user_1");
    expect(result).toEqual({ ok: false, reason: "no_email", error: m["contact.email.noEmail"] });
  });

  it("the no-email error reads Spanish when asked (mutation: read m[...] directly -> FAILS)", async () => {
    getContact.mockResolvedValue({ email: null });
    const result = await emailContextFor("a1", "c1", "user_1", "es");
    expect(result).toEqual({ ok: false, reason: "no_email", error: m["contact.email.noEmail.es"] });
  });

  it("the failed-read error reads Spanish when asked (mutation: read m[...] directly -> FAILS)", async () => {
    getContact.mockRejectedValue(new Error("boom"));
    const result = await emailContextFor("a1", "c1", "user_1", "es");
    expect(result).toEqual({ ok: false, reason: "failed", error: m["contact.email.failed.es"] });
  });

  it("a usable context carries the locale it was given, for email-staff-actions.ts's own errors to read (mutation: drop locale from the returned object -> FAILS)", async () => {
    getContact.mockResolvedValue({ email: "ana@example.com" });
    const result = await emailContextFor("a1", "c1", "user_1", "es");
    expect("ok" in result).toBe(false);
    if (!("ok" in result)) expect(result.locale).toBe("es");
  });

  it("defaults to English with no locale given, so a predating caller is unchanged", async () => {
    getContact.mockResolvedValue({ email: "ana@example.com" });
    const result = await emailContextFor("a1", "c1", "user_1");
    expect("ok" in result).toBe(false);
    if (!("ok" in result)) expect(result.locale).toBe("en");
  });
});
