// The press-1 screen's action route: what Telnyx fetches after the caller
// pressed a key (or did not). "1" must produce EXACTLY the bridge the main
// route would have sent; anything clean but wrong says goodbye; anything
// broken bridges, because a real customer hung up on is the worst outcome.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "./route";
import { GET as texmlGET } from "../route";

const stampMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/stamp", () => ({ stampHeartbeat: (...a: unknown[]) => stampMock(...a) }));

const lookupMock = vi.hoisted(() => vi.fn());
const profileMock = vi.hoisted(() => vi.fn());
const countCallsSinceMock = vi.hoisted(() => vi.fn());
const countCallsByCallerSinceMock = vi.hoisted(() => vi.fn());
const countCallerHistorySinceMock = vi.hoisted(() => vi.fn());
const transferPhoneMock = vi.hoisted(() => vi.fn());
const ownedNumbersMock = vi.hoisted(() => vi.fn());
const countForwardedMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPhoneNumberByE164: (...a: unknown[]) => lookupMock(...a),
  getVoiceProfile: (...a: unknown[]) => profileMock(...a),
  countCallsSince: (...a: unknown[]) => countCallsSinceMock(...a),
  countCallsByCallerSince: (...a: unknown[]) => countCallsByCallerSinceMock(...a),
  countCallerHistorySince: (...a: unknown[]) => countCallerHistorySinceMock(...a),
  countForwardedCallsSince: (...a: unknown[]) => countForwardedMock(...a),
  getTransferPhone: (...a: unknown[]) => transferPhoneMock(...a),
  listPhoneNumbersForAccount: (...a: unknown[]) => ownedNumbersMock(...a),
  recordScreenedCall: async () => undefined,
  recordForwardedCall: async () => undefined,
}));
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});

const ACCOUNT = "0b2cbb04-b46c-4fed-a377-d377a1a201eb";
const LINE = "+19565550999";
const STRANGER = "+19565550444";
const PROFILE = {
  id: "vp1", account_id: ACCOUNT, persona_name: "Sofía",
  greeting_en: "Hi", greeting_es: "Hola", facts: "-", services: "-",
  languages: "en" as const, booking_enabled: true,
  after_hours: "hours_then_message" as const, enabled: true,
};
const GOODBYE_EN = "<Say>Sorry, we didn't get that. Please call again anytime. Goodbye.</Say>";
const GOODBYE_ES = "<Say language=\"es-MX\">Lo sentimos, no recibimos su respuesta. Puede llamar de nuevo cuando guste. Adiós.</Say>";

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.VOICE_OPENAI_PROJECT_ID = "proj_test123";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-fixture";
  // The screen is ON for this line in every test here: the keypress must
  // bridge even though the caller is still first-time and the line listed.
  process.env.VOICE_SCREEN_NUMBERS = LINE;
  for (const k of [
    "TELNYX_PUBLIC_KEY", "VOICE_HANDOFF_SECRET", "VOICE_FORWARD_TO", "VOICE_SCREEN_ALWAYS_FROM",
    "PHONE_SPAM_EXEMPT_CALLERS", "APP_ORIGIN", "PHONE_MAX_CALLS_PER_NUMBER_PER_DAY",
    "PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY", "VOICE_FALLBACK_DRILL_TO", "VOICE_FALLBACK_DRILL_FROM",
  ]) delete process.env[k];
  lookupMock.mockReset().mockImplementation(async (_db: unknown, e164: string) =>
    (e164 === LINE ? { id: "pn1", account_id: ACCOUNT, e164: LINE, telnyx_id: null, status: "live" } : null));
  profileMock.mockReset().mockResolvedValue(PROFILE);
  countCallsSinceMock.mockReset().mockResolvedValue(0);
  countCallsByCallerSinceMock.mockReset().mockResolvedValue(0);
  countCallerHistorySinceMock.mockReset().mockResolvedValue({ spamCalls: 0, otherCalls: 0, answeredCalls: 0 });
  countForwardedMock.mockReset().mockResolvedValue({ forAccount: 0, forCaller: 0 });
  transferPhoneMock.mockReset().mockResolvedValue("+19565550123");
  ownedNumbersMock.mockReset().mockResolvedValue([{ id: "pn1", account_id: ACCOUNT, e164: LINE, telnyx_id: null, status: "live" }]);
  stampMock.mockReset();
  afterMock.mockReset();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// The SECOND ask (`n=2`): where a missing or wrong key is final. The first
// ask re-asks instead — see "asked twice" below.
const URL_BASE = `https://x.example/api/voice/texml/screen?l=en&a=${ACCOUNT}&n=2`;
const FIRST_ASK = `https://x.example/api/voice/texml/screen?l=en&a=${ACCOUNT}&n=1`;

function press(fields: Record<string, string>, url = URL_BASE): Promise<Response> {
  return POST(new Request(url, {
    method: "POST", body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  }));
}

function telnyxSigned(fields: Record<string, string>): Promise<Response> {
  const raw = new URLSearchParams(fields).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  process.env.TELNYX_PUBLIC_KEY = spki.subarray(spki.length - 32).toString("base64");
  return POST(new Request(URL_BASE, {
    method: "POST", body: raw,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "telnyx-timestamp": ts,
      "telnyx-signature-ed25519": cryptoSign(null, Buffer.from(`${ts}|${raw}`, "utf8"), privateKey).toString("base64"),
    },
  }));
}

describe("pressed 1: the bridge the main route would have sent", () => {
  it("a first-time caller on a listed line who pressed 1 gets Sofía's bridge, token and ticket included — never the question again (mutation: answer \"1\" with the goodbye → FAILS)", async () => {
    const { verifyFallbackTicket } = await import("@/lib/voice/fallback-ticket");
    const res = await press({ Digits: "1", To: LINE, From: STRANGER });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\"");
    expect(xml).toContain("<Sip>sip:proj_test123@sip.api.openai.com;transport=tls?X-BIS-Called=%2B19565550999&amp;X-BIS-Handoff=");
    expect(xml).not.toContain("<Gather");
    const action = new URL(/<Dial[^>]*action="([^"]+)"/.exec(xml)![1]!.replaceAll("&amp;", "&"));
    const onUri = /X-BIS-Handoff=([A-Za-z0-9_-]+)/.exec(xml)![1];
    expect(action.pathname).toBe("/api/voice/texml/handoff");
    expect(action.searchParams.get("t")).toBe(onUri);
    expect(verifyFallbackTicket(action.searchParams.get("f"), onUri!, Date.now()))
      .toEqual({ ok: true, accountId: ACCOUNT, calledE164: LINE, callerE164: STRANGER });
    expect(logSpy).toHaveBeenCalledWith(`texml screen passed for ${LINE}, caller ${STRANGER}, accountId ${ACCOUNT}`);
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("voice.texml", { ok: true });
  });

  it("on a Telnyx-signed request the bridge carries the SIP signature for this called number and caller", async () => {
    process.env.VOICE_HANDOFF_SECRET = "h".repeat(48);
    const { verifySipHandoff } = await import("@/lib/voice/sip-handoff-signature");
    const xml = await (await telnyxSigned({ Digits: "1", To: LINE, From: STRANGER })).text();
    const uri = /<Sip>([^<]*)<\/Sip>/.exec(xml)![1]!.replaceAll("&amp;", "&");
    const p = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
    expect(verifySipHandoff(p.get("X-BIS-Signature"), p.get("X-BIS-Handoff"), Date.now()))
      .toEqual({ ok: true, calledE164: LINE, callerE164: STRANGER });
  });

  it("the guards re-run on the keypress: a caller now over the cap hears the cap sentence", async () => {
    countCallsByCallerSinceMock.mockResolvedValue(9);
    const xml = await (await press({ Digits: "1", To: LINE, From: STRANGER })).text();
    expect(xml).toContain("can't take more calls today");
    expect(xml).not.toContain("<Dial");
  });

  it("the per-account forward is honoured once the caller has pressed 1", async () => {
    profileMock.mockResolvedValue({ ...PROFILE, forward_calls: true });
    const xml = await (await press({ Digits: "1", To: LINE, From: STRANGER })).text();
    expect(xml).toContain('<Dial callerId="+19565550999" timeout="30" timeLimit="3600">+19565550123</Dial>');
  });

  it("a withheld caller who pressed 1 is bridged too", async () => {
    const xml = await (await press({ Digits: "1", To: LINE, From: "anonymous" })).text();
    expect(xml).toContain("<Sip>");
    expect(logSpy).toHaveBeenCalledWith(`texml screen passed for ${LINE}, caller unknown, accountId ${ACCOUNT}`);
  });
});

describe("pressed nothing, or another key, on the SECOND ask: goodbye", () => {
  it("another key → the goodbye and a hang-up, no bridge, no database read, and one declined line (mutation: bridge on any key → FAILS)", async () => {
    const xml = await (await press({ Digits: "2", To: LINE, From: STRANGER })).text();
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${GOODBYE_EN}<Hangup/></Response>`);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(`texml screen declined (wrong-key) for ${LINE}, caller ${STRANGER}, accountId ${ACCOUNT}`);
  });

  it("no Digits field at all → no-keypress goodbye", async () => {
    const xml = await (await press({ To: LINE, From: STRANGER })).text();
    expect(xml).toContain(GOODBYE_EN);
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
    expect(logSpy).toHaveBeenCalledWith(`texml screen declined (no-keypress) for ${LINE}, caller ${STRANGER}, accountId ${ACCOUNT}`);
  });

  it("an empty Digits field → no-keypress goodbye", async () => {
    const xml = await (await press({ Digits: "", To: LINE, From: STRANGER })).text();
    expect(xml).toContain(GOODBYE_EN);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("texml screen declined (no-keypress)"));
  });

  it("# and * are keys too: wrong-key", async () => {
    for (const d of ["#", "*", "0", "9"]) {
      expect(await (await press({ Digits: d, To: LINE, From: STRANGER })).text()).toContain(GOODBYE_EN);
    }
  });

  it("the goodbye speaks the profile's languages from the action URL: es", async () => {
    const xml = await (await press({ Digits: "2", To: LINE, From: STRANGER }, `https://x.example/api/voice/texml/screen?l=es&a=${ACCOUNT}&n=2`)).text();
    expect(xml).toContain(GOODBYE_ES);
    expect(xml).not.toContain("<Say>Sorry");
  });

  it("the goodbye in both languages, English first", async () => {
    const xml = await (await press({ To: LINE, From: STRANGER }, `https://x.example/api/voice/texml/screen?l=both&a=${ACCOUNT}&n=2`)).text();
    expect(xml).toContain(GOODBYE_EN + GOODBYE_ES);
  });

  it("an unknown language value falls back to English, and a non-uuid account is logged as unknown", async () => {
    const xml = await (await press({ Digits: "2", To: LINE, From: STRANGER }, "https://x.example/api/voice/texml/screen?l=fr&a=bad%0Aline&n=2")).text();
    expect(xml).toContain(GOODBYE_EN);
    expect(logSpy).toHaveBeenCalledWith(`texml screen declined (wrong-key) for ${LINE}, caller ${STRANGER}, accountId unknown`);
  });
});

describe("anything broken: fall through to the bridge", () => {
  it("no called number on the request → the bridge without X-BIS-Called, never a hang-up (mutation: goodbye on a missing To → FAILS)", async () => {
    const xml = await (await press({ Digits: "2", From: STRANGER })).text();
    expect(xml).toContain("<Sip>sip:proj_test123@sip.api.openai.com;transport=tls?X-BIS-Handoff=");
    expect(xml).not.toContain("Goodbye");
  });

  it("a Digits value that is not a single key is garbage, not a decline → bridge", async () => {
    const xml = await (await press({ Digits: "12ab", To: LINE, From: STRANGER })).text();
    expect(xml).toContain("<Sip>");
    expect(xml).not.toContain("Goodbye");
  });

  it("a body that cannot be read (key unset) → bridge", async () => {
    const req = new Request(URL_BASE, { method: "POST", body: "Digits=2" });
    vi.spyOn(req, "text").mockRejectedValue(new Error("stream error"));
    const xml = await (await POST(req)).text();
    expect(xml).toContain("<Sip>");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("texml screen: failed to read request body"));
  });

  it("a throw anywhere on the keypress path → the plain bridge, 200, never a 500 (mutation: drop the catch → FAILS)", async () => {
    stampMock.mockImplementation(() => { throw new Error("boom"); });
    const res = await press({ Digits: "1", To: LINE, From: STRANGER });
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Sip>sip:proj_test123@sip.api.openai.com;transport=tls?X-BIS-Called=%2B19565550999");
    expect(xml).not.toContain("&amp;f="); // uncleared: no fallback ticket
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("texml screen failed — bridging"));
  });
});

describe("the same Telnyx gate as the main route", () => {
  it("with TELNYX_PUBLIC_KEY set, an unsigned request is refused 403 and nothing is routed", async () => {
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const res = await press({ Digits: "1", To: LINE, From: STRANGER });
    expect(res.status).toBe(403);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(`texml screen: rejected request (missing-headers), claimedTo ${LINE}, claimedFrom ${STRANGER}`);
  });

  it("a tampered body is refused 403", async () => {
    const raw = new URLSearchParams({ Digits: "2", To: LINE, From: STRANGER }).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    process.env.TELNYX_PUBLIC_KEY = spki.subarray(spki.length - 32).toString("base64");
    const sig = cryptoSign(null, Buffer.from(`${ts}|${raw}`, "utf8"), privateKey).toString("base64");
    const res = await POST(new Request(URL_BASE, {
      method: "POST", body: raw.replace("Digits=2", "Digits=1"),
      headers: { "content-type": "application/x-www-form-urlencoded", "telnyx-timestamp": ts, "telnyx-signature-ed25519": sig },
    }));
    expect(res.status).toBe(403);
  });

  it("a signed decline still says goodbye", async () => {
    const xml = await (await telnyxSigned({ Digits: "3", To: LINE, From: STRANGER })).text();
    expect(xml).toContain(GOODBYE_EN);
  });

  it("logs the request's field names, not their values", async () => {
    await press({ Digits: "2", To: LINE, From: STRANGER, CallSid: "v3:secret" });
    expect(logSpy).toHaveBeenCalledWith("texml screen form fields: Digits,To,From,CallSid; attestation: none");
  });
});

describe("GET mirrors the main route: closed with the key set, answered without it", () => {
  it("GET with TELNYX_PUBLIC_KEY set → 405", async () => {
    process.env.TELNYX_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const res = await GET(new Request(`${URL_BASE}&Digits=1&To=${encodeURIComponent(LINE)}`));
    expect(res.status).toBe(405);
  });

  it("GET without the key reads the keypress from the query: 1 → bridge, 2 → goodbye", async () => {
    const one = await (await GET(new Request(`${URL_BASE}&Digits=1&To=${encodeURIComponent(LINE)}&From=${encodeURIComponent(STRANGER)}`))).text();
    expect(one).toContain("<Sip>");
    const two = await (await GET(new Request(`${URL_BASE}&Digits=2&To=${encodeURIComponent(LINE)}&From=${encodeURIComponent(STRANGER)}`))).text();
    expect(two).toContain(GOODBYE_EN);
  });
});

// ---------------------------------------------------------------------------
// ASKED TWICE, whatever the carrier does on a timeout. Telnyx's docs do not
// say whether a `<Gather>` that times out with no key fetches its action URL
// (with no `Digits`) or falls through to the next verb. The question document
// is built so both lead to the same call: ask (n=1), ask again (n=2), goodbye.
// ---------------------------------------------------------------------------

/** Every `<Gather>`'s action URL in a document, unescaped, in order. */
function gathers(xml: string): URL[] {
  return [...xml.matchAll(/<Gather action="([^"]+)"/g)].map((m) => new URL(m[1]!.replaceAll("&amp;", "&")));
}
const PROMPT = "<Say>Thanks for calling. To be connected, please press 1.</Say>";

describe("pressed nothing, or another key, on the FIRST ask: asked once more", () => {
  it("no key on the first ask → the question again (n=2), then the goodbye as its fall-through, and NO decline yet (mutation: say goodbye on the first ask → FAILS)", async () => {
    const xml = await (await press({ To: LINE, From: STRANGER }, FIRST_ASK)).text();
    const asks = gathers(xml);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.pathname).toBe("/api/voice/texml/screen");
    expect(asks[0]!.searchParams.get("n")).toBe("2");
    expect(asks[0]!.searchParams.get("l")).toBe("en");
    expect(asks[0]!.searchParams.get("a")).toBe(ACCOUNT);
    expect(xml).toContain(`>${PROMPT}</Gather>${GOODBYE_EN}<Hangup/></Response>`);
    expect(xml).not.toContain("<Dial");
    expect(logSpy).toHaveBeenCalledWith(`texml screen asking again (no-keypress) for ${LINE}, caller ${STRANGER}, accountId ${ACCOUNT}`);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("declined"));
  });

  it("a WRONG key on the first ask is asked once more too — a person who pressed the wrong key is still a person (mutation: decline a wrong key on the first ask → FAILS)", async () => {
    const xml = await (await press({ Digits: "2", To: LINE, From: STRANGER }, FIRST_ASK)).text();
    expect(gathers(xml).map((u) => u.searchParams.get("n"))).toEqual(["2"]);
    expect(logSpy).toHaveBeenCalledWith(`texml screen asking again (wrong-key) for ${LINE}, caller ${STRANGER}, accountId ${ACCOUNT}`);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("declined"));
  });

  it("the second ask speaks the profile's languages from the action URL", async () => {
    const xml = await (await press({ To: LINE, From: STRANGER }, `https://x.example/api/voice/texml/screen?l=es&a=${ACCOUNT}&n=1`)).text();
    expect(xml).toContain("<Say language=\"es-MX\">Gracias por llamar. Para comunicarse, oprima 1.</Say></Gather>");
    expect(xml).toContain(GOODBYE_ES);
    expect(gathers(xml)[0]!.searchParams.get("l")).toBe("es");
  });

  it("a missing or unknown marker is a FIRST ask: the marker can only ever buy a caller one more ask, never cost them one", async () => {
    for (const url of [`https://x.example/api/voice/texml/screen?l=en&a=${ACCOUNT}`, `${FIRST_ASK.replace("n=1", "n=7")}`]) {
      const xml = await (await press({ To: LINE, From: STRANGER }, url)).text();
      expect(gathers(xml), url).toHaveLength(1);
      expect(xml).not.toContain("<Dial");
    }
  });

  it("the marker decides nothing but which words to play: 1 bridges on either ask, or with no marker at all", async () => {
    for (const url of [FIRST_ASK, URL_BASE, `https://x.example/api/voice/texml/screen?l=en&a=${ACCOUNT}`]) {
      const xml = await (await press({ Digits: "1", To: LINE, From: STRANGER }, url)).text();
      expect(xml, url).toContain("<Sip>sip:proj_test123@sip.api.openai.com");
    }
  });
});

describe("asked exactly twice under EITHER carrier behaviour on a timeout", () => {
  const question = async () => (await texmlGET(new Request(
    `https://x.example/api/voice/texml?To=${encodeURIComponent(LINE)}&From=${encodeURIComponent(STRANGER)}`,
  ))).text();

  it("A — the carrier falls through to the next verb: the question document itself asks twice (n=1, n=2), then says goodbye (mutation: delete the second ask → FAILS)", async () => {
    const xml = await question();
    expect(gathers(xml).map((u) => u.searchParams.get("n"))).toEqual(["1", "2"]);
    // Two asks, then the goodbye and the hang-up — nothing between them.
    expect(xml).toContain(`${PROMPT}</Gather>${GOODBYE_EN}<Hangup/></Response>`);
    expect(xml.split(PROMPT)).toHaveLength(3);
  });

  it("B — the carrier fetches the action on every timeout: ask (n=1), fetch, ask again (n=2), fetch, goodbye — and the decline is logged on the second fetch (mutation: say goodbye on the first ask → FAILS)", async () => {
    let asked = 0;
    // The first ask of the question document is heard, then it times out
    // and the carrier fetches ITS action, with no Digits.
    let xml = await question();
    let action = gathers(xml)[0]!;
    asked++;
    for (let fetches = 0; fetches < 5; fetches++) {
      xml = await (await press({ To: LINE, From: STRANGER }, action.toString())).text();
      const next = gathers(xml);
      if (next.length === 0) break;
      asked++;
      action = next[0]!;
    }
    expect(asked).toBe(2);
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${GOODBYE_EN}<Hangup/></Response>`);
    expect(logSpy).toHaveBeenCalledWith(`texml screen declined (no-keypress) for ${LINE}, caller ${STRANGER}, accountId ${ACCOUNT}`);
  });

  it("B, with a wrong key both times: asked twice, then declined (wrong-key)", async () => {
    const first = gathers(await question())[0]!;
    const second = gathers(await (await press({ Digits: "5", To: LINE, From: STRANGER }, first.toString())).text())[0]!;
    const last = await (await press({ Digits: "5", To: LINE, From: STRANGER }, second.toString())).text();
    expect(gathers(last)).toHaveLength(0);
    expect(last).toContain(GOODBYE_EN);
    expect(logSpy).toHaveBeenCalledWith(`texml screen declined (wrong-key) for ${LINE}, caller ${STRANGER}, accountId ${ACCOUNT}`);
  });
});
