import { describe, it, expect, vi, beforeEach } from "vitest";

const requireNotTechnician = vi.fn<(accountId: string) => Promise<{ userId: string; isAgency: boolean }>>(
  async () => ({ userId: "user_1", isAgency: true }),
);
vi.mock("@/lib/auth", () => ({
  requireNotTechnician: (accountId: string) => requireNotTechnician(accountId),
}));
const dbForRequest = vi.fn(async () => ({}));
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequest() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const dbMocks = {
  applyImportBatch: vi.fn(),
  buildMatchIndex: vi.fn(),
  emit: vi.fn(),
  serviceDb: vi.fn(() => ({ service: true })),
};
vi.mock("@bis/db", () => dbMocks);

const { importContactsBatchAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireNotTechnician.mockReset().mockResolvedValue({ userId: "user_1", isAgency: true });
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

  // I2 (review): a raw `e.message` would also pass the account-name
  // assertion above, so this proves the logged line goes through
  // `loggableError` specifically — it redacts an email address rather than
  // leaking it into a log line.
  it("the logged failure redacts an email address in the rejection's own message, through loggableError (mutation: log e.message directly instead of loggableError(e) → the address leaks, FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.emit.mockRejectedValue(new Error("rejected: recipient dan@example.com refused"));

    const r = await importContactsBatchAction("acct_9", rows, opts);

    expect(r).toEqual({ ok: true, created: 1, updated: 0, flagged: 0 });
    const [line] = err.mock.calls[0] as [string];
    expect(line).toContain("[email]");
    expect(line).not.toContain("dan@example.com");
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

describe("importContactsBatchAction business writer", () => {
  it("hands applyImportBatch the service client as groupWriter and carries the business (mutation: drop groupWriter -> FAILS)", async () => {
    await importContactsBatchAction("acct_9",
      [{ line: 2, values: { email: "a@b.com", company: "Acme" } }],
      { mapping: { email: "email", company: "company_name" }, createTags: false });
    const [, , rows, , , opts] = dbMocks.applyImportBatch.mock.calls[0]!;
    expect(rows).toEqual([{ input: { email: "a@b.com" }, tags: [], company: "Acme" }]);
    expect(opts).toEqual({ createTags: false, groupWriter: { service: true } });
  });

  // Coordinator review fix: setContactsBusiness runs after the batch's
  // contacts are already committed. applyImportBatch reports a transient
  // failure there as businessLinkFailed rather than throwing (its own test
  // in packages/db), and this action must pass that fact through as a known
  // fact rather than drop it (mutation: drop the businessLinkFailed spread
  // from the action's return -> FAILS).
  it("still reports ok:true with created/updated/flagged when applyImportBatch flags a failed business link", async () => {
    dbMocks.applyImportBatch.mockResolvedValue({ created: 1, updated: 0, flagged: 0, businessLinkFailed: true });

    const r = await importContactsBatchAction("acct_9",
      [{ line: 2, values: { email: "a@b.com", company: "Acme" } }],
      { mapping: { email: "email", company: "company_name" }, createTags: false });

    expect(r).toEqual({ ok: true, created: 1, updated: 0, flagged: 0, businessLinkFailed: true });
  });

  // Final review I-C: the too-long count reaches the wizard too (mutation: drop the businessTooLong spread -> FAILS).
  it("carries businessTooLong through, beside the real counts", async () => {
    dbMocks.applyImportBatch.mockResolvedValue({ created: 2, updated: 0, flagged: 0, businessTooLong: 2 });

    const r = await importContactsBatchAction("acct_9",
      [{ line: 2, values: { email: "a@b.com", company: "Acme" } }],
      { mapping: { email: "email", company: "company_name" }, createTags: false });

    expect(r).toEqual({ ok: true, created: 2, updated: 0, flagged: 0, businessTooLong: 2 });
  });

  it("omits businessLinkFailed entirely when applyImportBatch never reports one", async () => {
    dbMocks.applyImportBatch.mockResolvedValue({ created: 1, updated: 0, flagged: 0 });

    const r = await importContactsBatchAction("acct_9",
      [{ line: 2, values: { email: "a@b.com" } }],
      { mapping: { email: "email" }, createTags: false });

    expect(r).toEqual({ ok: true, created: 1, updated: 0, flagged: 0 });
    expect("businessLinkFailed" in r).toBe(false);
    expect("businessTooLong" in r).toBe(false);
  });
});
