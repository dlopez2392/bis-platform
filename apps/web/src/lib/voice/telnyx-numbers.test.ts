import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listTelnyxNumbers, setTelnyxVoiceConnection, telnyxRoutingConfig,
} from "./telnyx-numbers";

const KEY = "KEY_test";
const page = (rows: unknown[]) => ({
  ok: true, status: 200, text: async () => JSON.stringify({ data: rows }),
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("listTelnyxNumbers", () => {
  it("carries the bearer key and maps the fields the verdict needs", async () => {
    fetchMock.mockResolvedValueOnce(page([
      { id: "tn_1", phone_number: "+19565550100", connection_id: "conn_a", connection_name: "BIS Platform Voice", status: "active" },
    ]));
    const out = await listTelnyxNumbers(KEY);
    expect(out).toEqual([{
      id: "tn_1", phoneNumber: "+19565550100",
      connectionId: "conn_a", connectionName: "BIS Platform Voice", status: "active",
    }]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("reads an unset connection as null rather than as a string", async () => {
    // The whole routing verdict turns on this: "" or missing must become null
    // so `unrouted` is reached instead of a bogus connection id comparison.
    fetchMock.mockResolvedValueOnce(page([
      { id: "tn_1", phone_number: "+1955", connection_id: "", status: "active" },
      { id: "tn_2", phone_number: "+1956", status: "active" },
    ]));
    const out = await listTelnyxNumbers(KEY);
    expect(out.map((n) => n.connectionId)).toEqual([null, null]);
  });

  /**
   * Both dropped fields are load-bearing: `phone_number` is the only join key
   * to one of our rows and `id` is the handle a repair PATCHes. A record
   * carrying neither cannot be matched or acted on, and keeping a half-parsed
   * one would put an unusable entry in the index under a bogus key.
   */
  it("drops a record with no id or no phone number rather than half-parsing it", async () => {
    fetchMock.mockResolvedValueOnce(page([
      { phone_number: "+19565550100", connection_id: "conn_a" },
      { id: "tn_2", connection_id: "conn_a" },
      { id: "tn_3", phone_number: "+19565550101", connection_id: "conn_a" },
    ]));
    expect((await listTelnyxNumbers(KEY)).map((n) => n.id)).toEqual(["tn_3"]);
  });

  it("follows pages until a short one, and stops", async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({
      id: `tn_${i}`, phone_number: `+1955000${String(i).padStart(4, "0")}`, connection_id: "c",
    }));
    fetchMock.mockResolvedValueOnce(page(full));
    fetchMock.mockResolvedValueOnce(page([{ id: "tn_last", phone_number: "+19999999999", connection_id: "c" }]));
    const out = await listTelnyxNumbers(KEY);
    expect(out).toHaveLength(251);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at the page bound rather than looping forever on a full page", async () => {
    // A `meta` that always claims another page — or a carrier bug — must not
    // spin this inside a page render.
    const full = Array.from({ length: 250 }, (_, i) => ({
      id: `tn_${i}`, phone_number: `+1955000${String(i).padStart(4, "0")}`, connection_id: "c",
    }));
    fetchMock.mockResolvedValue(page(full));
    await listTelnyxNumbers(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws with the status and body on a refusal, never a silent empty list", async () => {
    // An empty list would read as "every number is absent" — the carrier
    // saying 401 must never be rendered as a verdict about the numbers.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "unauthorized" });
    // One call, one assertion on the message — a second `rejects` here would
    // run listTelnyxNumbers again against an exhausted `mockResolvedValueOnce`
    // and pass for the wrong reason.
    const err = await listTelnyxNumbers(KEY).then(() => null, (e: unknown) => String(e));
    expect(err).toContain("401");
    expect(err).toContain("unauthorized");
  });
});

describe("setTelnyxVoiceConnection", () => {
  it("PATCHes exactly one field, at the number's own id", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" });
    await setTelnyxVoiceConnection(KEY, "tn_1", "conn_ours");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telnyx.com/v2/phone_numbers/tn_1");
    expect(init.method).toBe("PATCH");
    // Exactly one key: anything else here is a carrier setting being changed
    // by a screen that never said it would.
    expect(JSON.parse(init.body as string)).toEqual({ connection_id: "conn_ours" });
  });

  it("escapes the id rather than pasting it into a URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" });
    await setTelnyxVoiceConnection(KEY, "tn/../evil", "conn_ours");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.telnyx.com/v2/phone_numbers/tn%2F..%2Fevil");
  });

  it("throws on a refusal so the caller never reports a repair that did not happen", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "bad connection" });
    await expect(setTelnyxVoiceConnection(KEY, "tn_1", "conn_ours")).rejects.toThrow(/422/);
  });
});

describe("telnyxRoutingConfig", () => {
  it("reads both values", () => {
    expect(telnyxRoutingConfig({ TELNYX_API_KEY: "k", TELNYX_VOICE_CONNECTION_ID: "c" }))
      .toEqual({ apiKey: "k", connectionId: "c" });
  });

  it("treats blank and whitespace as absent, so a stray env line cannot pose as config", () => {
    expect(telnyxRoutingConfig({ TELNYX_API_KEY: "", TELNYX_VOICE_CONNECTION_ID: "   " }))
      .toEqual({ apiKey: null, connectionId: null });
    expect(telnyxRoutingConfig({})).toEqual({ apiKey: null, connectionId: null });
  });
});
