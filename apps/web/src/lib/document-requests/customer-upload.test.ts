import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DocumentRequestRow, SupabaseClient } from "@bis/db";

/**
 * The public rule (study 3.4; spec 4.4), against a RECORDING fake client: every from()/rpc()/storage
 * call is kept with its arguments, so a query that lost its account or request scope fails by name.
 * @bis/db's own request reads run for real against the fake (spied, calling through); only Task 4's
 * finish, clean-up and To-do are mocked.
 */
type Spied = "findDocumentRequestByTokenHash" | "startDocumentRequestUpload" | "getRequestDocument" | "getDocumentVersion"
  | "listRequestFiles" | "getBranding" | "listPhoneNumbersForAccount";
const db = vi.hoisted(() => ({}) as Record<Spied, ReturnType<typeof vi.fn>>);
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  for (const name of [
    "findDocumentRequestByTokenHash", "startDocumentRequestUpload", "getRequestDocument", "getDocumentVersion",
    "listRequestFiles", "getBranding", "listPhoneNumbersForAccount",
  ] as const) db[name] = vi.fn(real[name] as (...a: unknown[]) => unknown);
  return { ...real, ...db };
});
const finishStoredUpload = vi.fn();
const cleanUpUpload = vi.fn();
vi.mock("@/lib/documents/finish-upload", () => ({
  finishStoredUpload: (...a: unknown[]) => finishStoredUpload(...a),
  cleanUpUpload: (...a: unknown[]) => cleanUpUpload(...a),
}));
const openRequestTask = vi.fn();
vi.mock("@/lib/document-requests/request-task", () => ({ openRequestTask: (...a: unknown[]) => openRequestTask(...a) }));

const { customerStart, customerFinish, customerPage, resolveToken } = await import("./customer-upload");
const { requestToken, tokenHash } = await import("./token");
const { nextCustomerPollMs } = await import("./customer-state");
const { m } = await import("@/lib/messages");

const SECRET = "customer-upload-test-secret-000000032";
const SUPA = "https://proj.supabase.co";
const NOW = new Date("2026-03-01T12:00:00.000Z");
const ACC = "44444444-4444-4444-8444-444444444444";
const REQ_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "99999999-9999-4999-8999-999999999999";
const D = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";
const PATH = `${ACC}/${D}/${V}`;
let TOKEN = "";

const REQUEST: DocumentRequestRow = {
  id: REQ_ID, account_id: ACC, contact_id: "c9", client_group_id: null,
  items: [{ key: "insurance", category: "insurance", note: null }, { key: "other", category: "other", note: "Fotos del techo" }],
  language: "es", channel: "text", created_by: "user_1", created_at: "2026-02-27T12:00:00.000Z",
  expires_at: "2026-03-06T12:00:00.000Z", revoked_at: null, revoked_by: null, completed_at: null, sent_at: null,
};
const EXPIRED = { ...REQUEST, expires_at: "2026-03-01T11:59:59.000Z" };
const REVOKED = { ...REQUEST, revoked_at: "2026-02-28T00:00:00.000Z", revoked_by: "user_1" };
const COMPLETED = { ...REQUEST, completed_at: "2026-02-28T00:00:00.000Z" };

type Op = [string, ...unknown[]];
type Query = { table: string; ops: Op[] };
type Answer = { data: unknown; error: { message: string } | null };
type World = {
  request: DocumentRequestRow | null; requestDocument: unknown; files: unknown[]; version: unknown;
  account: Answer; phones: unknown[]; phonesError: string | null; rpc: Answer; upload: Answer;
};

let queries: Query[];
let rpcs: { fn: string; args: Record<string, unknown> }[];
let uploads: { bucket: string; path: string }[];
let world: World;

const ok = (data: unknown): Answer => ({ data, error: null });
const eqs = (q: Query) => q.ops.filter((o) => o[0] === "eq").map((o) => o.slice(1));

function answer(q: Query): Answer {
  const eq = (col: string) => eqs(q).find((e) => e[0] === col)?.[1];
  switch (q.table) {
    case "document_requests":
      return ok(world.request && eq("token_hash") === tokenHash(TOKEN) ? world.request : null);
    case "documents":
      return String(q.ops.find((o) => o[0] === "select")?.[1]).includes("versions:") ? ok(world.files) : ok(world.requestDocument);
    case "document_versions": return ok(world.version);
    case "accounts": return world.account;
    case "phone_numbers": return world.phonesError ? { data: null, error: { message: world.phonesError } } : ok(world.phones);
    default: throw new Error(`unexpected table ${q.table}`);
  }
}

function fakeDb(): SupabaseClient {
  return {
    from(table: string) {
      const q: Query = { table, ops: [] };
      queries.push(q);
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "in", "gt", "order", "limit"]) b[op] = (...a: unknown[]) => { q.ops.push([op, ...a]); return b; };
      b.maybeSingle = async () => { q.ops.push(["maybeSingle"]); return answer(q); };
      b.single = async () => { q.ops.push(["single"]); return answer(q); };
      b.then = (res: (v: Answer) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(() => answer(q)).then(res, rej);
      return b;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      return world.rpc;
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => { uploads.push({ bucket, path }); return world.upload; },
      }),
    },
  } as unknown as SupabaseClient;
}

const START_BODY = { itemKey: "insurance", name: "scan.pdf", size: 1200, contentType: "application/pdf" };
const FINISH_BODY = { documentId: D, versionId: V };
const REQ_DOC = { id: D, account_id: ACC, request_id: REQ_ID, request_item_key: "insurance", deleted_at: null };

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("DOCUMENT_LINK_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPA);
  TOKEN = requestToken(REQ_ID);
  queries = []; rpcs = []; uploads = [];
  world = {
    request: REQUEST, requestDocument: REQ_DOC, files: [], version: null,
    account: ok({ brand_name: "Techos Río", brand_logo_path: `${ACC}/logo.png`, brand_color: "#0F766E" }),
    phones: [{ id: "p0", account_id: ACC, e164: "+18005550000", telnyx_id: null, status: "provisioned" },
      { id: "p1", account_id: ACC, e164: "+19565550123", telnyx_id: "t", status: "live" }],
    phonesError: null,
    rpc: ok({ status: "ok", document_id: D, version_id: V, storage_path: PATH }),
    upload: ok({ signedUrl: "https://proj.supabase.co/storage/v1/object/upload/sign/documents/x?token=up", token: "up", path: PATH }),
  };
  for (const f of Object.values(db)) f.mockClear();
  finishStoredUpload.mockReset().mockResolvedValue({ ok: true, scan: "clean" });
  cleanUpUpload.mockReset().mockResolvedValue(undefined);
  openRequestTask.mockReset().mockResolvedValue(undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); errorSpy.mockRestore(); });

describe("1. the token's shape is checked before anything is read", () => {
  it("a token of the wrong shape answers 404 not_found and makes NO database call (mutation: look it up anyway -> FAILS)", async () => {
    for (const bad of ["short", "A".repeat(44), "A".repeat(42) + "=", `${"A".repeat(42)}/`, ""]) {
      expect(await customerStart(fakeDb(), bad, START_BODY, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
      expect(await customerFinish(fakeDb(), bad, FINISH_BODY, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
      expect((await customerPage(fakeDb(), bad, NOW)).state).toBe("not_found");
    }
    expect(queries).toEqual([]);
    expect(rpcs).toEqual([]);
  });
});

describe("2. the token is looked up by its sha256, then the request's state decides", () => {
  it("an unknown hash answers 404 on both routes, after ONE lookup by sha256 and nothing else (mutation: look up the raw token -> FAILS)", async () => {
    const stranger = requestToken(OTHER_ID);
    expect(await customerStart(fakeDb(), stranger, START_BODY, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await customerFinish(fakeDb(), stranger, FINISH_BODY, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(queries.map((q) => [q.table, eqs(q)])).toEqual([
      ["document_requests", [["token_hash", tokenHash(stranger)]]],
      ["document_requests", [["token_hash", tokenHash(stranger)]]],
    ]);
    expect(finishStoredUpload).not.toHaveBeenCalled();
    expect(rpcs).toEqual([]);
  });

  it("resolveToken names the state: open, expired at the very instant, revoked over completed (mutation: treat expired as open -> FAILS)", async () => {
    world.request = REQUEST;
    expect((await resolveToken(fakeDb(), TOKEN, NOW)).kind).toBe("open");
    world.request = { ...REQUEST, expires_at: NOW.toISOString() };
    expect((await resolveToken(fakeDb(), TOKEN, NOW)).kind).toBe("expired");
    world.request = { ...COMPLETED, revoked_at: "2026-02-28T00:00:00.000Z" };
    expect((await resolveToken(fakeDb(), TOKEN, NOW)).kind).toBe("revoked");
  });

  it("START: an expired, a revoked and a completed request answer 410 with the state, and the start function is never called (mutation: drop the state check -> FAILS)", async () => {
    for (const [row, word] of [[EXPIRED, "expired"], [REVOKED, "revoked"], [COMPLETED, "completed"]] as const) {
      world.request = row;
      expect(await customerStart(fakeDb(), TOKEN, START_BODY, NOW)).toEqual({ status: 410, body: { error: word } });
    }
    expect(db.startDocumentRequestUpload).not.toHaveBeenCalled();
    expect(rpcs).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("FINISH: a REVOKED request answers 410 revoked and nothing is finished (deviation 13, ruling I6; mutation: accept revoked -> FAILS)", async () => {
    world.request = REVOKED;
    expect(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).toEqual({ status: 410, body: { error: "revoked" } });
    expect(finishStoredUpload).not.toHaveBeenCalled();
    expect(db.getRequestDocument).not.toHaveBeenCalled();
  });

  it("FINISH: a COMPLETED or EXPIRED request still finishes a version of ITS OWN document (deviation 13; mutation: refuse completed or expired -> FAILS)", async () => {
    for (const row of [COMPLETED, EXPIRED]) {
      world.request = row;
      expect(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).toEqual({ status: 200, body: { state: "received" } });
    }
    expect(finishStoredUpload).toHaveBeenCalledTimes(2);
    expect(db.getRequestDocument.mock.calls.map((c) => c.slice(1))).toEqual([[ACC, REQ_ID, D], [ACC, REQ_ID, D]]);
  });
});

describe("3. start: the customer names an item; everything else comes from the request", () => {
  it("the start function receives the request's account and id, the item key, the size, type and name, and the item's Spanish label; the body's own accountId/contactId/category/title are IGNORED (mutation: read any of them from the body -> FAILS)", async () => {
    const r = await customerStart(fakeDb(), TOKEN, {
      ...START_BODY, accountId: OTHER_ID, contactId: OTHER_ID, category: "id", title: "Pasaporte", requestId: OTHER_ID,
    }, NOW);
    expect(r).toEqual({ status: 200, body: { documentId: D, versionId: V, uploadUrl: "https://proj.supabase.co/storage/v1/object/upload/sign/documents/x?token=up" } });
    expect(db.startDocumentRequestUpload).toHaveBeenCalledTimes(1);
    expect(db.startDocumentRequestUpload.mock.calls[0]![1]).toEqual({
      accountId: ACC, requestId: REQ_ID, itemKey: "insurance", bytes: 1200, contentType: "application/pdf", originalName: "scan.pdf", title: "Seguro",
    });
    expect(rpcs).toEqual([{ fn: "start_document_request_upload", args: {
      p_account_id: ACC, p_request_id: REQ_ID, p_item_key: "insurance", p_bytes: 1200, p_content_type: "application/pdf",
      p_original_name: "scan.pdf", p_title: "Seguro",
    } }]);
    expect(uploads).toEqual([{ bucket: "documents", path: PATH }]);
  });

  it("the 'other' item's title is its note, and an English request's label is English (mutation: always the category word -> FAILS)", async () => {
    await customerStart(fakeDb(), TOKEN, { ...START_BODY, itemKey: "other" }, NOW);
    world.request = { ...REQUEST, language: "en" };
    await customerStart(fakeDb(), TOKEN, START_BODY, NOW);
    expect(db.startDocumentRequestUpload.mock.calls.map((c) => (c[1] as { title: string }).title)).toEqual(["Fotos del techo", "Insurance"]);
  });
});

describe("4. start validation: refused before the start function", () => {
  it("each bad body answers its own word and never reaches the RPC (mutations: drop the size cap -> FAILS; drop the extension check -> FAILS)", async () => {
    const cases: [unknown, number, string][] = [
      [{ ...START_BODY, size: 0 }, 400, "bad_request"],
      [{ ...START_BODY, size: 12.5 }, 400, "bad_request"],
      [{ ...START_BODY, size: "1200" }, 400, "bad_request"],
      [{ ...START_BODY, size: 26_214_401 }, 413, "too_large"],
      [{ ...START_BODY, name: "scan.exe" }, 400, "bad_type"],
      [{ ...START_BODY, name: 42 }, 400, "bad_type"],
      [{ ...START_BODY, contentType: "application/x-msdownload" }, 400, "bad_type"],
      [{ ...START_BODY, itemKey: "passport" }, 400, "no_item"],
      [{ ...START_BODY, itemKey: "permit" }, 400, "no_item"], // a category, but not one this request asked for
      [null, 400, "bad_request"],
      [[START_BODY], 400, "bad_request"],
      ["itemKey=insurance", 400, "bad_request"],
    ];
    const got = [];
    for (const [body] of cases) got.push(await customerStart(fakeDb(), TOKEN, body, NOW));
    expect(got).toEqual(cases.map(([, status, error]) => ({ status, body: { error } })));
    expect(db.startDocumentRequestUpload).not.toHaveBeenCalled();
    expect(rpcs).toEqual([]);
  });

  it("exactly 25 MiB is allowed (mutation: >= the cap -> FAILS)", async () => {
    expect((await customerStart(fakeDb(), TOKEN, { ...START_BODY, size: 26_214_400 }, NOW)).status).toBe(200);
  });
});

describe("5. the start function's refusals", () => {
  it("over_quota answers 409 with the business's LIVE number, formatted, and opens the storage_full To-do once (mutation: no To-do -> FAILS; mutation: the first number whatever its status -> FAILS)", async () => {
    world.rpc = ok({ status: "over_quota" });
    const db1 = fakeDb();
    expect(await customerStart(db1, TOKEN, START_BODY, NOW)).toEqual({ status: 409, body: { error: "over_quota", phone: "(956) 555-0123" } });
    expect(openRequestTask).toHaveBeenCalledTimes(1);
    expect(openRequestTask).toHaveBeenCalledWith(db1, ACC, REQUEST, "storage_full", NOW);
    const phoneRead = queries.find((q) => q.table === "phone_numbers")!;
    expect(eqs(phoneRead)).toEqual([["account_id", ACC]]);
    expect(uploads).toEqual([]);
  });

  it("over_quota with no live number answers without a phone (mutation: phone: null in the body -> FAILS)", async () => {
    world.rpc = ok({ status: "over_quota" });
    world.phones = [{ id: "p0", account_id: ACC, e164: "+18005550000", telnyx_id: null, status: "provisioned" }];
    expect(await customerStart(fakeDb(), TOKEN, START_BODY, NOW)).toEqual({ status: 409, body: { error: "over_quota" } });
  });

  it("the other refusals: rate_limited 429, too_large 413, no_item 400, not_found 404, and a request that closed under the lock 410 (mutation: rate_limited as 400 -> FAILS)", async () => {
    const got = [];
    for (const status of ["rate_limited", "too_large", "no_item", "not_found", "expired", "revoked", "completed"]) {
      world.rpc = ok({ status });
      got.push(await customerStart(fakeDb(), TOKEN, START_BODY, NOW));
    }
    expect(got).toEqual([
      { status: 429, body: { error: "rate_limited" } }, { status: 413, body: { error: "too_large" } },
      { status: 400, body: { error: "no_item" } }, { status: 404, body: { error: "not_found" } },
      { status: 410, body: { error: "expired" } }, { status: 410, body: { error: "revoked" } }, { status: 410, body: { error: "completed" } },
    ]);
    expect(openRequestTask).not.toHaveBeenCalled();
    expect(uploads).toEqual([]);
  });
});

describe("6. a failed upload URL", () => {
  it("cleans up the reserved ids and answers 503 failed (mutation: no clean-up -> FAILS)", async () => {
    world.upload = { data: null, error: { message: "storage unavailable" } };
    const db1 = fakeDb();
    expect(await customerStart(db1, TOKEN, START_BODY, NOW)).toEqual({ status: 503, body: { error: "failed" } });
    expect(cleanUpUpload).toHaveBeenCalledTimes(1);
    expect(cleanUpUpload).toHaveBeenCalledWith(db1, ACC, D, V, PATH);
  });
});

describe("7. finish: the document must be THIS request's, and the customer is never a user", () => {
  it("the proof is read with the request's account and id; a document of another request or account answers 404 and nothing is finished (mutation: skip the proof -> FAILS)", async () => {
    world.requestDocument = null;
    expect(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(finishStoredUpload).not.toHaveBeenCalled();
    const proof = queries.find((q) => q.table === "documents")!;
    expect(eqs(proof)).toEqual([["account_id", ACC], ["request_id", REQ_ID], ["id", D]]);
  });

  it("finishStoredUpload receives the request's account, the proven ids, and the customer as the SYSTEM (orchestrator ruling; mutations: drop actorType -> FAILS; actorId without the request id -> FAILS)", async () => {
    const db1 = fakeDb();
    expect(await customerFinish(db1, TOKEN, { documentId: D.toUpperCase(), versionId: V.toUpperCase(), accountId: OTHER_ID }, NOW))
      .toEqual({ status: 200, body: { state: "received" } });
    expect(finishStoredUpload).toHaveBeenCalledTimes(1);
    expect(finishStoredUpload.mock.calls[0]![0]).toBe(db1);
    expect(finishStoredUpload.mock.calls[0]![1]).toEqual({
      accountId: ACC, documentId: D, versionId: V, trashed: false, actorId: `customer:${REQ_ID}`, actorType: "system",
    });
  });

  it("a file the business trashed meanwhile is finished as trashed (mutation: trashed always false -> FAILS)", async () => {
    world.requestDocument = { ...REQ_DOC, deleted_at: "2026-03-01T11:00:00.000Z" };
    finishStoredUpload.mockResolvedValue({ ok: false, error: "documents.error.trashed" });
    expect(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).toEqual({ status: 400, body: { error: "refused" } });
    expect((finishStoredUpload.mock.calls[0]![1] as { trashed: boolean }).trashed).toBe(true);
  });

  it("each scan answer becomes the customer's state (mutation: held as received -> FAILS)", async () => {
    const got: Record<string, unknown> = {};
    for (const scan of ["clean", "pending", "held", "unreached", "stale", "infected"]) {
      finishStoredUpload.mockResolvedValue({ ok: true, scan });
      got[scan] = (await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).body;
    }
    expect(got).toEqual({
      clean: { state: "received" }, pending: { state: "checking" }, held: { state: "checking" },
      unreached: { state: "checking" }, stale: { state: "checking" }, infected: { state: "virus" },
    });
  });

  it("unscannable says password only for THIS version's Heuristics.Encrypted.* signature (mutations: always unscannable -> FAILS; trust a version of another document -> FAILS)", async () => {
    finishStoredUpload.mockResolvedValue({ ok: true, scan: "unscannable" });
    const version = { id: V, document_id: D, account_id: ACC, scan_status: "unscannable", scan_signature: "Heuristics.Encrypted.PDF", status: "ready" };
    world.version = version;
    expect((await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).body).toEqual({ state: "password" });
    const versionRead = queries.find((q) => q.table === "document_versions")!;
    expect(eqs(versionRead)).toEqual([["account_id", ACC], ["id", V]]);
    world.version = { ...version, scan_signature: null };
    expect((await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).body).toEqual({ state: "unscannable" });
    world.version = { ...version, document_id: OTHER_ID };
    expect((await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).body).toEqual({ state: "unscannable" });
  });

  it("a refused finish answers a bare word: bad_type, refused, upload (mutation: 200 on a refusal -> FAILS)", async () => {
    const got = [];
    for (const error of ["documents.error.badType", "documents.error.refused", "documents.error.upload", "documents.error.somethingNew"]) {
      finishStoredUpload.mockResolvedValue({ ok: false, error });
      got.push(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW));
    }
    expect(got).toEqual([
      { status: 400, body: { error: "bad_type" } }, { status: 400, body: { error: "refused" } },
      { status: 400, body: { error: "upload" } }, { status: 400, body: { error: "upload" } },
    ]);
  });

  it("a body without two ids answers 400 bad_request before any document read (mutation: drop the id check -> FAILS)", async () => {
    for (const body of [null, {}, { documentId: D }, { documentId: D, versionId: "v1" }, { documentId: `${D}'`, versionId: V }, [D, V]]) {
      expect(await customerFinish(fakeDb(), TOKEN, body, NOW)).toEqual({ status: 400, body: { error: "bad_request" } });
    }
    expect(db.getRequestDocument).not.toHaveBeenCalled();
    expect(finishStoredUpload).not.toHaveBeenCalled();
  });
});

describe("8. nothing logs the token", () => {
  it("a start whose start function fails answers 503 failed and logs the request id, never the token (mutation: log the token -> FAILS)", async () => {
    world.rpc = { data: null, error: { message: "connection reset" } };
    expect(await customerStart(fakeDb(), TOKEN, START_BODY, NOW)).toEqual({ status: 503, body: { error: "failed" } });
    const lines = errorSpy.mock.calls.flat().map(String);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain(REQ_ID);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(tokenHash(TOKEN));
  });

  it("a failed lookup and a failed finish proof answer 503 failed, never logging the token (mutation: log the token -> FAILS)", async () => {
    db.findDocumentRequestByTokenHash.mockRejectedValueOnce(new Error("findDocumentRequestByTokenHash failed: timeout"));
    expect(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).toEqual({ status: 503, body: { error: "failed" } });
    db.getRequestDocument.mockRejectedValueOnce(new Error("getRequestDocument failed: timeout"));
    expect(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW)).toEqual({ status: 503, body: { error: "failed" } });
    const lines = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(lines).toContain(REQ_ID);
    expect(lines).not.toContain(TOKEN);
  });
});

describe("9. every refusal is a bare word", () => {
  it("no refusal body carries a request id, an account id, a path or anything but { error } (plus phone on over-quota) (mutation: add requestId -> FAILS)", async () => {
    const answers = [];
    answers.push(await customerStart(fakeDb(), "bad", START_BODY, NOW));
    answers.push(await customerStart(fakeDb(), TOKEN, { ...START_BODY, itemKey: "passport" }, NOW));
    answers.push(await customerStart(fakeDb(), TOKEN, { ...START_BODY, size: 26_214_401 }, NOW));
    world.rpc = ok({ status: "rate_limited" });
    answers.push(await customerStart(fakeDb(), TOKEN, START_BODY, NOW));
    world.rpc = ok({ status: "over_quota" });
    answers.push(await customerStart(fakeDb(), TOKEN, START_BODY, NOW));
    world.upload = { data: null, error: { message: `no bucket for ${PATH}` } };
    world.rpc = ok({ status: "ok", document_id: D, version_id: V, storage_path: PATH });
    answers.push(await customerStart(fakeDb(), TOKEN, START_BODY, NOW));
    world.requestDocument = null;
    answers.push(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW));
    world.request = REVOKED;
    answers.push(await customerFinish(fakeDb(), TOKEN, FINISH_BODY, NOW));
    expect(answers.map((a) => a.status)).toEqual([404, 400, 413, 429, 409, 503, 404, 410]);
    for (const a of answers) {
      expect(Object.keys(a.body).sort()).toEqual(a.status === 409 ? ["error", "phone"] : ["error"]);
      const text = JSON.stringify(a.body);
      for (const secret of [REQ_ID, ACC, D, V, TOKEN, "/"]) expect(text).not.toContain(secret);
    }
  });
});

describe("10. customerPage: the page's whole read", () => {
  const FILES = [
    { id: "d1", request_item_key: "insurance", created_at: "2026-03-01T11:50:00.000Z", versions: [
      { id: "v1", status: "ready", scan_status: "clean", scan_signature: null, created_at: "2026-03-01T11:55:00.000Z" }] },
    { id: "d2", request_item_key: "other", created_at: "2026-03-01T11:56:00.000Z", versions: [
      { id: "v2", status: "uploading", scan_status: "pending", scan_signature: null, created_at: "2026-03-01T11:59:00.000Z" }] },
    { id: "d3", request_item_key: "insurance", created_at: "2026-03-01T11:57:00.000Z", versions: [
      { id: "v3", status: "ready", scan_status: "pending", scan_signature: null, created_at: "2026-03-01T11:58:30.000Z" }] },
    { id: "d4", request_item_key: "other", created_at: "2026-03-01T11:57:30.000Z", versions: [
      { id: "v4", status: "ready", scan_status: "unscannable", scan_signature: "Heuristics.Encrypted.PDF", created_at: "2026-03-01T11:59:50.000Z" }] },
  ];

  it("an open Spanish request: language, the brand name, its logo, the live number, and each item's files as { state, ageMs } in order, not-ready files dropped (mutation: ageMs from the page-open time -> FAILS)", async () => {
    world.files = FILES;
    const page = await customerPage(fakeDb(), TOKEN, NOW);
    expect(page).toEqual({
      state: "open", language: "es", business: "Techos Río",
      logoUrl: `${SUPA}/storage/v1/object/public/brand-logos/${ACC}/logo.png`,
      branding: expect.objectContaining({ brandName: "Techos Río", brandColor: "#0F766E" }),
      phone: "(956) 555-0123",
      items: [
        { key: "insurance", label: "Seguro", files: [{ state: "received", ageMs: 300_000 }, { state: "checking", ageMs: 90_000 }] },
        { key: "other", label: "Fotos del techo", files: [{ state: "password", ageMs: 10_000 }] },
      ],
    });
    // Every read after the token's carries the request's own account (and, for its files, its id).
    const after = queries.slice(1);
    expect(after.map((q) => q.table).sort()).toEqual(["accounts", "documents", "phone_numbers"]);
    expect(eqs(after.find((q) => q.table === "accounts")!)).toEqual([["id", ACC]]);
    expect(eqs(after.find((q) => q.table === "documents")!)).toEqual([["account_id", ACC], ["request_id", REQ_ID]]);
    expect(eqs(after.find((q) => q.table === "phone_numbers")!)).toEqual([["account_id", ACC]]);
  });

  it("no brand name: the business reads the generic words in the request's language (mutation: English for a Spanish request -> FAILS)", async () => {
    world.account = ok({ brand_name: "  ", brand_logo_path: null });
    const page = await customerPage(fakeDb(), TOKEN, NOW);
    expect(page.business).toBe(m["customerDocs.business.es"]);
    expect(page.business).toBe("el negocio");
    expect(page.logoUrl).toBeNull();
  });

  it("a branding read that fails still answers the page, unbranded, logged by request id (mutation: let it throw -> FAILS)", async () => {
    world.account = { data: null, error: { message: "timeout" } };
    world.phones = [];
    const page = await customerPage(fakeDb(), TOKEN, NOW);
    expect(page).toMatchObject({ state: "open", branding: null, logoUrl: null, business: "el negocio", phone: null });
    expect(errorSpy.mock.calls.flat().map(String).join("\n")).toContain(REQ_ID);
    expect(errorSpy.mock.calls.flat().map(String).join("\n")).not.toContain(TOKEN);
  });

  it("an unknown token answers not_found with no branding read (mutation: read branding first -> FAILS)", async () => {
    const page = await customerPage(fakeDb(), requestToken(OTHER_ID), NOW);
    expect(page).toEqual({ state: "not_found", language: "en", business: "the business", logoUrl: null, branding: null, phone: null, items: [] });
    expect(queries.map((q) => q.table)).toEqual(["document_requests"]);
    expect(db.getBranding).not.toHaveBeenCalled();
  });

  it("a closed request names its state and lists no files (mutation: list the files of a revoked request -> FAILS)", async () => {
    world.files = FILES;
    for (const [row, state] of [[COMPLETED, "completed"], [EXPIRED, "expired"], [REVOKED, "revoked"]] as const) {
      world.request = row;
      const page = await customerPage(fakeDb(), TOKEN, NOW);
      expect(page.state).toBe(state);
      expect(page.items.map((i) => i.files)).toEqual([[], []]);
    }
    expect(db.listRequestFiles).not.toHaveBeenCalled();
  });
});

describe("fix round: the token is proven BEFORE the body is read", () => {
  it("an unknown token with a null body answers 404, not 400, on both routes; a revoked one 410 (mutation: validate the body above resolveToken -> FAILS)", async () => {
    const stranger = requestToken(OTHER_ID);
    expect(await customerStart(fakeDb(), stranger, null, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await customerFinish(fakeDb(), stranger, null, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await customerStart(fakeDb(), "short", null, NOW)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await customerFinish(fakeDb(), "short", "not an object", NOW)).toEqual({ status: 404, body: { error: "not_found" } });
    world.request = REVOKED;
    expect(await customerStart(fakeDb(), TOKEN, null, NOW)).toEqual({ status: 410, body: { error: "revoked" } });
    expect(await customerFinish(fakeDb(), TOKEN, null, NOW)).toEqual({ status: 410, body: { error: "revoked" } });
  });
});

describe("fix round: a phone read that fails is logged by request id, never the token, and still answers no phone", () => {
  it("over_quota: 409 without a phone, and one log line naming the request (mutation: no log -> FAILS)", async () => {
    world.rpc = ok({ status: "over_quota" });
    world.phonesError = "phone_numbers timeout";
    expect(await customerStart(fakeDb(), TOKEN, START_BODY, NOW)).toEqual({ status: 409, body: { error: "over_quota" } });
    const lines = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(lines).toContain(`document request ${REQ_ID}`);
    expect(lines).toContain("phone_numbers timeout");
    expect(lines).not.toContain(TOKEN);
  });

  it("the page: phone null, logged by request id (mutation: no log -> FAILS)", async () => {
    world.phonesError = "phone_numbers timeout";
    expect((await customerPage(fakeDb(), TOKEN, NOW)).phone).toBeNull();
    const lines = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(lines).toContain(`document request ${REQ_ID}`);
    expect(lines).toContain("phone_numbers timeout");
    expect(lines).not.toContain(TOKEN);
  });
});

describe("fix round: an unparseable version time never keeps the page polling", () => {
  it("a Checking file whose created_at does not parse reads a non-finite age, and the poll stops (mutations: remove the state guard -> FAILS; invent age 0 for it -> FAILS)", async () => {
    world.files = [{ id: "d1", request_item_key: "insurance", created_at: "2026-03-01T11:50:00.000Z", versions: [
      { id: "v1", status: "ready", scan_status: "pending", scan_signature: null, created_at: "not a time" }] }];
    const page = await customerPage(fakeDb(), TOKEN, NOW);
    const files = page.items[0]!.files;
    expect(files).toHaveLength(1);
    expect(files[0]!.state).toBe("checking");
    expect(Number.isFinite(files[0]!.ageMs)).toBe(false);
    expect(nextCustomerPollMs(files)).toBeNull();
  });
});
