import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOpportunity } from "./opportunities";

/**
 * F-115 (migration 0112, plan Task 3 Step 7): `createOpportunity` is the representative test for the
 * "opportunities" writer family (also: moveOpportunityStage, moveOpportunityToStage, updateOpportunity,
 * setOpportunityStatus) — the header is sent on the write, and a missing author is refused before any
 * query. Pure: the live round trip is `test/opportunities.test.ts`. Pattern follows
 * `contacts-archive.test.ts`'s `recordingDb`.
 */
function recordingDb(answers: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const headers: { table: string; name: string; value: string }[] = [];
  const chainFor = (table: string): unknown => {
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve(answers[table] ?? { data: [], error: null }).then(res, rej);
        }
        if (method === "setHeader") {
          return (name: string, value: string) => { headers.push({ table, name, value }); return chain; };
        }
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  const db = { from: (table: string) => chainFor(table) } as unknown as SupabaseClient;
  return { db, calls, headers };
}

const AUTHOR = { authorKind: "person", authorId: "user_owner" } as const;
const STAGE_OK = { data: [{ id: "s1", name: "New Lead", position: 0 }], error: null };
const CONTACT_OK = { data: { id: "c1", archived_at: null, merged_into: null }, error: null };

describe("createOpportunity", () => {
  it("the insert carries the author on x-bis-author (F-115; mutation: drop withAuthor from the insert -> FAILS)", async () => {
    const { db, headers } = recordingDb({
      pipeline_stages: STAGE_OK, contacts: CONTACT_OK, opportunities: { data: { id: "o1" }, error: null },
    });
    await createOpportunity(db, "acct-1", { contactId: "c1", pipelineId: "p1", name: "Deck" }, AUTHOR);
    expect(headers).toEqual([
      { table: "opportunities", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner" }) },
    ]);
  });

  it("a service client with no author is refused before any query (F-115; mutation: drop requireAuthor -> the insert runs unattributed, FAILS)", async () => {
    const { db, calls } = recordingDb({ pipeline_stages: STAGE_OK, contacts: CONTACT_OK });
    await expect(
      createOpportunity(db, "acct-1", { contactId: "c1", pipelineId: "p1", name: "Deck" }, undefined as never),
    ).rejects.toThrow("createOpportunity: a server write must say who made it");
    expect(calls).toEqual([]);
  });
});
