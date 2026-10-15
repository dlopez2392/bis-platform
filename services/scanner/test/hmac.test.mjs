import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify, MAX_SKEW_SECONDS } from "../src/hmac.mjs";

const BODY = JSON.stringify({ url: "https://abc.supabase.co/storage/v1/object/sign/documents/a/b/c?token=t" });

test("the shared vector; apps/web/src/lib/documents/scan-client.test.ts pins the same two strings (mutation: a newline for '.' in the canonical string -> FAILS here AND there)", () => {
  assert.equal(sign("test-secret", 1760000000, "POST", "/scan", BODY), "414f5bcfa4ebd5bb5e060b45bf091d4abfca66fd7bda2dfc2d8e752e64eaec01");
  assert.equal(sign("test-secret", 1760000000, "GET", "/health", ""), "9b16b5e0e7895ed3b63577ae46200cc556595994f9e89e9323a8bd08568a5996");
});

test("verify answers the client whose secret signed it; stale, future, another path, a tampered body, an unknown secret or junk answer null (mutations: drop the skew check -> FAILS; drop the path from the canonical string -> FAILS)", () => {
  const a = { secret: "a".repeat(20), origin: "https://one.supabase.co" };
  const b = { secret: "b".repeat(20), origin: "https://two.supabase.co" };
  const ts = 1760000000;
  const h = (secret, t = ts, path = "/scan", body = BODY) =>
    ({ "x-bis-scan-timestamp": String(t), "x-bis-scan-signature": sign(secret, t, "POST", path, body) });
  assert.equal(verify([a, b], h(b.secret), "POST", "/scan", BODY, ts), b);
  assert.equal(verify([a, b], h(a.secret, ts - MAX_SKEW_SECONDS - 1), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], h(a.secret, ts + MAX_SKEW_SECONDS + 1), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], h(a.secret, ts, "/health", BODY), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], h(a.secret), "POST", "/scan", BODY.replace("/c?", "/d?"), ts), null);
  assert.equal(verify([a, b], h("c".repeat(20)), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": "zz" }, "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], {}, "POST", "/scan", BODY, ts), null);
});
