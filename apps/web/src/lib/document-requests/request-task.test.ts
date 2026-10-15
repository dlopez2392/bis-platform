import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DocumentRequestRow } from "@bis/db";

const documentRequestTarget = vi.fn();
const ensureDocumentRequestTask = vi.fn();
const getDocumentRequestForVersion = vi.fn();
vi.mock("@bis/db", () => ({
  documentRequestTarget: (...a: unknown[]) => documentRequestTarget(...a),
  ensureDocumentRequestTask: (...a: unknown[]) => ensureDocumentRequestTask(...a),
  getDocumentRequestForVersion: (...a: unknown[]) => getDocumentRequestForVersion(...a),
}));
const { openRequestTask, openReceivedTaskFor } = await import("./request-task");

const NOW = new Date("2026-10-15T15:00:00.000Z");
/** The request is in ENGLISH (the customer's), the account in Spanish: the title must follow the account (staff read it). */
const REQ: DocumentRequestRow = {
  id: "11111111-1111-4111-8111-111111111111", account_id: "a1", contact_id: "c9", client_group_id: null,
  items: [], language: "en", channel: "text", created_by: "user_1", created_at: "2026-10-14T00:00:00.000Z",
  expires_at: "2026-10-21T00:00:00.000Z", revoked_at: null, revoked_by: null, completed_at: null, sent_at: null,
};
const TARGET = { name: "Ana García", contactId: "c9", language: "en", phone: "+15551234567", email: null, phoneCountryUnconfirmed: false };

const accountReads: string[] = [];
function db(language: string | null = "es") {
  return {
    from: (table: string) => {
      accountReads.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { language }, error: null }),
      };
      return q;
    },
  } as never;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  accountReads.length = 0;
  documentRequestTarget.mockReset(); ensureDocumentRequestTask.mockReset(); getDocumentRequestForVersion.mockReset();
  documentRequestTarget.mockResolvedValue(TARGET);
  ensureDocumentRequestTask.mockResolvedValue({ id: "t1", created: true });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("openRequestTask: the ONE work-queue To-do per request and kind (spec 4.4, 4.5)", () => {
  it("'received' is titled in the ACCOUNT's language, for the request's contact, due now (mutation: the request's language -> FAILS)", async () => {
    await openRequestTask(db("es"), "a1", REQ, "received", NOW);
    expect(accountReads).toEqual(["accounts"]);
    expect(ensureDocumentRequestTask).toHaveBeenCalledTimes(1);
    expect(ensureDocumentRequestTask.mock.calls[0]![1]).toBe("a1");
    expect(ensureDocumentRequestTask.mock.calls[0]![2]).toEqual({
      requestId: REQ.id, kind: "received", contactId: "c9", title: "Ana García mandó documentos · Revisar", dueAt: NOW.toISOString(),
    });
    // The system opens it, never a "user": no person did (events are append-only with explicit actors).
    expect(ensureDocumentRequestTask.mock.calls[0]!.slice(3)).toEqual(["documents-request", "system"]);
  });

  it("'storage_full' uses its own words (mutation: the received key for both -> FAILS)", async () => {
    await openRequestTask(db("en"), "a1", REQ, "storage_full", NOW);
    expect(ensureDocumentRequestTask.mock.calls[0]![2]).toMatchObject({
      kind: "storage_full", title: "Ana García couldn't send documents: your storage is full",
    });
  });

  it("no one to speak to (a deleted contact): nothing is opened, and that is not a failure (mutation: drop the null-target return -> it crashes on target.contactId and logs -> FAILS)", async () => {
    documentRequestTarget.mockResolvedValue(null);
    await openRequestTask(db(), "a1", REQ, "received", NOW);
    expect(ensureDocumentRequestTask).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a To-do that cannot be opened is logged by request id and never rethrown; the line carries no token-shaped string (mutation: rethrow -> FAILS)", async () => {
    ensureDocumentRequestTask.mockRejectedValue(new Error("ensureDocumentRequestTask failed: connection reset"));
    await expect(openRequestTask(db(), "a1", REQ, "received", NOW)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]![0]);
    expect(line).toContain(REQ.id);
    expect(line).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});

describe("openReceivedTaskFor: scanVersion's clean hook", () => {
  it("a staff file (no request) opens nothing and reads nothing more (mutation: open for a staff file -> FAILS)", async () => {
    getDocumentRequestForVersion.mockResolvedValue(null);
    await openReceivedTaskFor(db(), { accountId: "a1", versionId: "v1" }, NOW);
    expect(getDocumentRequestForVersion.mock.calls[0]!.slice(1)).toEqual(["a1", "v1"]);
    expect(documentRequestTarget).not.toHaveBeenCalled();
    expect(ensureDocumentRequestTask).not.toHaveBeenCalled();
  });

  it("a customer file opens its request's 'received' To-do", async () => {
    getDocumentRequestForVersion.mockResolvedValue(REQ);
    await openReceivedTaskFor(db("es"), { accountId: "a1", versionId: "v1" }, NOW);
    expect(ensureDocumentRequestTask.mock.calls[0]![2]).toMatchObject({ requestId: REQ.id, kind: "received" });
  });

  it("a failed request read is logged and never rethrown", async () => {
    getDocumentRequestForVersion.mockRejectedValue(new Error("getDocumentRequestForVersion failed: down"));
    await expect(openReceivedTaskFor(db(), { accountId: "a1", versionId: "v1" }, NOW)).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0]![0])).toContain("v1");
  });
});
