import { describe, it, expect, vi, afterEach } from "vitest";
import { telnyxSmsProvider } from "./telnyx";

/**
 * The one module in this feature that spends money, and until now it was
 * verified by reading only — no test had ever executed its timeout, its
 * redirect substitution, or either of its error paths. It is written before
 * TELNYX_API_KEY exists anywhere, deliberately: once that key is set, a
 * mistake here is an unrecallable text and a real charge.
 *
 * `fetch` is stubbed rather than hit. No test in this file may reach the
 * network.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl as unknown as typeof fetch);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

const INPUT = { to: "+15551112222", from: "+19565061545", body: "hi" };

describe("telnyxSmsProvider", () => {
  it("posts to the v2 messages endpoint with bearer auth and the message body", async () => {
    const fetchSpy = stubFetch(() => ok({ data: { id: "msg_1" } }));

    const result = await telnyxSmsProvider("secret_key").send(INPUT);

    expect(result).toEqual({ providerMessageId: "msg_1" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret_key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init!.body as string)).toEqual({
      from: "+19565061545", to: "+15551112222", text: "hi",
    });
  });

  it("sends to redirectTo INSTEAD of the real recipient when one is configured", async () => {
    // The safety valve for a real key used outside production. If this ever
    // regressed, a developer testing against live Telnyx would text a real
    // customer — the exact thing the fake provider and this redirect exist to
    // make impossible. Asserted on the WIRE body, not on a property.
    const fetchSpy = stubFetch(() => ok({ data: { id: "msg_2" } }));

    const provider = telnyxSmsProvider("k", "+15550009999");
    await provider.send(INPUT);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.to).toBe("+15550009999");
    expect(body.to).not.toBe(INPUT.to);
    // `from` is the account's own number and must NOT be redirected.
    expect(body.from).toBe("+19565061545");
    expect(provider.redirectTo).toBe("+15550009999");
    expect(provider.isFake).toBe(false);
  });

  it("throws with the status and the provider's reason on a non-2xx", async () => {
    stubFetch(() => Promise.resolve(new Response("number not owned", { status: 422 })));

    // The message matters: it is what lands in `messages.error` and is the
    // only thing an operator has to act on for a failed text.
    await expect(telnyxSmsProvider("k").send(INPUT))
      .rejects.toThrow(/telnyx send failed \(422\): number not owned/);
  });

  it("throws when the response carries no message id", async () => {
    // A 200 with no id would otherwise return `{providerMessageId: undefined}`,
    // which write-then-send would store as a successful send that no delivery
    // receipt could ever correlate against.
    stubFetch(() => ok({ data: {} }));

    await expect(telnyxSmsProvider("k").send(INPUT))
      .rejects.toThrow(/telnyx send returned no message id/);
  });

  it("aborts the request after the timeout rather than hanging", async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | undefined;
    stubFetch((_url, init) => {
      captured = init.signal as AbortSignal;
      // A provider that never answers — the case the timeout exists for.
      return new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")));
      });
    });

    const pending = telnyxSmsProvider("k").send(INPUT);
    const assertion = expect(pending).rejects.toThrow(/abort/i);

    expect(captured!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(captured!.aborted).toBe(true);
    await assertion;
  });

  it("clears the timeout on BOTH the success and the failure path", async () => {
    // Without the `finally`, every send would leave a live 10s timer holding
    // the event loop open — which on a serverless function is billed time and
    // a delayed response.
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    stubFetch(() => ok({ data: { id: "msg_3" } }));
    await telnyxSmsProvider("k").send(INPUT);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    stubFetch(() => Promise.resolve(new Response("nope", { status: 500 })));
    await expect(telnyxSmsProvider("k").send(INPUT)).rejects.toThrow();
    expect(clearSpy).toHaveBeenCalledTimes(2);

    clearSpy.mockRestore();
  });

  it("does not leak the api key into a thrown error", async () => {
    // Errors from here reach `messages.error`, a database column an operator
    // and a client can both read.
    stubFetch(() => Promise.resolve(new Response("bad request", { status: 400 })));

    await expect(telnyxSmsProvider("super_secret_key").send(INPUT))
      .rejects.toThrow(expect.not.stringContaining("super_secret_key") as unknown as RegExp);
  });
});
