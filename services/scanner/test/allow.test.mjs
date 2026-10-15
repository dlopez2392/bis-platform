import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedObjectUrl } from "../src/allow.mjs";
import { parseClients } from "../src/config.mjs";

const O = "https://abc.supabase.co";

test("only a signed GET on the documents bucket, at the caller's own origin (mutations: drop the origin check -> FAILS; startsWith '/storage/v1/object/' -> FAILS; drop the encoded-slash refusal -> the %2F case FAILS)", () => {
  assert.equal(allowedObjectUrl(`${O}/storage/v1/object/sign/documents/acct/doc/ver?token=t`, O), true);
  for (const bad of [
    "https://evil.example/storage/v1/object/sign/documents/a?token=t",
    `${O}/storage/v1/object/sign/logos/a?token=t`,
    `${O}/storage/v1/object/public/documents/a?token=t`,
    `${O}/storage/v1/object/sign/documents/../../object/sign/logos/a?token=t`,
    `${O}/storage/v1/object/sign/documents/%2e%2e/%2e%2e/x?token=t`,
    `${O}/storage/v1/object/sign/documents/a%2F..%2F..%2Flogos%2Fx?token=t`,
    `${O}/storage/v1/object/sign/documents/a%5c..%5clogos?token=t`,
    "https://user:pw@abc.supabase.co/storage/v1/object/sign/documents/a?token=t",
    `${O}/storage/v1/object/sign/documents/a`,
    `${O}/storage/v1/object/sign/documents/?token=t`,
    "http://abc.supabase.co/storage/v1/object/sign/documents/a?token=t",
    "not a url",
  ]) assert.equal(allowedObjectUrl(bad, O), false, bad);
});

test("parseClients binds each secret to an origin; refuses a short secret, an origin with a path, or nothing, never echoing a secret (mutation: accept an empty list -> FAILS)", () => {
  const s1 = "s".repeat(16);
  const s2 = "t".repeat(24);
  assert.deepEqual(parseClients(`${s1}@https://one.supabase.co, ${s2}@http://127.0.0.1:54321`),
    [{ secret: s1, origin: "https://one.supabase.co" }, { secret: s2, origin: "http://127.0.0.1:54321" }]);
  for (const bad of ["", "   ", "short@https://one.supabase.co", `${s1}@https://one.supabase.co/storage`, `${s1}`]) {
    assert.throws(() => parseClients(bad), (e) => !String(e.message).includes(s1), bad);
  }
});
