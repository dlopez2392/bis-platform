import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({ serviceDb: vi.fn(), unsubscribeFromBrief: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { POST, GET } from "./route";
import { sealBriefToken } from "@/lib/brief/token";
import { sealConsentToken } from "@/lib/consent/token";

const SECRET = "route-test-secret-0123456789abcdef-012";
const USER = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const token = () => sealBriefToken({ v: 1, u: USER, a: ACCT, i: 1_790_000_000_000 }, SECRET);
const ctx = (t: string) => ({ params: Promise.resolve({ token: t }) });
const post = (t: string, body = "List-Unsubscribe=One-Click") => POST(
  new Request(`https://app.example.com/api/brief/off/${t}`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  }), ctx(t));

beforeEach(() => {
  db.serviceDb.mockReset().mockReturnValue({ tag: "service" });
  db.unsubscribeFromBrief.mockReset().mockResolvedValue(true);
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/brief/off/[token]: the one-click way off", () => {
  it("a valid token deletes that subscription and answers 200 with an empty body, no-store, no redirect", async () => {
    const res = await post(token());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBeNull();
    expect(db.unsubscribeFromBrief).toHaveBeenCalledTimes(1);
    expect(db.unsubscribeFromBrief).toHaveBeenCalledWith({ tag: "service" }, { userId: USER, accountId: ACCT });
  });

  it("is idempotent: a subscription that is already gone is still 200, and a second press is the same", async () => {
    db.unsubscribeFromBrief.mockResolvedValue(false);
    expect((await post(token())).status).toBe(200);
    expect((await post(token())).status).toBe(200);
    expect(db.unsubscribeFromBrief).toHaveBeenCalledTimes(2);
  });

  it("accepts any body, even none: the token is the proof (a client that posts nothing can still turn it off)", async () => {
    expect((await post(token(), "")).status).toBe(200);
  });

  it("a bad token is 400 and touches nothing: forged, truncated, and a CONSENT token", async () => {
    const consent = sealConsentToken({ v: 1, a: ACCT, c: "email", t: "ana@example.com", i: 1, n: null }, SECRET);
    for (const bad of ["1.forged.token", "junk", token().slice(0, -3), consent]) {
      const res = await post(bad);
      expect(res.status, bad.slice(0, 12)).toBe(400);
      expect(await res.text()).toBe("");
    }
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
    expect(db.serviceDb).not.toHaveBeenCalled();
  });

  it("CONSENT_TOKEN_SECRET unset is 503 and makes NO database query (not even a client)", async () => {
    const t = token();
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    const res = await post(t);
    expect(res.status).toBe(503);
    expect(db.serviceDb).not.toHaveBeenCalled();
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
  });

  it("a failed write is 503 so the mail client may retry, and the log never carries the token", async () => {
    const t = token();
    db.unsubscribeFromBrief.mockRejectedValueOnce(new Error("unsubscribeFromBrief failed: timeout"));
    expect((await post(t)).status).toBe(503);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(t);
  });
});

describe("GET /api/brief/off/[token]: never deletes", () => {
  it("redirects 303 to the page and changes nothing, so a scanner that prefetches the link cannot turn anyone's brief off", async () => {
    const t = token();
    const res = await GET(new Request(`https://app.example.com/api/brief/off/${t}`), ctx(t));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://app.example.com/brief/off/${t}`);
    expect(db.unsubscribeFromBrief).not.toHaveBeenCalled();
    expect(db.serviceDb).not.toHaveBeenCalled();
  });
});

describe("the link is bound to the person and the business, not to a row", () => {
  type Row = { id: string; userId: string; accountId: string };
  const OTHER_USER = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
  const OTHER_ACCT = "7a3e8f20-5e3c-4a4d-9c77-2b9c3e4f5a61";
  let rows: Row[];
  let n: number;
  /** A re-insert gets a NEW id, as gen_random_uuid does. */
  const insert = (userId: string, accountId: string) => rows.push({ id: `row-${++n}`, userId, accountId });
  beforeEach(() => {
    rows = []; n = 0;
    // The real function's two target shapes, over an in-memory table.
    db.unsubscribeFromBrief.mockImplementation(async (_db: unknown, t: { id: string } | { userId: string; accountId: string }) => {
      const before = rows.length;
      rows = rows.filter((r) => !("id" in t ? r.id === t.id : r.userId === t.userId && r.accountId === t.accountId));
      return rows.length < before;
    });
  });

  it("off, then on again (a new row id), and the link from the OLD email turns the NEW row off", async () => {
    insert(USER, ACCT);
    const oldEmailLink = token();
    rows = []; // Preferences: off, and its Undo re-inserts
    insert(USER, ACCT);
    expect(rows[0]!.id).toBe("row-2");
    expect((await post(oldEmailLink)).status).toBe(200);
    expect(rows).toEqual([]);
  });

  it("a token for (A, acct1) cannot touch (B, acct1) or (A, acct2)", async () => {
    insert(USER, ACCT); insert(OTHER_USER, ACCT); insert(USER, OTHER_ACCT);
    expect((await post(token())).status).toBe(200);
    expect(rows.map((r) => [r.userId, r.accountId])).toEqual([[OTHER_USER, ACCT], [USER, OTHER_ACCT]]);
  });

  it("nothing to delete (already off) is still 200: off is the answer, and it is idempotent", async () => {
    expect((await post(token())).status).toBe(200);
    expect(db.unsubscribeFromBrief).toHaveBeenCalledTimes(1);
  });
});
