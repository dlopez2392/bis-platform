import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

    // Read off the first argument: since F-196 Q4 every call also carries a
    // second, `{ idempotencyKey }`, which `toHaveBeenCalledWith` would reject.
    expect(sendMock.mock.calls[0]![0]).toEqual(expect.objectContaining({
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

/**
 * F-196 Q4: one rate-limit refusal is waited out, inside a bounded send. Each
 * attempt is raced against SEND_TIMEOUT_MS (10 s); a 429 asking for at most
 * RATE_LIMIT_MAX_WAIT_MS (3 s) gets ONE more attempt carrying the SAME
 * idempotency key, so Resend can refuse to send the message twice. `sleep` is
 * injected; fake timers only where the timeout itself is under test.
 */
describe("one rate-limit retry (F-196 Q4)", () => {
  const INPUT = { to: "customer@example.com", fromName: "Rio Roofing", subject: "Hi", body: "plain" };
  const rateLimited = (retryAfter: string | null) => ({
    data: null,
    error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
    headers: retryAfter === null ? {} : { "retry-after": retryAfter },
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(a) a 429 then success resolves with the second id: the same request, the SAME idempotency key on both attempts, one 1 s wait (mutations: delete the retry → rejects, FAILS; mint the key per attempt → keys differ, FAILS)", async () => {
    sendMock
      .mockResolvedValueOnce(rateLimited("1"))
      .mockResolvedValueOnce({ data: { id: "re_2" }, error: null, headers: {} });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await resendEmailProvider("re_test", "crm@bis-rgv.com", undefined, sleep).send(INPUT);

    expect(result).toEqual({ providerMessageId: "re_2" });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1]![0]).toEqual(sendMock.mock.calls[0]![0]);
    const first = sendMock.mock.calls[0]![1] as { idempotencyKey?: string };
    const second = sendMock.mock.calls[1]![1] as { idempotencyKey?: string };
    expect(typeof first.idempotencyKey).toBe("string");
    expect(first.idempotencyKey!.length).toBeGreaterThan(0);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("two sends never share a key: the key belongs to one send, not to the provider (mutation: mint it once in the constructor → FAILS)", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com", undefined, vi.fn().mockResolvedValue(undefined));
    await provider.send(INPUT);
    await provider.send(INPUT);
    const k1 = (sendMock.mock.calls[0]![1] as { idempotencyKey?: string }).idempotencyKey;
    const k2 = (sendMock.mock.calls[1]![1] as { idempotencyKey?: string }).idempotencyKey;
    expect(typeof k1).toBe("string");
    expect(k2).not.toBe(k1);
  });

  it("(b) two rate-limit refusals reject with Resend's message after exactly 2 calls (mutation: retry twice → 3 calls, FAILS)", async () => {
    sendMock.mockResolvedValue(rateLimited("1"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(resendEmailProvider("re_test", "crm@bis-rgv.com", undefined, sleep).send(INPUT))
      .rejects.toThrow("Too many requests");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it.each(["daily_quota_exceeded", "monthly_quota_exceeded", "validation_error"])(
    "(c) %s is not a rate limit: rejects after 1 call, no wait (mutation: retry on any error → 2 calls, FAILS)",
    async (name) => {
      sendMock.mockResolvedValue({ data: null, error: { name, statusCode: 429, message: `refused: ${name}` }, headers: { "retry-after": "1" } });
      const sleep = vi.fn().mockResolvedValue(undefined);

      await expect(resendEmailProvider("re_test", "crm@bis-rgv.com", undefined, sleep).send(INPUT))
        .rejects.toThrow(`refused: ${name}`);
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("(d) a rate limit asking for 30 s is not waited for: rejects after 1 call, no wait (mutation: ignore the null → sleeps, FAILS)", async () => {
    sendMock.mockResolvedValue(rateLimited("30"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(resendEmailProvider("re_test", "crm@bis-rgv.com", undefined, sleep).send(INPUT))
      .rejects.toThrow("Too many requests");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  // (a) cannot tell the header from the default (both are 1 s), so this one
  // asks for 2 s: the wait has to come from the header the SDK lowercased.
  it("the wait is the one the header asks for, read off the SDK's lowercased key (mutation: read \"Retry-After\" → the 1 s default, FAILS)", async () => {
    sendMock
      .mockResolvedValueOnce(rateLimited("2"))
      .mockResolvedValueOnce({ data: { id: "re_4" }, error: null, headers: {} });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await resendEmailProvider("re_test", "crm@bis-rgv.com", undefined, sleep).send(INPUT);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("a 429 with no retry-after header waits the 1 s default", async () => {
    sendMock
      .mockResolvedValueOnce({ ...rateLimited(null), headers: null })
      .mockResolvedValueOnce({ data: { id: "re_3" }, error: null, headers: {} });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(resendEmailProvider("re_test", "crm@bis-rgv.com", undefined, sleep).send(INPUT))
      .resolves.toEqual({ providerMessageId: "re_3" });
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("(e) an attempt that never answers rejects at 10 s, not at 9.999 s (mutation: drop the race → never settles, the test times out, FAILS)", async () => {
    vi.useFakeTimers();
    sendMock.mockReturnValue(new Promise(() => {}));
    let outcome: "pending" | "resolved" | Error = "pending";
    const pending = resendEmailProvider("re_test", "crm@bis-rgv.com").send(INPUT);
    pending.then(() => { outcome = "resolved"; }, (e: Error) => { outcome = e; });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as unknown as Error).message).toBe("resend did not answer within 10 s");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  // Dropping the `.catch` ALONE cannot fail this (probed): Promise.race already
  // subscribes to the attempt. What does fail it is the plausible rewrite of
  // the race by hand that subscribes only to the attempt's success.
  it("an abandoned attempt that rejects later is never an unhandled rejection (mutation: a hand-rolled race, `sent.then(resolve)` + the timer's reject → FAILS)", async () => {
    vi.useFakeTimers();
    let rejectLate!: (e: Error) => void;
    sendMock.mockReturnValue(new Promise((_r, reject) => { rejectLate = reject; }));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const pending = resendEmailProvider("re_test", "crm@bis-rgv.com").send(INPUT);
      const assertion = expect(pending).rejects.toThrow("resend did not answer within 10 s");
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      rejectLate(new Error("socket hang up"));
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("the timer is cleared on the success path, so no 10 s timer holds the function open (mutation: drop the clearTimeout → FAILS)", async () => {
    vi.useFakeTimers();
    await resendEmailProvider("re_test", "crm@bis-rgv.com").send(INPUT);
    expect(vi.getTimerCount()).toBe(0);
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
