import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { userDb, isUserClient } from "./user-client";
import { serviceDb } from "./service";

const USER_CLIENT = Symbol.for("@bis/db:user-client");

function fakeClient(opts: { user: boolean; rpcError?: { code: string; message: string } | null }) {
  const insert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ insert }));
  const rpc = vi.fn(async () => ({ error: opts.rpcError ?? null }));
  const db = { from, rpc } as unknown as SupabaseClient;
  if (opts.user) Object.defineProperty(db, USER_CLIENT, { value: true });
  return { db, from, insert, rpc };
}

describe("userDb marks its client; serviceDb does not", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key-for-tests");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("isUserClient(userDb(token)) is true (mutation: drop the mark in userDb -> FAILS)", () => {
    expect(isUserClient(userDb("token"))).toBe(true);
  });
  it("isUserClient(serviceDb()) is false (mutation: return true unconditionally -> FAILS)", () => {
    expect(isUserClient(serviceDb())).toBe(false);
  });
});

describe("emit", () => {
  it("a user client appends through record_event with NO actor argument (mutation: send p_actor_id -> FAILS)", async () => {
    const f = fakeClient({ user: true });
    await emit(f.db, "acct_1", "contact.created", "user_1", { contactId: "c1" });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledWith("record_event",
      { p_account_id: "acct_1", p_type: "contact.created", p_payload: { contactId: "c1" } });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("a service client inserts directly, with the actor it was given (mutation: route every client to the rpc -> FAILS)", async () => {
    const f = fakeClient({ user: false });
    await emit(f.db, "acct_1", "call.recorded", "system", { callId: "k1" }, "system");
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).toHaveBeenCalledWith("events");
    expect(f.insert).toHaveBeenCalledWith(
      { account_id: "acct_1", type: "call.recorded", actor_type: "system", actor_id: "system", payload: { callId: "k1" } });
  });

  it("TEMPORARY: a user client on a database without record_event (PGRST202) falls back to the direct insert (mutation: remove the fallback -> FAILS)", async () => {
    const f = fakeClient({ user: true, rpcError: { code: "PGRST202", message: "Could not find the function" } });
    await emit(f.db, "acct_1", "note.added", "user_1", {});
    expect(f.insert).toHaveBeenCalledWith(
      { account_id: "acct_1", type: "note.added", actor_type: "user", actor_id: "user_1", payload: {} });
  });

  it("a user client asked for a non-user actor throws before any write (mutation: drop the actorType check -> FAILS)", async () => {
    const f = fakeClient({ user: true });
    await expect(emit(f.db, "acct_1", "form.submitted", "form", {}, "system"))
      .rejects.toThrow("cannot record a 'system' event (form.submitted)");
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
  });

  it("any other rpc error throws and inserts nothing (mutation: fall back on every error -> FAILS)", async () => {
    const f = fakeClient({ user: true, rpcError: { code: "42501", message: "record_event: not a member of this account" } });
    await expect(emit(f.db, "acct_1", "note.added", "user_1", {}))
      .rejects.toThrow("event emit failed: record_event: not a member of this account");
    expect(f.from).not.toHaveBeenCalled();
  });
});
