import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
const receivingGet = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a), receiving: { get: (...a: unknown[]) => receivingGet(...a) } };
  },
}));

import { resendEmailProvider, fetchReceivedEmailFromResend } from "./resend";

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ data: { id: "re_1" }, error: null });
});

describe("resendEmailProvider", () => {
  it("passes html through when a template supplied one", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Rio Roofing",
      subject: "Hi", body: "plain", html: "<p>rich</p>",
    });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "plain",
      html: "<p>rich</p>",
    }));
  });

  // Both parts, always. A branded email with no text alternative is a
  // spam-filter magnet, and this is the assertion that stops one shipping.
  it("still sends text when there is no html, and omits html entirely", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Rio Roofing",
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].text).toBe("plain");
    expect(sendMock.mock.calls[0]![0].html).toBeUndefined();
  });

  it("sends from the per-send address when one is given", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Acme Corp",
      fromAddress: "leads@acme.com",
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].from).toBe("Acme Corp <leads@acme.com>");
  });

  // The fallback every unset account relies on, and the lead alert always.
  it("falls back to the configured address when none is given", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Acme Corp",
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].from).toBe("Acme Corp <crm@bis-rgv.com>");
  });

  /**
   * Blank is absence, not a value. `??` would pass an empty string straight
   * through and compose `Acme Corp <>` — a malformed header on a client's
   * customer-facing mail. Whitespace counts as blank for the same reason.
   */
  it.each(["", "   "])("falls back when the address is blank (%j)", async (blank) => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Acme Corp",
      fromAddress: blank,
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].from).toBe("Acme Corp <crm@bis-rgv.com>");
  });
});

describe("custom headers (consent PR-3; Resend's CreateEmailBaseOptions.headers, plan X1)", () => {
  it("passes the unsubscribe headers through exactly, and a send without them carries no headers key (mutation: drop the headers spread → FAILS; mutation: always send headers: {} → FAILS)", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    const headers = { "List-Unsubscribe": "<https://app.example.com/api/unsubscribe/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    await provider.send({ to: "c@example.com", fromName: "Rio", subject: "Hi", body: "plain", headers });
    expect(sendMock.mock.calls[0]![0].headers).toEqual(headers);
    await provider.send({ to: "c@example.com", fromName: "Rio", subject: "Hi", body: "plain" });
    expect("headers" in sendMock.mock.calls[1]![0]).toBe(false);
  });
});

// D-016 item 1: every gated send carries Resend tags (account id, and the
// contact id when known), so the webhook can attribute a bounce/complaint
// back to its account without a messages-row fallback. Verified against
// Resend's docs (resend.com/docs/dashboard/emails/tags): `tags` on send is
// an ARRAY of {name, value}, echoed back on the webhook event as `data.tags`.
describe("tags (D-016 item 1)", () => {
  it("passes tags through to Resend exactly, and a send without them carries no tags key (mutation: drop the tags spread → FAILS; mutation: always send tags: [] → FAILS)", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    const tags = [{ name: "account_id", value: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f" }];
    await provider.send({ to: "c@example.com", fromName: "Rio", subject: "Hi", body: "plain", tags });
    expect(sendMock.mock.calls[0]![0].tags).toEqual(tags);
    await provider.send({ to: "c@example.com", fromName: "Rio", subject: "Hi", body: "plain" });
    expect("tags" in sendMock.mock.calls[1]![0]).toBe(false);
  });
});

describe("fetchReceivedEmailFromResend", () => {
  it("maps Resend's received email and reads the raw message's header block (mutation: drop received_for → [], FAILS)", async () => {
    receivingGet.mockResolvedValue({ data: {
      id: "re_1", from: "Ana <ana@gmail.com>", to: ["r-x@reply.bis-rgv.com"], received_for: ["r-y@reply.bis-rgv.com"],
      subject: "Re: Hi", text: "Yes", html: null, headers: {}, created_at: "2026-10-16T10:00:00.000Z",
      raw: { download_url: "https://raw.example/1", expires_at: "x" }, attachments: [{ id: "a" }, { id: "b" }],
    }, error: null });
    const fetchRaw = vi.fn().mockResolvedValue(new Response("Authentication-Results: amazonses.com; dmarc=pass\r\nFrom: a\r\n\r\nbody"));
    expect(await fetchReceivedEmailFromResend("key", "re_1", fetchRaw)).toEqual({
      id: "re_1", from: "Ana <ana@gmail.com>", to: ["r-x@reply.bis-rgv.com"], receivedFor: ["r-y@reply.bis-rgv.com"],
      subject: "Re: Hi", text: "Yes", html: null, rawHeaders: "Authentication-Results: amazonses.com; dmarc=pass\r\nFrom: a", attachmentCount: 2,
      receivedAt: "2026-10-16T10:00:00.000Z",
    });
    expect(fetchRaw).toHaveBeenCalledWith("https://raw.example/1");
  });

  it("no raw message, or a raw fetch that fails, reads as no headers, never a throw (plan G5: the sender is then unverified; mutation: throw → FAILS)", async () => {
    receivingGet.mockResolvedValue({ data: { id: "re_2", from: "a@b.com", to: [], received_for: [], subject: "", text: null, html: null, headers: null, created_at: "x", raw: null, attachments: [] }, error: null });
    expect((await fetchReceivedEmailFromResend("key", "re_2", vi.fn())).rawHeaders).toBeNull();
    receivingGet.mockResolvedValue({ data: { id: "re_3", from: "a@b.com", to: [], received_for: [], subject: "", text: null, html: null, headers: null, created_at: "x", raw: { download_url: "https://raw.example/3", expires_at: "x" }, attachments: [] }, error: null });
    expect((await fetchReceivedEmailFromResend("key", "re_3", vi.fn().mockResolvedValue(new Response("", { status: 403 })))).rawHeaders).toBeNull();
  });

  it("an API error throws (the route answers 503; mutation: return null → FAILS)", async () => {
    receivingGet.mockResolvedValue({ data: null, error: { message: "not found", name: "not_found" } });
    await expect(fetchReceivedEmailFromResend("key", "re_4", vi.fn())).rejects.toThrow(/not found/);
  });
});
