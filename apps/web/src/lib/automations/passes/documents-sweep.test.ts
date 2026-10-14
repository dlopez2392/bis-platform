import { describe, it, expect, vi, beforeEach } from "vitest";
const dbMocks = {
  listAbandonedUploads: vi.fn(), deleteAbandonedVersion: vi.fn(), listPurgeableDocuments: vi.fn(), purgeDocumentRow: vi.fn(),
};
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const { documentsSweepPass } = await import("./documents-sweep");

const NOW = new Date("2026-10-13T14:00:24Z");
const order: string[] = [];
const remove = vi.fn(async (paths: string[]) => { order.push(`object:${paths.join(",")}`); return { data: [], error: null as null | { message: string } }; });
const storageFrom = vi.fn(() => ({ remove }));
const ctx = () => ({ db: { storage: { from: storageFrom } }, now: NOW, origin: "x", email: {}, sms: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  remove.mockImplementation(async (paths: string[]) => { order.push(`object:${paths.join(",")}`); return { data: [], error: null }; });
  dbMocks.listAbandonedUploads.mockResolvedValue([{ id: "v1", account_id: "a", document_id: "d1", storage_path: "a/d1/v1" }]);
  dbMocks.listPurgeableDocuments.mockResolvedValue([{ id: "d2", account_id: "a", contact_id: "c", client_group_id: null, category: "id", paths: ["a/d2/v2", "a/d2/v3"] }]);
  // documents.ts's real signatures are (db, v) and (db, doc) — two args, db first (read off the
  // committed source, Task 3); the brief's mock bound a single param named "v"/"d", which — called
  // with db first, per the brief's own Step 3 — would bind to ctx.db and read `.id` off it instead.
  dbMocks.deleteAbandonedVersion.mockImplementation(async (_db: unknown, v: { id: string }) => { order.push(`row:${v.id}`); });
  dbMocks.purgeDocumentRow.mockImplementation(async (_db: unknown, d: { id: string }) => { order.push(`row:${d.id}`); return true; });
});

describe("documentsSweep (spec 5.4, plan review I4)", () => {
  it("every tick: object first, row second, for an upload abandoned 3 h ago and a file trashed 30 days ago (mutation: delete the row before the object -> FAILS)", async () => {
    const c = await documentsSweepPass.run(ctx());
    expect(order).toEqual(["object:a/d1/v1", "row:v1", "object:a/d2/v2,a/d2/v3", "row:d2"]);
    expect(c).toEqual({ abandoned: 1, purged: 1, objectDeleteFailed: 0, rowDeleteFailed: 0 });
    expect(dbMocks.listAbandonedUploads.mock.calls[0]![1]).toBe("2026-10-13T11:00:24.000Z");
    expect(dbMocks.listPurgeableDocuments.mock.calls[0]![1]).toBe("2026-09-13T14:00:24.000Z");
  });
  it("nothing due: no storage client is even built, counters are zero (mutation: build the bucket before the reads -> FAILS)", async () => {
    dbMocks.listAbandonedUploads.mockResolvedValue([]);
    dbMocks.listPurgeableDocuments.mockResolvedValue([]);
    expect(await documentsSweepPass.run(ctx())).toEqual({ abandoned: 0, purged: 0, objectDeleteFailed: 0, rowDeleteFailed: 0 });
    expect(storageFrom).not.toHaveBeenCalled();
  });
  it("a failed object delete keeps its row, the rest still runs, and the run THROWS so the heartbeat fails (mutation: return the counters instead of throwing -> FAILS)", async () => {
    remove.mockResolvedValueOnce({ data: [], error: { message: "storage down" } });
    await expect(documentsSweepPass.run(ctx())).rejects.toThrow(/objectDeleteFailed":1/);
    expect(dbMocks.deleteAbandonedVersion).not.toHaveBeenCalled();
    expect(dbMocks.purgeDocumentRow).toHaveBeenCalledTimes(1);
  });
  it("a row that fails after its object went is counted and thrown too (mutation: swallow it -> FAILS)", async () => {
    dbMocks.deleteAbandonedVersion.mockRejectedValueOnce(new Error("pg down"));
    await expect(documentsSweepPass.run(ctx())).rejects.toThrow(/rowDeleteFailed":1/);
    expect(dbMocks.purgeDocumentRow).toHaveBeenCalledTimes(1);
  });
});
