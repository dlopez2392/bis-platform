import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Branding, DocumentShareRow, ShareTarget, SupabaseClient } from "@bis/db";

/**
 * The public rule for a share link (study 3.4; spec 4.2): every @bis/db read the rule makes is mocked
 * and recorded, so a read that lost the token row's account, document or version fails by name.
 * documentShareState and brandLogoUrl run for real.
 */
type Mocked = "findDocumentShareByTokenHash" | "getShareTarget" | "claimDocumentShareDownload" | "signedDocumentReadUrl"
  | "getBranding" | "listPhoneNumbersForAccount";
const dbm = vi.hoisted(() => ({}) as Record<Mocked, ReturnType<typeof vi.fn>>);
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  for (const name of [
    "findDocumentShareByTokenHash", "getShareTarget", "claimDocumentShareDownload", "signedDocumentReadUrl",
    "getBranding", "listPhoneNumbersForAccount",
  ] as const) dbm[name] = vi.fn();
  return { ...real, ...dbm };
});

const { resolveShare, sharePage, shareDownload, shareSize, shareFileName, SHARE_URL_SECONDS, SHARE_LINK_MAX_DOWNLOADS } =
  await import("./public-share");
const { tokenHash } = await import("@/lib/document-requests/token");

const NOW = new Date("2026-03-01T12:00:00.000Z");
const ACC = "44444444-4444-4444-8444-444444444444";
const OTHER_ACC = "55555555-5555-4555-8555-555555555555";
const DOC = "22222222-2222-4222-8222-222222222222";
const VER = "33333333-3333-4333-8333-333333333333";
const CURRENT_VER = "66666666-6666-4666-8666-666666666666";
const SHARE_ID = "11111111-1111-4111-8111-111111111111";
const TOK = "A".repeat(43);
const IP_HASH = "0123456789abcdef0123456789abcdef";
const SUPA = "https://proj.supabase.co";

const SHARE: DocumentShareRow = {
  id: SHARE_ID, account_id: ACC, document_id: DOC, version_id: VER, created_by: "user_1",
  created_at: "2026-03-01T11:00:00.000Z", expires_at: "2026-03-01T13:00:00.000Z",
  revoked_at: null, revoked_by: null, first_opened_at: null, open_count: 0,
};
/** Review F6: the target's version id is NOT the shared one, so a mint from the target's id is caught. */
const TARGET: ShareTarget = {
  document: { id: DOC, title: "Seguro 2026", deleted_at: null },
  version: { id: CURRENT_VER, content_type: "application/pdf", bytes: 1_258_291, status: "ready", scan_status: "clean" },
};
const BRANDING: Branding = {
  brandName: "Rio Roofing", brandLogoPath: `${ACC}/logo.png`, brandColor: "#336699", brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
} as Branding;

/** The only thing the rule reads itself: the account's language. Every id it is asked for is kept. */
let languageIds: string[] = [];
let languageAnswer: { data: unknown; error: { message: string } | null } = { data: { language: "es" }, error: null };
const fakeDb = {
  from(table: string) {
    if (table !== "accounts") throw new Error(`unexpected table ${table}`);
    return {
      select(cols: string) {
        if (cols !== "language") throw new Error(`unexpected columns ${cols}`);
        return {
          eq(col: string, id: string) {
            if (col !== "id") throw new Error(`unexpected column ${col}`);
            languageIds.push(id);
            return { maybeSingle: async () => languageAnswer };
          },
        };
      },
    };
  },
} as unknown as SupabaseClient;

let errSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: unknown[]) => c.map(String).join(" "));

beforeEach(() => {
  vi.stubEnv("FORM_TOKEN_SECRET", "unit-only-form-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPA);
  for (const f of Object.values(dbm)) f.mockReset();
  dbm.findDocumentShareByTokenHash.mockResolvedValue(SHARE);
  dbm.getShareTarget.mockResolvedValue(TARGET);
  dbm.claimDocumentShareDownload.mockResolvedValue({ status: "ok", first: false });
  dbm.signedDocumentReadUrl.mockResolvedValue({ status: "ok", url: "https://signed.example/x" });
  dbm.getBranding.mockResolvedValue(BRANDING);
  dbm.listPhoneNumbersForAccount.mockResolvedValue([
    { id: "p0", account_id: ACC, e164: "+19565550000", telnyx_id: null, status: "pending" },
    { id: "p1", account_id: ACC, e164: "+19565550123", telnyx_id: null, status: "live" },
  ]);
  languageIds = [];
  languageAnswer = { data: { language: "es" }, error: null };
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errSpy.mockRestore();
  infoSpy.mockRestore();
});

const noDbCalls = () => {
  for (const [name, f] of Object.entries(dbm)) expect(f, name).not.toHaveBeenCalled();
  expect(languageIds).toEqual([]);
};

describe("resolveShare: the token is proven first, then every read carries the token row's ids", () => {
  it.each(["short", "A".repeat(44), "A".repeat(42) + "=", "", "A".repeat(42) + "/"])(
    "a malformed token %j is not_found and reads NOTHING (mutation: look it up anyway -> FAILS)",
    async (bad) => {
      expect(await resolveShare(fakeDb, bad, NOW)).toEqual({ state: "not_found" });
      noDbCalls();
    },
  );

  it("looks the share up by sha256(token), never by the token (mutation: pass the token -> FAILS)", async () => {
    await resolveShare(fakeDb, TOK, NOW);
    expect(dbm.findDocumentShareByTokenHash).toHaveBeenCalledTimes(1);
    const [db, hash] = dbm.findDocumentShareByTokenHash.mock.calls[0]!;
    expect(db).toBe(fakeDb);
    expect(hash).toBe(tokenHash(TOK));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(TOK);
  });

  it("an unknown token is not_found and reads no target", async () => {
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce(null);
    expect(await resolveShare(fakeDb, TOK, NOW)).toEqual({ state: "not_found" });
    expect(dbm.getShareTarget).not.toHaveBeenCalled();
  });

  it("an open share reads its target with EXACTLY the share row's account, document and version", async () => {
    // A row from another account, as if a lookup had wandered: the target read must carry ITS ids, not ACC's.
    const foreign = { ...SHARE, account_id: OTHER_ACC };
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce(foreign);
    const r = await resolveShare(fakeDb, TOK, NOW);
    expect(r.state).toBe("open");
    const [db, ref] = dbm.getShareTarget.mock.calls[0]! as [unknown, DocumentShareRow];
    expect(db).toBe(fakeDb);
    expect([ref.account_id, ref.document_id, ref.version_id]).toEqual([OTHER_ACC, DOC, VER]);
  });

  const cases: [string, Partial<DocumentShareRow>, Partial<ShareTarget["document"]>, Partial<ShareTarget["version"]>, string][] = [
    ["revoked", { revoked_at: "2026-03-01T11:30:00.000Z", revoked_by: "user_1" }, {}, {}, "revoked"],
    ["expired (expires_at = now)", { expires_at: NOW.toISOString() }, {}, {}, "expired"],
    ["a trashed document", {}, { deleted_at: "2026-03-01T11:45:00.000Z" }, {}, "trashed"],
    ["a pending scan", {}, {}, { scan_status: "pending" }, "removed"],
    ["an infected scan", {}, {}, { scan_status: "infected" }, "removed"],
    ["an unscannable scan", {}, {}, { scan_status: "unscannable" }, "removed"],
    ["an uploading version", {}, {}, { status: "uploading" }, "removed"],
    ["a used-up link (open_count = SHARE_LINK_MAX_DOWNLOADS)", { open_count: 100 }, {}, {}, "expired"],
    ["a link past its cap (open_count = 101)", { open_count: 101 }, {}, {}, "expired"],
  ];
  it.each(cases)("%s answers its state (mutation: drop the check -> FAILS)", async (_n, s, d, v, want) => {
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, ...s });
    dbm.getShareTarget.mockResolvedValueOnce({ document: { ...TARGET.document, ...d }, version: { ...TARGET.version, ...v } });
    expect((await resolveShare(fakeDb, TOK, NOW)).state).toBe(want);
  });

  it("Minor 1: a link one download short of its cap (99) is still open (mutation: cap at 99 -> FAILS)", async () => {
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, open_count: SHARE_LINK_MAX_DOWNLOADS - 1 });
    expect((await resolveShare(fakeDb, TOK, NOW)).state).toBe("open");
  });

  it("a target that is gone (getShareTarget null) is not_found", async () => {
    dbm.getShareTarget.mockResolvedValueOnce(null);
    expect(await resolveShare(fakeDb, TOK, NOW)).toEqual({ state: "not_found" });
  });
});

describe("shareDownload: one claim, one mint of the SHARED version, every refusal the same answer", () => {
  it("claims with the share row's account and id and the forms limiter's numbers, then mints the SHARED version (review F6)", async () => {
    expect([SHARE_URL_SECONDS, SHARE_LINK_MAX_DOWNLOADS]).toEqual([120, 100]);
    const r = await shareDownload(fakeDb, TOK, IP_HASH, NOW);
    expect(r).toEqual({ status: 200, body: { url: "https://signed.example/x" } });
    expect(dbm.claimDocumentShareDownload).toHaveBeenCalledTimes(1);
    expect(dbm.claimDocumentShareDownload.mock.calls[0]).toEqual([
      fakeDb, { accountId: ACC, shareId: SHARE_ID, ipHash: IP_HASH, max: 5, windowSeconds: 600, linkMax: 100 },
    ]);
    expect(dbm.signedDocumentReadUrl).toHaveBeenCalledTimes(1);
    expect(dbm.signedDocumentReadUrl.mock.calls[0]).toEqual([fakeDb, ACC, VER, { seconds: 120, download: "Seguro 2026.pdf" }]);
  });

  it("the download is never read before the claim (claim, then mint)", async () => {
    await shareDownload(fakeDb, TOK, IP_HASH, NOW);
    const claimAt = dbm.claimDocumentShareDownload.mock.invocationCallOrder[0]!;
    const mintAt = dbm.signedDocumentReadUrl.mock.invocationCallOrder[0]!;
    expect(claimAt).toBeLessThan(mintAt);
  });

  const UNAVAILABLE = { status: 410, body: { error: "unavailable" } };
  const refusedBeforeClaim: [string, () => void, string][] = [
    ["a malformed token", () => {}, "short"],
    ["an unknown token", () => dbm.findDocumentShareByTokenHash.mockResolvedValueOnce(null), TOK],
    ["a gone target", () => dbm.getShareTarget.mockResolvedValueOnce(null), TOK],
    ["a revoked link", () => dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, revoked_at: "2026-03-01T11:30:00.000Z" }), TOK],
    ["an expired link", () => dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, expires_at: NOW.toISOString() }), TOK],
    ["a trashed file", () => dbm.getShareTarget.mockResolvedValueOnce({ ...TARGET, document: { ...TARGET.document, deleted_at: "2026-03-01T11:45:00.000Z" } }), TOK],
    ["a removed file", () => dbm.getShareTarget.mockResolvedValueOnce({ ...TARGET, version: { ...TARGET.version, scan_status: "infected" } }), TOK],
    ["a used-up link (100 downloads)", () => dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, open_count: 100 }), TOK],
  ];
  it.each(refusedBeforeClaim)("%s answers EXACTLY 410 unavailable and is never claimed or minted (mutations: a state word; claim first -> FAILS)", async (_n, arrange, token) => {
    arrange();
    expect(await shareDownload(fakeDb, token, IP_HASH, NOW)).toEqual(UNAVAILABLE);
    expect(dbm.claimDocumentShareDownload).not.toHaveBeenCalled();
    expect(dbm.signedDocumentReadUrl).not.toHaveBeenCalled();
  });

  it("Minor 1: a link at 99 downloads is still claimed and minted (the route agrees with the page)", async () => {
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, open_count: 99 });
    expect(await shareDownload(fakeDb, TOK, IP_HASH, NOW)).toEqual({ status: 200, body: { url: "https://signed.example/x" } });
    expect(dbm.claimDocumentShareDownload).toHaveBeenCalledTimes(1);
  });

  it.each(["not_found", "closed"] as const)("a claim answering %s (closed = the link's 100-download cap) is the same 410 and mints nothing", async (status) => {
    dbm.claimDocumentShareDownload.mockResolvedValueOnce({ status });
    expect(await shareDownload(fakeDb, TOK, IP_HASH, NOW)).toEqual(UNAVAILABLE);
    expect(dbm.signedDocumentReadUrl).not.toHaveBeenCalled();
  });

  it.each(["pending", "removed", "not_ready", "not_found"] as const)("a mint answering %s after a won claim is the same 410, logged by ids only (deviation 5's residual)", async (status) => {
    dbm.signedDocumentReadUrl.mockResolvedValueOnce({ status });
    expect(await shareDownload(fakeDb, TOK, IP_HASH, NOW)).toEqual(UNAVAILABLE);
    const lines = logged(errSpy);
    expect(lines).toEqual([`document share ${SHARE_ID}: claimed but not minted (${status})`]);
    expect(lines[0]).not.toContain(TOK);
    expect(lines[0]).not.toContain("Seguro");
  });

  it("ONLY a rate_limited claim (the per-address window) answers 429, and nothing is minted (mutation: mint anyway -> FAILS)", async () => {
    dbm.claimDocumentShareDownload.mockResolvedValueOnce({ status: "rate_limited" });
    expect(await shareDownload(fakeDb, TOK, IP_HASH, NOW)).toEqual({ status: 429, body: { error: "rate_limited" } });
    expect(dbm.signedDocumentReadUrl).not.toHaveBeenCalled();
  });

  it("the FIRST open logs exactly one line by share id, with neither the token nor the title (review F7)", async () => {
    dbm.claimDocumentShareDownload.mockResolvedValueOnce({ status: "ok", first: true });
    await shareDownload(fakeDb, TOK, IP_HASH, NOW);
    expect(logged(infoSpy)).toEqual([`document share ${SHARE_ID}: first opened`]);
    for (const line of logged(infoSpy)) {
      expect(line).not.toContain(TOK);
      expect(line).not.toContain("Seguro");
    }
  });

  it("a later download logs nothing (mutation: log on every download -> FAILS)", async () => {
    dbm.claimDocumentShareDownload.mockResolvedValueOnce({ status: "ok", first: false });
    await shareDownload(fakeDb, TOK, IP_HASH, NOW);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("a claim that throws answers 503 failed and logs the share id, never the token (mutation: log the token -> FAILS)", async () => {
    dbm.claimDocumentShareDownload.mockRejectedValueOnce(new Error("rpc down"));
    expect(await shareDownload(fakeDb, TOK, IP_HASH, NOW)).toEqual({ status: 503, body: { error: "failed" } });
    const lines = logged(errSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(SHARE_ID);
    for (const line of lines) expect(line).not.toContain(TOK);
    expect(dbm.signedDocumentReadUrl).not.toHaveBeenCalled();
  });

  it("a lookup that throws answers 503 failed and never logs the token", async () => {
    dbm.findDocumentShareByTokenHash.mockRejectedValueOnce(new Error("db down"));
    expect(await shareDownload(fakeDb, TOK, IP_HASH, NOW)).toEqual({ status: 503, body: { error: "failed" } });
    const lines = logged(errSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("document share unknown: download failed");
    expect(lines[0]).not.toContain(TOK);
  });
});

describe("sharePage: the page's whole read", () => {
  it("an open share answers the file in the ACCOUNT's language, the brand, its logo and its live phone", async () => {
    const p = await sharePage(fakeDb, TOK, NOW);
    expect(p).toEqual({
      state: "open", language: "es", branding: BRANDING, logoUrl: `${SUPA}/storage/v1/object/public/brand-logos/${ACC}/logo.png`,
      phone: "(956) 555-0123", file: { title: "Seguro 2026", type: "PDF", size: "1.2 MB" },
    });
    expect(languageIds).toEqual([ACC]);
    expect(dbm.getBranding.mock.calls[0]).toEqual([fakeDb, ACC]);
    expect(dbm.listPhoneNumbersForAccount.mock.calls[0]).toEqual([fakeDb, ACC]);
  });

  it.each([[99, "open"], [100, "expired"]] as const)("Minor 1: a link at %i downloads reads the %s page (page and route agree; mutations: drop the cap check, cap at 99 -> FAILS)", async (count, want) => {
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, open_count: count });
    const p = await sharePage(fakeDb, TOK, NOW);
    expect(p.state).toBe(want);
    expect(p.file === null).toBe(want !== "open");
  });

  it("no logo path answers logoUrl null; an English account answers en", async () => {
    dbm.getBranding.mockResolvedValueOnce({ ...BRANDING, brandLogoPath: null });
    languageAnswer = { data: { language: "en" }, error: null };
    const p = await sharePage(fakeDb, TOK, NOW);
    expect([p.logoUrl, p.language]).toEqual([null, "en"]);
  });

  it("a revoked share answers no file, but still the business's brand and phone (the refusal page names it)", async () => {
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce({ ...SHARE, revoked_at: "2026-03-01T11:30:00.000Z" });
    const p = await sharePage(fakeDb, TOK, NOW);
    expect(p.state).toBe("revoked");
    expect(p.file).toBeNull();
    expect(p.branding).toEqual(BRANDING);
    expect(p.phone).toBe("(956) 555-0123");
    expect(languageIds).toEqual([ACC]);
  });

  it("a branding, phone or language read that throws still answers the page, logged by share id, never the token", async () => {
    dbm.getBranding.mockRejectedValueOnce(new Error("down"));
    dbm.listPhoneNumbersForAccount.mockRejectedValueOnce(new Error("down"));
    languageAnswer = { data: null, error: { message: "down" } };
    const p = await sharePage(fakeDb, TOK, NOW);
    expect(p).toEqual({ state: "open", language: "en", branding: null, logoUrl: null, phone: null,
      file: { title: "Seguro 2026", type: "PDF", size: "1.2 MB" } });
    const lines = logged(errSpy);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain(SHARE_ID);
      expect(line).not.toContain(TOK);
    }
  });

  it("no live number answers phone null", async () => {
    dbm.listPhoneNumbersForAccount.mockResolvedValueOnce([{ id: "p0", account_id: ACC, e164: "+19565550000", telnyx_id: null, status: "pending" }]);
    expect((await sharePage(fakeDb, TOK, NOW)).phone).toBeNull();
  });

  it.each([["an unknown token", TOK], ["a malformed token", "nope"]])("%s answers the bare not-found page with NO brand, phone or language read (mutation: read the branding first -> FAILS)", async (_n, token) => {
    dbm.findDocumentShareByTokenHash.mockResolvedValueOnce(null);
    expect(await sharePage(fakeDb, token, NOW)).toEqual({
      state: "not_found", language: "en", branding: null, logoUrl: null, phone: null, file: null,
    });
    expect(dbm.getBranding).not.toHaveBeenCalled();
    expect(dbm.listPhoneNumbersForAccount).not.toHaveBeenCalled();
    expect(languageIds).toEqual([]);
  });
});

describe("shareSize and shareFileName", () => {
  it("under a megabyte reads in KB, never 0 MB (mutation: always formatMb -> FAILS)", () => {
    expect(shareSize(10, "en")).toBe("1 KB");
    expect(shareSize(512_000, "en")).toBe("500 KB");
    expect(shareSize(1_258_291, "en")).toBe("1.2 MB");
    expect(shareSize(1_258_291, "es")).toBe("1.2 MB");
  });

  it("the saved file's name is the title plus the type's extension", () => {
    expect(shareFileName("Seguro 2026", "application/pdf")).toBe("Seguro 2026.pdf");
    expect(shareFileName("Roof", "image/jpeg")).toBe("Roof.jpg");
  });
});
