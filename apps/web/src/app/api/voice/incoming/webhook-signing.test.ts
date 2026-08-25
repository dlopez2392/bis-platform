import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import OpenAI from "openai";

// This file deliberately does NOT mock "openai" — it is the one place in the
// suite that proves our signing assumptions against the REAL SDK, with zero
// network. route.test.ts mocks `openai.webhooks.unwrap` entirely (it has to,
// to drive the route's branches), which means nothing there can ever catch a
// wrong assumption about the signing scheme itself — a change to the SDK's
// verification internals would sail through every mocked test untouched.
// This is the spec §9 webhook-simulation harness: hand-sign a payload the
// way OpenAI's webhook sender does, then hand it to the real
// `webhooks.unwrap` and assert it accepts (or rejects a tamper).
//
// Signature scheme VERIFIED against the installed `openai` SDK source
// (node_modules/.../openai/src/resources/webhooks/webhooks.ts,
// `verifySignature`, read directly for this task):
//   - headers: webhook-id, webhook-timestamp, webhook-signature
//   - signed content: `${webhookId}.${timestamp}.${payload}`
//   - secret: if it starts with `whsec_`, strip the prefix and base64-decode
//     the remainder to get the HMAC key bytes; otherwise use the raw string
//     as utf-8 bytes.
//   - signature: HMAC-SHA256(signedContent, keyBytes), base64-encoded,
//     sent as `v1,<base64sig>` (space-separated list; any match is accepted).
// Reference implementation of the signer (read-only, not modified):
// bis-reception-demo/src/app/api/phone/incoming/route.test.ts:5-14.
function signWebhook(secret: string, webhookId: string, timestamp: string, payload: string): string {
  const decodedSecret = secret.startsWith("whsec_")
    ? Buffer.from(secret.replace("whsec_", ""), "base64")
    : Buffer.from(secret, "utf-8");
  const signedContent = `${webhookId}.${timestamp}.${payload}`;
  const sig = crypto.createHmac("sha256", decodedSecret).update(signedContent).digest("base64");
  return `v1,${sig}`;
}

const SECRET = "whsec_" + Buffer.from("test-signing-key-bytes-000000").toString("base64");

function headersFor(webhookId: string, timestamp: string, signature: string): Headers {
  return new Headers({
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": signature,
  });
}

describe("openai webhooks.unwrap — real SDK, hand-signed payload (no mocks, no network)", () => {
  it("resolves and parses the event for a correctly-signed payload", async () => {
    const payload = JSON.stringify({
      id: "evt_1", created_at: Math.floor(Date.now() / 1000),
      type: "realtime.call.incoming", data: { call_id: "call_1", sip_headers: [] },
    });
    const webhookId = "msg_test1";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhook(SECRET, webhookId, timestamp, payload);

    const client = new OpenAI({ apiKey: "sk-t" });
    const event = await client.webhooks.unwrap(payload, headersFor(webhookId, timestamp, signature), SECRET);

    expect(event.type).toBe("realtime.call.incoming");
  });

  it("rejects a tampered body signed against a different payload", async () => {
    const payload = JSON.stringify({
      id: "evt_2", created_at: Math.floor(Date.now() / 1000),
      type: "realtime.call.incoming", data: { call_id: "call_2", sip_headers: [] },
    });
    const tampered = JSON.stringify({
      id: "evt_2", created_at: Math.floor(Date.now() / 1000),
      type: "realtime.call.incoming", data: { call_id: "call_HIJACKED", sip_headers: [] },
    });
    const webhookId = "msg_test2";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Signed for `payload`, then presented alongside `tampered` — the
    // signature and the body it was supposed to protect now disagree.
    const signature = signWebhook(SECRET, webhookId, timestamp, payload);

    const client = new OpenAI({ apiKey: "sk-t" });
    await expect(
      client.webhooks.unwrap(tampered, headersFor(webhookId, timestamp, signature), SECRET),
    ).rejects.toThrow();
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const payload = JSON.stringify({
      id: "evt_3", created_at: Math.floor(Date.now() / 1000),
      type: "realtime.call.incoming", data: { call_id: "call_3", sip_headers: [] },
    });
    const webhookId = "msg_test3";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const wrongSecret = "whsec_" + Buffer.from("a-totally-different-key-bytes").toString("base64");
    const signature = signWebhook(wrongSecret, webhookId, timestamp, payload);

    const client = new OpenAI({ apiKey: "sk-t" });
    await expect(
      client.webhooks.unwrap(payload, headersFor(webhookId, timestamp, signature), SECRET),
    ).rejects.toThrow();
  });
});
