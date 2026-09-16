// EVERY TeXML document this app emits, run through a parser instead of a
// substring match.
//
// This file exists because the rest of the voice suite could not tell valid
// TeXML from invalid TeXML. When the SIP URI grew a second `?X-` parameter,
// the two were joined with a raw `&` — and that URI is XML CHARACTER DATA
// inside `<Sip>`, where a bare `&` is a fatal well-formedness error (XML 1.0
// §2.4: a parser reads `&X-BIS-Handoff` as an entity reference). 130 tests
// stayed green through it, because they all assert that a TOKEN IS PRESENT
// rather than that Telnyx can parse the document. A strict parser would have
// failed the bridge on every real inbound call; a lenient one would have
// silently eaten the token and failed every handoff closed, with no symptom.
//
// So the assertion here is the only one that generalises: PARSE IT. The next
// parameter anyone appends to that URI is caught by this file and by nothing
// else.
//
// WHY A PARSER IS DEFINED HERE rather than imported: this workspace has no
// XML parser and no DOM. `apps/web` has no `jsdom`, no `@xmldom/xmldom`, no
// `fast-xml-parser` (checked `node_modules/.pnpm`), and Node 24 does not ship
// a global `DOMParser` (`typeof globalThis.DOMParser === "undefined"`).
// Adding a dependency to fix a one-character bug is not a trade worth making,
// so `parseXmlStrict` below is a real recursive-descent well-formedness
// checker over the XML 1.0 rules that TeXML can actually violate — balanced
// and properly nested tags, one root, quoted attribute values, no bare `<`,
// and every `&` starting a legal reference. It is itself proven by the
// negative controls in the first describe block: a checker nobody has watched
// reject a bad document is not evidence either.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as texmlGET } from "./route";
import { POST as handoffPOST } from "./handoff/route";

// ---------------------------------------------------------------------------
// The parser.
// ---------------------------------------------------------------------------

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9._:-]/;
const REFERENCE = /^&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/;

/**
 * Throws unless `src` is a well-formed XML document. Returns nothing: the
 * only question this file asks is "would a parser accept this?".
 */
export function parseXmlStrict(src: string): void {
  let i = 0;
  const stack: string[] = [];
  let rootSeen = false;
  let rootClosed = false;

  // Explicitly typed, not just annotated on the arrow: TypeScript only lets a
  // `never`-returning CONST narrow control flow when the variable itself
  // carries the type, and this parser leans on that after every `fail(…)`.
  const fail: (msg: string) => never = (msg) => {
    throw new Error(`XML not well-formed at offset ${i}: ${msg}`);
  };
  const skipSpace = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  const readName = (): string => {
    const start = i;
    if (i >= src.length || !NAME_START.test(src[i]!)) fail("expected an element or attribute name");
    i++;
    while (i < src.length && NAME_CHAR.test(src[i]!)) i++;
    return src.slice(start, i);
  };
  // `&` must begin a legal reference, in character data AND in attribute
  // values. This is the rule the bridge document broke.
  const checkText = (text: string, where: string, allowLt: boolean) => {
    for (let k = 0; k < text.length; k++) {
      if (text[k] === "&" && !REFERENCE.test(text.slice(k))) {
        fail(`bare '&' in ${where} — an '&' must start a reference like &amp;`);
      }
      if (!allowLt && text[k] === "<") fail(`bare '<' in ${where}`);
    }
  };

  if (src.startsWith("<?xml")) {
    const end = src.indexOf("?>");
    if (end < 0) fail("unterminated XML declaration");
    i = end + 2;
  }

  while (i < src.length) {
    if (src[i] === "<") {
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i);
        if (end < 0) fail("unterminated comment");
        i = end + 3;
        continue;
      }
      if (src.startsWith("<?", i)) {
        const end = src.indexOf("?>", i);
        if (end < 0) fail("unterminated processing instruction");
        i = end + 2;
        continue;
      }
      if (src.startsWith("</", i)) {
        i += 2;
        const name = readName();
        skipSpace();
        if (src[i] !== ">") fail(`malformed end tag </${name}`);
        i++;
        const open = stack.pop();
        if (open === undefined) fail(`end tag </${name}> with no open element`);
        if (open !== name) fail(`end tag </${name}> does not match <${open}>`);
        if (stack.length === 0) rootClosed = true;
        continue;
      }
      i++;
      const name = readName();
      if (rootClosed && stack.length === 0) fail(`second root element <${name}>`);
      for (;;) {
        const before = i;
        skipSpace();
        if (src[i] === ">") {
          i++;
          stack.push(name);
          rootSeen = true;
          break;
        }
        if (src.startsWith("/>", i)) {
          i += 2;
          rootSeen = true;
          if (stack.length === 0) rootClosed = true;
          break;
        }
        if (i === before) fail(`missing whitespace before an attribute of <${name}>`);
        const attr = readName();
        skipSpace();
        if (src[i] !== "=") fail(`attribute ${attr} of <${name}> has no value`);
        i++;
        skipSpace();
        const quote = src[i];
        if (quote !== '"' && quote !== "'") fail(`attribute ${attr} of <${name}> is not quoted`);
        i++;
        const end = src.indexOf(quote, i);
        if (end < 0) fail(`unterminated value for attribute ${attr} of <${name}>`);
        checkText(src.slice(i, end), `the value of ${attr} on <${name}>`, false);
        i = end + 1;
      }
      continue;
    }
    const next = src.indexOf("<", i);
    const end = next < 0 ? src.length : next;
    const text = src.slice(i, end);
    if (stack.length === 0 && text.trim() !== "") fail("text outside the root element");
    checkText(text, `the content of <${stack[stack.length - 1] ?? "document"}>`, true);
    i = end;
  }

  if (stack.length > 0) fail(`unclosed element <${stack[stack.length - 1]}>`);
  if (!rootSeen) fail("no root element");
}

describe("the well-formedness checker itself", () => {
  // Negative controls FIRST. Without these, a checker that accepted
  // everything would make every assertion below vacuous — which is the exact
  // failure this file was written to end.
  const bad: [string, string][] = [
    [
      "the real bug: a bare '&' joining two SIP URI params",
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial><Sip>sip:p@sip.api.openai.com;transport=tls?X-BIS-Called=%2B1&X-BIS-Handoff=abc</Sip></Dial></Response>`,
    ],
    ["a bare '&' in an attribute value", `<Response><Dial action="https://x/y?a=1&b=2"/></Response>`],
    ["an unclosed element", `<Response><Dial>+1</Response>`],
    ["a mismatched end tag", `<Response><Say>hi</Sip></Response>`],
    ["a bare '<' in character data", `<Response><Say>a < b</Say></Response>`],
    ["an unquoted attribute value", `<Response><Dial timeout=20>+1</Dial></Response>`],
    ["two root elements", `<Response/><Response/>`],
    ["an unknown entity", `<Response><Say>Tom &nope; Jerry</Say></Response>`],
  ];
  for (const [name, doc] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parseXmlStrict(doc)).toThrow(/not well-formed/);
    });
  }

  const good: [string, string][] = [
    ["an escaped '&'", `<Response><Sip>sip:p@h?a=1&amp;b=2</Sip></Response>`],
    ["numeric character references", `<Response><Say>Tom &#38; Jerry &#x27;s</Say></Response>`],
    ["an empty element and an attribute", `<Response><Dial timeout="20">+1</Dial><Hangup/></Response>`],
    ["accented Spanish copy", `<Response><Say language="es-MX">Lo sentimos — más tarde.</Say></Response>`],
  ];
  for (const [name, doc] of good) {
    it(`accepts ${name}`, () => {
      expect(() => parseXmlStrict(doc)).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// Every document the two routes can emit.
// ---------------------------------------------------------------------------

const lookupMock = vi.hoisted(() => vi.fn());
const profileMock = vi.hoisted(() => vi.fn());
const countCallsSinceMock = vi.hoisted(() => vi.fn());
const countCallsByCallerSinceMock = vi.hoisted(() => vi.fn());
const countCallerHistorySinceMock = vi.hoisted(() => vi.fn());
const getCallByHandoffTokenMock = vi.hoisted(() => vi.fn());
const getTransferPhoneMock = vi.hoisted(() => vi.fn());
const listPhoneNumbersForAccountMock = vi.hoisted(() => vi.fn());

vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPhoneNumberByE164: (...a: unknown[]) => lookupMock(...a),
  getVoiceProfile: (...a: unknown[]) => profileMock(...a),
  countCallsSince: (...a: unknown[]) => countCallsSinceMock(...a),
  countCallsByCallerSince: (...a: unknown[]) => countCallsByCallerSinceMock(...a),
  countCallerHistorySince: (...a: unknown[]) => countCallerHistorySinceMock(...a),
  getCallByHandoffToken: (...a: unknown[]) => getCallByHandoffTokenMock(...a),
  getTransferPhone: (...a: unknown[]) => getTransferPhoneMock(...a),
  listPhoneNumbersForAccount: (...a: unknown[]) => listPhoneNumbersForAccountMock(...a),
}));

const PROFILE = {
  id: "vp1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi", greeting_es: "Hola", facts: "-", services: "-",
  languages: "en" as const, booking_enabled: true,
  after_hours: "hours_then_message" as const, enabled: true,
};
const LIVE_TO = "+19565550999";
const CALLER = "+19562921696";

beforeEach(() => {
  process.env.VOICE_OPENAI_PROJECT_ID = "proj_test123";
  delete process.env.TELNYX_PUBLIC_KEY;
  delete process.env.VOICE_FORWARD_TO;
  lookupMock.mockReset().mockResolvedValue({ id: "pn1", account_id: "a1", e164: LIVE_TO, telnyx_id: null, status: "live" });
  profileMock.mockReset().mockResolvedValue(PROFILE);
  countCallsSinceMock.mockReset().mockResolvedValue(0);
  countCallsByCallerSinceMock.mockReset().mockResolvedValue(0);
  countCallerHistorySinceMock.mockReset().mockResolvedValue({ spamCalls: 0, otherCalls: 0 });
  getCallByHandoffTokenMock.mockReset().mockResolvedValue({
    id: "c1", account_id: "acct1", phone_number_id: "pn1",
    handoff_requested_at: new Date().toISOString(),
  });
  getTransferPhoneMock.mockReset().mockResolvedValue(CALLER);
  listPhoneNumbersForAccountMock.mockReset().mockResolvedValue([
    { id: "pn1", account_id: "acct1", e164: LIVE_TO, telnyx_id: null, status: "live" },
  ]);
});

async function texml(params: Record<string, string>): Promise<string> {
  const q = new URLSearchParams(params);
  const res = await texmlGET(new Request(`https://x.example/api/voice/texml?${q.toString()}`));
  return res.text();
}

async function handoff(token: string): Promise<string> {
  const res = await handoffPOST(new Request(`https://x.example/api/voice/texml/handoff?t=${token}`, {
    method: "POST", body: new URLSearchParams(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  }));
  return res.text();
}

describe("every emitted TeXML document parses", () => {
  it("the bridge WITH a dialed number — the document every real inbound call gets", async () => {
    const xml = await texml({ To: LIVE_TO, From: CALLER });
    expect(xml).toContain("<Sip>");
    parseXmlStrict(xml);
  });

  it("the bridge with NO dialed number (one URI parameter, no separator)", async () => {
    const xml = await texml({});
    expect(xml).toContain("<Sip>");
    parseXmlStrict(xml);
  });

  it("the English refusal", async () => {
    lookupMock.mockResolvedValue(null);
    const xml = await texml({ To: LIVE_TO, From: CALLER });
    expect(xml).toContain("<Say>");
    parseXmlStrict(xml);
  });

  it("the bilingual refusal (accented Spanish copy, language attribute)", async () => {
    profileMock.mockResolvedValue({ ...PROFILE, enabled: false, languages: "both" });
    const xml = await texml({ To: LIVE_TO, From: CALLER });
    expect(xml).toContain("es-MX");
    parseXmlStrict(xml);
  });

  it("the cap refusal, in both languages", async () => {
    profileMock.mockResolvedValue({ ...PROFILE, languages: "both" });
    countCallsByCallerSinceMock.mockResolvedValue(5);
    const xml = await texml({ To: LIVE_TO, From: CALLER });
    expect(xml).toContain("can't take more calls today");
    parseXmlStrict(xml);
  });

  it("the configuration-error document", async () => {
    delete process.env.VOICE_OPENAI_PROJECT_ID;
    const xml = await texml({ To: LIVE_TO, From: CALLER });
    expect(xml).toContain("Configuration error");
    parseXmlStrict(xml);
  });

  it("the operator forward document", async () => {
    process.env.VOICE_FORWARD_TO = "+19565550111";
    const xml = await texml({ To: LIVE_TO, From: CALLER });
    expect(xml).toContain("<Dial");
    parseXmlStrict(xml);
  });

  it("the handoff dial to a person", async () => {
    const xml = await handoff("tok_abc");
    expect(xml).toContain("<Dial");
    parseXmlStrict(xml);
  });

  it("the handoff hangup", async () => {
    getTransferPhoneMock.mockResolvedValue(null);
    const xml = await handoff("tok_abc");
    expect(xml).toContain("<Hangup");
    parseXmlStrict(xml);
  });
});
