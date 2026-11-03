import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChangeRow } from "@bis/db";

/**
 * F-115 part 1 (S-04), Task 8 Step 2: the download route's own DB-touching and HTTP pieces, shared
 * by the contact and group history routes — paging `listChangeRows` to the end (capped), the F-118
 * prefetch/visit-ended guards mirrored from `contacts/export/route.ts:91-114`, and the 413 response.
 * `@bis/db` is mocked bare, as the export route's own GET test does.
 */
const listChangeRows = vi.fn();
vi.mock("@bis/db", () => ({ listChangeRows: (...a: unknown[]) => listChangeRows(...a) }));

const { fetchBoundedChangeRows, prefetchGuard, visitEndedResponse, tooBigResponse } =
  await import("./history-download");
const { m } = await import("@/lib/messages");

function row(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
    op: "update", field: "phone", before: "a", after: "b", xact: "1",
    authorKind: "person", authorId: "u1", via: null, createdAt: "2026-11-02T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  listChangeRows.mockReset();
});

describe("fetchBoundedChangeRows", () => {
  it("one short chunk: one call, every row returned", async () => {
    listChangeRows.mockResolvedValueOnce([row({ id: 1 }), row({ id: 2 })]);
    const result = await fetchBoundedChangeRows({} as never, "a1", { contactIds: ["c1"] }, 10, 5);
    expect(result).toEqual({ rows: [row({ id: 1 }), row({ id: 2 })] });
    expect(listChangeRows).toHaveBeenCalledTimes(1);
    expect(listChangeRows).toHaveBeenCalledWith({}, "a1", { contactIds: ["c1"] }, undefined, 5);
  });

  it("pages past a full page, cursoring on the last row's createdAt, until a short page ends it", async () => {
    const page1 = [row({ id: 1, createdAt: "2026-11-02T00:00:05Z" }), row({ id: 2, createdAt: "2026-11-02T00:00:03Z" })];
    const page2 = [row({ id: 3, createdAt: "2026-11-02T00:00:01Z" })];
    listChangeRows.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const result = await fetchBoundedChangeRows({} as never, "a1", { contactIds: ["c1"] }, 10, 2);
    expect(result).toEqual({ rows: [...page1, ...page2] });
    expect(listChangeRows).toHaveBeenCalledTimes(2);
    expect(listChangeRows).toHaveBeenNthCalledWith(2, {}, "a1", { contactIds: ["c1"] }, "2026-11-02T00:00:03Z", 2);
  });

  it("stops at the exact cap without going over (mutation: use >= cap -> FAILS at exactly cap)", async () => {
    const page1 = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]; // == cap, full page
    const page2: ChangeRow[] = []; // no more
    listChangeRows.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const result = await fetchBoundedChangeRows({} as never, "a1", { contactIds: ["c1"] }, 3, 3);
    expect(result).toEqual({ rows: page1 });
  });

  it("answers tooBig once the count passes the cap, and reads no further page (mutation: keep paging past the cap -> FAILS the call count)", async () => {
    const page1 = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })];
    const page2 = [row({ id: 4 })]; // pushes the running total to 4, over a cap of 3
    listChangeRows.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const result = await fetchBoundedChangeRows({} as never, "a1", { contactIds: ["c1"] }, 3, 3);
    expect(result).toEqual({ tooBig: true });
    expect(listChangeRows).toHaveBeenCalledTimes(2);
  });

  it("an empty result is an empty rows array, not tooBig", async () => {
    listChangeRows.mockResolvedValueOnce([]);
    expect(await fetchBoundedChangeRows({} as never, "a1", { groupId: "g1" }, 10, 5)).toEqual({ rows: [] });
  });
});

describe("prefetchGuard", () => {
  function req(headers: Record<string, string> = {}): Request {
    return new Request("http://x/history", { headers });
  }
  it.each([["rsc", { rsc: "1" }], ["next-router-prefetch", { "next-router-prefetch": "1" }]])(
    "answers 204 with an empty body for a %s request", async (_label, headers) => {
      const res = prefetchGuard(req(headers));
      expect(res).not.toBeNull();
      expect(res!.status).toBe(204);
      expect(await res!.text()).toBe("");
    });
  it("answers null for a plain request", () => {
    expect(prefetchGuard(req())).toBeNull();
  });
});

describe("visitEndedResponse", () => {
  it("409 plain text, no-store, the shared access-log message (mutation: drop Cache-Control -> FAILS)", async () => {
    const res = visitEndedResponse();
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe(m["accessLog.exportEnded"]);
  });
});

describe("tooBigResponse", () => {
  it("413 plain text in the reader's locale (mutation: read m[...] directly, ignoring locale -> FAILS on es)", async () => {
    const res = tooBigResponse("es");
    expect(res.status).toBe(413);
    expect(await res.text()).toBe(m["history.download.tooBig.es"]);
  });
});
