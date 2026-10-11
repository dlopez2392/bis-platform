import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchIndex } from "../contact-import";

/**
 * Coordinator review fix (Task 3a): `setContactsBusiness` runs AFTER every
 * contact in the batch is already committed. A transient failure there (the
 * RPC rejecting, or PostgREST answering an error) must never escape and turn
 * a batch that actually created/updated contacts into a reported failure —
 * the same mistake `import/actions.ts` already avoids for `emit` (actions.ts
 * wraps the ledger write in its own try/catch so a missing event never tells
 * the operator the import failed). A fake-client test, not `withTestAccount`:
 * migration 0069 (`client_groups`) is not on bis-ci yet, and a live run there
 * would orphan an account on teardown.
 *
 * `./contacts` is mocked wholesale so this file never touches a real or fake
 * Postgres at all — `createContact`/`updateContact`/`listTags`/
 * `addTagToContacts` are canned, and the one thing under test is
 * `applyImportBatch`'s OWN handling of a failing `setContactsBusiness` call
 * (the real implementation, imported unmocked from `../client-groups`,
 * running against a fake `groupWriter` whose `.rpc()` answers an error).
 */
vi.mock("../contacts", () => ({
  createContact: vi.fn(async () => ({ id: "c1", existing: false, flagged: false })),
  updateContact: vi.fn(async () => ({ flagged: false })),
  listTags: vi.fn(async () => []),
  addTagToContacts: vi.fn(async () => undefined),
  phoneDigits: (v: string) => v.replace(/\D/g, ""),
  phoneKeyOf: (v: string) => v.replace(/\D/g, ""),
}));

const { applyImportBatch } = await import("../contact-import");

afterEach(() => {
  vi.restoreAllMocks();
});

function freshIndex(): MatchIndex {
  return { byEmail: new Map(), byPhone: new Map() };
}

describe("applyImportBatch: a transient setContactsBusiness failure never costs the created/updated counts", () => {
  it("a groupWriter whose rpc answers an error still returns created/updated, and reports businessLinkFailed: true (mutation: remove the try/catch -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const groupWriter = { rpc } as unknown as SupabaseClient;

    const r = await applyImportBatch(
      {} as SupabaseClient, "a1",
      [{ input: { email: "a@b.co" }, tags: [], company: "Acme" }],
      freshIndex(), "user_test", { createTags: false, groupWriter },
    );

    expect(r).toEqual({ created: 1, updated: 0, flagged: 0, businessLinkFailed: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("logs the failure naming the account, without throwing (mutation: swallow silently / drop the console.error -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const groupWriter = { rpc } as unknown as SupabaseClient;

    await applyImportBatch(
      {} as SupabaseClient, "a1",
      [{ input: { email: "a@b.co" }, tags: [], company: "Acme" }],
      freshIndex(), "user_test", { createTags: false, groupWriter },
    );

    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]?.[0]).toContain("a1");
    err.mockRestore();
  });

  // Mirrors import/actions.ts's own loggableError redaction (that file lives
  // in apps/web, which this package cannot import) — a transient RPC error's
  // message must never put a customer's email address in a log line.
  it("redacts an email address carried in the rpc error's own message (mutation: log the raw message instead of the redacted one -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { message: "duplicate key: dan@example.com already linked" } }));
    const groupWriter = { rpc } as unknown as SupabaseClient;

    await applyImportBatch(
      {} as SupabaseClient, "a1",
      [{ input: { email: "a@b.co" }, tags: [], company: "Acme" }],
      freshIndex(), "user_test", { createTags: false, groupWriter },
    );

    const [line] = err.mock.calls[0] as [string];
    expect(line).toContain("[email]");
    expect(line).not.toContain("dan@example.com");
    err.mockRestore();
  });

  it("no business, no groupWriter call, no businessLinkFailed field at all", async () => {
    const r = await applyImportBatch(
      {} as SupabaseClient, "a1",
      [{ input: { email: "a@b.co" }, tags: [] }],
      freshIndex(), "user_test", { createTags: false },
    );
    expect(r).toEqual({ created: 1, updated: 0, flagged: 0 });
    expect("businessLinkFailed" in r).toBe(false);
  });

  it("a successful groupWriter never reports businessLinkFailed", async () => {
    const rpc = vi.fn(async () => ({ data: [{ contact_id: "c1", status: "ok", removed: null, added: "Acme" }], error: null }));
    // setContactsBusiness emits client_group.business_set on a changed row —
    // isUserClient(groupWriter) is false (no USER_CLIENT symbol), so emit
    // takes the service-client branch and inserts into "events" directly.
    const from = vi.fn(() => ({ insert: async () => ({ error: null }) }));
    const groupWriter = { rpc, from } as unknown as SupabaseClient;

    const r = await applyImportBatch(
      {} as SupabaseClient, "a1",
      [{ input: { email: "a@b.co" }, tags: [], company: "Acme" }],
      freshIndex(), "user_test", { createTags: false, groupWriter },
    );

    expect(r).toEqual({ created: 1, updated: 0, flagged: 0 });
  });
});

/**
 * Task 3a review minor, closed here: `setContactsBusiness` ONLY throws on a
 * transport failure (the block above) — a too-long name comes back as a
 * per-row STATUS in its resolved array, not an exception, and
 * `applyImportBatch` was discarding that whole array (`await
 * setContactsBusiness(...)` with the result unused). A too-long business
 * name on a CSV row therefore vanished with no log and no visible count,
 * the same silent-loss shape Task 3b's forms fix (commit 33031002) closed
 * for enrich.ts. Same fake-groupWriter posture as the suite above — no real
 * or fake Postgres, `setContactsBusiness` itself unmocked from
 * `../client-groups`, only its `.rpc()` call faked.
 */
describe("applyImportBatch: a too_long business-write status is counted and logged, never silently dropped", () => {
  it("counts every too_long row in the batch result without touching created/updated (mutation: stop reading the per-row status -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({
      data: [
        { contact_id: "c1", status: "too_long", removed: null, added: null },
        { contact_id: "c1", status: "too_long", removed: null, added: null },
      ],
      error: null,
    }));
    const groupWriter = { rpc } as unknown as SupabaseClient;

    const r = await applyImportBatch(
      {} as SupabaseClient, "a1",
      [
        { input: { email: "a@b.co" }, tags: [], company: "A".repeat(121) },
        { input: { email: "b@b.co" }, tags: [], company: "B".repeat(130) },
      ],
      freshIndex(), "user_test", { createTags: false, groupWriter },
    );

    // created/updated/flagged unchanged by this task's own instruction —
    // both rows still resolve to real contacts even though their business
    // name is too long for a group.
    expect(r).toEqual({ created: 2, updated: 0, flagged: 0, businessTooLong: 2 });
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it("logs a stable prefix naming the contact and account, never the over-length business name", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({
      data: [{ contact_id: "c1", status: "too_long", removed: null, added: null }],
      error: null,
    }));
    const groupWriter = { rpc } as unknown as SupabaseClient;
    const overLong = "Z".repeat(121);

    await applyImportBatch(
      {} as SupabaseClient, "a1",
      [{ input: { email: "a@b.co" }, tags: [], company: overLong }],
      freshIndex(), "user_test", { createTags: false, groupWriter },
    );

    const [line] = err.mock.calls[0] as [string];
    expect(line).toContain("applyImportBatch:");
    expect(line).toContain("too_long");
    expect(line).toContain("c1");
    expect(line).toContain("a1");
    expect(line).not.toContain(overLong);
    err.mockRestore();
  });

  it("a batch with no too_long row carries no businessTooLong field at all", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ contact_id: "c1", status: "ok", removed: null, added: "Acme" }],
      error: null,
    }));
    const from = vi.fn(() => ({ insert: async () => ({ error: null }) }));
    const groupWriter = { rpc, from } as unknown as SupabaseClient;

    const r = await applyImportBatch(
      {} as SupabaseClient, "a1",
      [{ input: { email: "a@b.co" }, tags: [], company: "Acme" }],
      freshIndex(), "user_test", { createTags: false, groupWriter },
    );

    expect("businessTooLong" in r).toBe(false);
  });
});
