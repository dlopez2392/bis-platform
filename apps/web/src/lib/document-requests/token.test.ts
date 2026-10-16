import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { requestToken, tokenHash, isTokenShape, requestUrl } from "./token";

const ID = "2b1f7d7e-5b1c-4c55-9a43-6f0f1b2c3d4e";
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = { a: process.env.DOCUMENT_LINK_SECRET, b: process.env.SUPABASE_SERVICE_ROLE_KEY }; });
afterEach(() => { process.env.DOCUMENT_LINK_SECRET = saved.a; process.env.SUPABASE_SERVICE_ROLE_KEY = saved.b; if (saved.a === undefined) delete process.env.DOCUMENT_LINK_SECRET; if (saved.b === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

describe("the request's link (plan deviation 1)", () => {
  it("is HMAC-SHA256 of the id under the domain-separated key: 43 base64url characters, the same for the same id (mutation: drop the 'bis-document-link:' prefix -> FAILS)", () => {
    process.env.DOCUMENT_LINK_SECRET = "s3cret-s3cret-s3cret-s3cret-0032";
    const key = createHash("sha256").update("bis-document-link:s3cret-s3cret-s3cret-s3cret-0032").digest();
    const want = createHmac("sha256", key).update(`document-request:v1:${ID}`).digest("base64url");
    expect(requestToken(ID)).toBe(want);
    expect(requestToken(ID.toUpperCase())).toBe(want);
    expect(want).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requestToken("3c1f7d7e-5b1c-4c55-9a43-6f0f1b2c3d4e")).not.toBe(want);
  });
  it("a different secret gives a different link (mutation: a constant key -> FAILS)", () => {
    process.env.DOCUMENT_LINK_SECRET = "a".repeat(32);
    const a = requestToken(ID);
    process.env.DOCUMENT_LINK_SECRET = "b".repeat(32);
    expect(requestToken(ID)).not.toBe(a);
  });
  it("the secret is REQUIRED and at least 32 characters; there is no fallback to the service key; the error names the variable, never a value (ruling I10; mutations: fall back to SUPABASE_SERVICE_ROLE_KEY; accept 31 characters; echo the value -> FAILS)", () => {
    delete process.env.DOCUMENT_LINK_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key-present";
    expect(() => requestToken(ID)).toThrow("DOCUMENT_LINK_SECRET is required (at least 32 characters)");
    process.env.DOCUMENT_LINK_SECRET = "x".repeat(31);
    let msg = "";
    try { requestToken(ID); } catch (e) { msg = (e as Error).message; }
    expect(msg).toBe("DOCUMENT_LINK_SECRET is required (at least 32 characters)");
    expect(msg).not.toContain("x".repeat(31));
  });
  it("the database keeps sha256 hex of the token; the shape check refuses anything but 43 base64url characters (mutation: accept 44 -> FAILS)", () => {
    expect(tokenHash("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect([isTokenShape("A".repeat(43)), isTokenShape("A".repeat(44)), isTokenShape("A".repeat(42) + "="), isTokenShape(null)]).toEqual([true, false, false, false]);
    process.env.DOCUMENT_LINK_SECRET = "s3cret-s3cret-s3cret-s3cret-0032";
    expect(requestUrl("https://app.example.com/", ID)).toBe(`https://app.example.com/d/${requestToken(ID)}`);
  });
});
