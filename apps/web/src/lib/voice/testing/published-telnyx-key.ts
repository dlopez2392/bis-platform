import { createPrivateKey, createPublicKey, sign } from "node:crypto";

/**
 * TEST-ONLY. The Telnyx test key whose private half is published in this repo
 * (e2e/consent-texts.spec.ts builds it from the same fixed seed) and whose
 * public half is ci.yml's e2e TELNYX_PUBLIC_KEY. Anyone can sign with it, so
 * production must refuse it (lib/fixture-secrets.ts). Imported by tests only;
 * nothing in the app imports it.
 */
const PRIVATE = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from("5eed".repeat(16), "hex")]),
  format: "der", type: "pkcs8",
});

/** Derived from the private half, never copied, so a test can prove the app's list holds the real key. */
export const PUBLISHED_TELNYX_PUBLIC_KEY = createPublicKey(PRIVATE)
  .export({ format: "der", type: "spki" }).subarray(12).toString("base64");

/** Telnyx's two signature headers for `raw`, validly signed with the published private key. */
export function publishedKeySignature(raw: string): { "telnyx-timestamp": string; "telnyx-signature-ed25519": string } {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    "telnyx-timestamp": ts,
    "telnyx-signature-ed25519": sign(null, Buffer.from(`${ts}|${raw}`, "utf8"), PRIVATE).toString("base64"),
  };
}

/** A TeXML-shaped form POST to `url`, validly signed with the published private key. */
export function publishedKeyFormPost(url: string, fields: Record<string, string>): Request {
  const raw = new URLSearchParams(fields).toString();
  return new Request(url, {
    method: "POST", body: raw,
    headers: { "content-type": "application/x-www-form-urlencoded", ...publishedKeySignature(raw) },
  });
}
