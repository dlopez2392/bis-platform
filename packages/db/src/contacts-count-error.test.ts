import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countContacts } from "./contacts";

/** A client whose every query resolves to one fixed result. Pure: no network. A count is a HEAD request, and a
 *  refused HEAD has no body for PostgREST to read, so postgrest-js reports it as { message: "" } and the reason
 *  lives only on the response's status (postgrest-js 2.110.8, index.mjs:382-390). */
function answeringDb(result: Record<string, unknown>) {
  const chain: unknown = new Proxy({}, {
    get(_t, method: string) {
      if (method === "then") return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      return () => chain;
    },
  });
  return { from: () => chain, rpc: () => chain } as unknown as SupabaseClient;
}

describe("countContacts names WHY a count failed, even when the refusal has no body", () => {
  it("a refused HEAD (empty message) carries the HTTP status into the thrown message", async () => {
    const db = answeringDb({ data: null, count: null, error: { message: "" }, status: 401, statusText: "Unauthorized" });
    await expect(countContacts(db, "A")).rejects.toThrow("countContacts failed: HTTP 401 Unauthorized");
  });

  it("a search count refused the same way says so too (the matcher's HEAD)", async () => {
    const db = answeringDb({ data: null, count: null, error: { message: "" }, status: 503, statusText: "Service Unavailable" });
    await expect(countContacts(db, "A", { search: "garcia" })).rejects.toThrow("countContacts failed: HTTP 503 Service Unavailable");
  });

  it("an error with a code and a message keeps both, with the status", async () => {
    const db = answeringDb({ data: null, count: null, error: { message: "permission denied for table contacts", code: "42501" }, status: 403, statusText: "Forbidden" });
    await expect(countContacts(db, "A")).rejects.toThrow("countContacts failed: HTTP 403 Forbidden, code 42501: permission denied for table contacts");
  });
});
