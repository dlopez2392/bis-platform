import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAccountAccess = vi.fn<(accountId: string) => Promise<{ userId: string; isAgency: boolean }>>(
  async () => ({ userId: "user_1", isAgency: true }),
);
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (accountId: string) => requireAccountAccess(accountId),
}));
const dbForRequest = vi.fn(async () => ({}));
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequest() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const dbMocks = {
  applyImportBatch: vi.fn(),
  buildMatchIndex: vi.fn(),
  emit: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const { importContactsBatchAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_1", isAgency: true });
  dbForRequest.mockReset().mockResolvedValue({});
  dbMocks.buildMatchIndex.mockResolvedValue({ byEmail: new Map(), byPhone: new Map() });
  dbMocks.applyImportBatch.mockResolvedValue({ created: 1, updated: 0, flagged: 0 });
});

describe("importContactsBatchAction ledger write failure", () => {
  const rows = [{ line: 1, values: { email: "a@b.com" } }];
  const opts = { mapping: { email: "email" }, createTags: false };

  it("still reports ok:true AND logs the failure naming the account when emit rejects (mutation: no console.error on emit failure → FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.emit.mockRejectedValue(new Error("ledger down"));

    const r = await importContactsBatchAction("acct_9", rows, opts);

    expect(r).toEqual({ ok: true, created: 1, updated: 0, flagged: 0 });
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]?.[0]).toContain("acct_9");
    err.mockRestore();
  });

  it("does not log when emit succeeds", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.emit.mockResolvedValue(undefined);

    const r = await importContactsBatchAction("acct_9", rows, opts);

    expect(r).toEqual({ ok: true, created: 1, updated: 0, flagged: 0 });
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
