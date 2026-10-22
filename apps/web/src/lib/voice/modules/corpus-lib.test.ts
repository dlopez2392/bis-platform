import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseCorpusItem, parseFixture, promptInputFor, toolsFor, stubToolResult, renderTranscript,
  resultsSheetSkeleton, moduleForSlug, redact, CORPUS_SLUGS, DEFAULT_PHONE_ENGINE, PHONE_FALLBACK_MODEL,
  type CorpusFixture,
} from "./corpus-lib";
import { CAPTURE_LEAD_TOOL } from "../../concierge/prompt";

const ITEM = `---
lang: es
medium: phone
transfer: true
booking: false
facts: agencia-de-seguros-rio
---
caller:
- Acabo de chocar en la 83.
- No, nadie está herido.

must:
- Asks whether anyone is hurt before anything else.

must not:
- Says the claim is covered or opened.
`;

const FIXTURE: CorpusFixture = {
  businessName: "Agencia de Seguros Río", personaName: "Sofía", languages: "both", timezone: "America/Chicago",
  facts: "- Hours: Monday to Friday 9 AM to 6 PM.", services: "Auto, home, renters and commercial insurance",
  meetingType: "phone", slotDurationMinutes: 30, afterHours: "hours_then_message", callerNumber: "+19565550142",
  greetingEn: "Thanks for calling Agencia de Seguros Río. How can I help you?",
  greetingEs: "Gracias por llamar a Agencia de Seguros Río. ¿En qué le puedo ayudar?",
};

describe("parseCorpusItem", () => {
  it("parses front matter and the three sections exactly", () => {
    expect(parseCorpusItem("10-es-choque.md", ITEM)).toEqual({
      file: "10-es-choque.md", id: "10", lang: "es", medium: "phone", transfer: true, booking: false, disclosure: false,
      facts: "agencia-de-seguros-rio",
      caller: ["Acabo de chocar en la 83.", "No, nadie está herido."],
      must: ["Asks whether anyone is hurt before anything else."],
      mustNot: ["Says the claim is covered or opened."],
    });
  });
  it.each([
    ["a missing facts key", ITEM.replace("facts: agencia-de-seguros-rio\n", ""), /facts/],
    ["an unknown key", ITEM.replace("booking: false", "bookng: false"), /bookng/],
    ["an unknown medium", ITEM.replace("medium: phone", "medium: voice"), /medium/],
    ["a file name whose language disagrees", ITEM, /lang/],
    ["a stray line outside the sections", ITEM.replace("must:\n", "must:\nnot a bullet\n"), /not a bullet/],
    ["no must-not rule", ITEM.replace("must not:\n- Says the claim is covered or opened.\n", "must not:\n"), /must not/],
    ["a transfer on a web item (SD7)", ITEM.replace("medium: phone", "medium: web"), /transfer/],
    // M17: booking on a web item, with transfer false, so ONLY the booking refusal can throw.
    ["a booking on a web item (SD7)",
      ITEM.replace("medium: phone", "medium: web").replace("transfer: true", "transfer: false").replace("booking: false", "booking: true"),
      /booking/],
    ["a disclosure value that is not true or false", ITEM.replace("booking: false", "booking: false\ndisclosure: yes"), /disclosure/],
  ])("refuses %s, naming it", (name, text, re) => {
    const file = name === "a file name whose language disagrees" ? "10-en-choque.md" : "10-es-choque.md";
    expect(() => parseCorpusItem(file, text)).toThrow(re);
  });
  it("refuses a file name outside NN-<lang>-<slug>.md", () => {
    expect(() => parseCorpusItem("choque.md", ITEM)).toThrow(/file name/);
  });
});

describe("parseFixture", () => {
  it("reads a complete fixture, and refuses one missing a key, naming the key (mutation: drop the key check -> FAILS)", () => {
    expect(parseFixture("agencia-de-seguros-rio", JSON.stringify(FIXTURE))).toEqual(FIXTURE);
    const { greetingEs: _dropped, ...partial } = FIXTURE;
    void _dropped;
    expect(() => parseFixture("agencia-de-seguros-rio", JSON.stringify(partial)))
      .toThrow('fixture agencia-de-seguros-rio: missing "greetingEs"');
  });
});

describe("promptInputFor / toolsFor: the real input and tools of each medium", () => {
  it("phone: the incoming route's shape, with this item's transfer and booking (mutation: handoffAvailable: false always -> FAILS)", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM);
    expect(promptInputFor(item, FIXTURE, "insurance_pc")).toEqual({
      personaName: "Sofía", businessName: "Agencia de Seguros Río", facts: FIXTURE.facts, services: FIXTURE.services,
      languages: "both", bookingEnabled: false, timezone: "America/Chicago", slotDurationMinutes: 30,
      afterHours: "hours_then_message", callerNumber: "+19565550142", meetingType: "phone",
      handoffAvailable: true, disclosed: false, tradeModule: "insurance_pc",
    });
    expect(toolsFor(item, promptInputFor(item, FIXTURE, "insurance_pc")).map((t) => t.name)).toContain("transfer_to_human");
  });
  it("web: the concierge turn route's shape (route.ts:430-450): web, no caller number, no booking, 30-minute slots, in person (mutation: medium phone -> FAILS)", () => {
    const item = parseCorpusItem("10-es-choque.md",
      ITEM.replace("medium: phone", "medium: web").replace("transfer: true", "transfer: false"));
    expect(promptInputFor(item, FIXTURE, "events")).toEqual({
      personaName: "Sofía", businessName: "Agencia de Seguros Río", facts: FIXTURE.facts, services: FIXTURE.services,
      languages: "both", bookingEnabled: false, timezone: "America/Chicago", slotDurationMinutes: 30,
      afterHours: "hours_then_message", callerNumber: null, meetingType: "in_person", medium: "web",
      disclosed: false, tradeModule: "events",
    });
    const tools = toolsFor(item, promptInputFor(item, FIXTURE, "events"));
    expect(tools).toEqual([{ name: "capture_lead", schema: CAPTURE_LEAD_TOOL }]);
  });
  it("disclosure: true plays an account whose disclosure is On: disclosed reaches the prompt input (M15; mutation: disclosed: false always -> FAILS)", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM.replace("booking: false", "booking: false\ndisclosure: true"));
    expect(item.disclosure).toBe(true);
    expect(promptInputFor(item, FIXTURE, "insurance_pc")).toMatchObject({ disclosed: true });
  });
});

describe("stubToolResult: every tool answers ok, and check_availability answers in the live tool's own shape", () => {
  it("capture_lead, take_message, transfer_to_human, an unknown tool -> { ok: true }", () => {
    for (const name of ["capture_lead", "take_message", "transfer_to_human", "nope"]) expect(stubToolResult(name, {})).toEqual({ ok: true });
  });
  it("check_availability returns { slots } and nothing else, as registry.ts:297 does (M5; mutation: add ok: true -> FAILS)", () => {
    expect(stubToolResult("check_availability", { date: "2027-06-08" })).toEqual({
      slots: [
        { startsAt: "2027-06-08T16:00:00.000Z", local: "2027-06-08 at 11:00 AM" },
        { startsAt: "2027-06-08T20:00:00.000Z", local: "2027-06-08 at 3:00 PM" },
      ],
    });
  });
});

describe("the sheet and the transcript are bound to the exact words", () => {
  const meta = { moduleId: "events" as const, slug: "events", version: 1, sha256: "a".repeat(64), date: "2026-10-22",
    phoneEngine: "realtime" as const, phoneModel: "gpt-realtime", chatModel: "gpt-4o-mini" };
  it("both print 'Text SHA-256: <hex>' on its own line (corpus.test.ts reads that line)", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM);
    expect(renderTranscript(item, meta, [{ role: "caller", text: "Hola" }])).toMatch(/^Text SHA-256: a{64}$/m);
    expect(resultsSheetSkeleton(meta, [item])).toMatch(/^Text SHA-256: a{64}$/m);
  });
  it("the sheet lists every rule of every item as its own row", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM);
    const sheet = resultsSheetSkeleton(meta, [item]);
    expect(sheet).toContain("| 10-es-choque.md | MUST | Asks whether anyone is hurt before anything else. |  |  |");
    expect(sheet).toContain("| 10-es-choque.md | MUST NOT | Says the claim is covered or opened. |  |  |");
  });
});

describe("the slugs, the engine, and what the script may touch", () => {
  it("slugs map to the two modules and back", () => {
    expect(CORPUS_SLUGS).toEqual({ insurance_pc: "insurance-pc", events: "events" });
    expect(moduleForSlug("insurance-pc")).toBe("insurance_pc");
    expect(moduleForSlug("insurance_pc")).toBeNull();
  });
  it("the phone engine is the Task 0 spike's answer, and the fallback is gpt-4o (spec section 7)", () => {
    expect(["realtime", "chat"]).toContain(DEFAULT_PHONE_ENGINE);
    expect(PHONE_FALLBACK_MODEL).toBe("gpt-4o");
  });
  it("scripts/sofia-corpus.ts imports no database value, reads no .env, and calls refuseProduction(process.env, …) exactly once (comments stripped first; mutation: comment the call out -> FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../../scripts/sofia-corpus.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // `process.env` is allowed (the key and the guard read it); a FILE named .env is not.
    expect(src).not.toMatch(/@bis\/db|serviceDb|dotenv|\.env\.local|["'`][^"'`]*\/\.env["'`]|["'`]\.env["'`]/);
    expect(src.match(/refuseProduction\(\s*process\.env\s*,/g)?.length).toBe(1);
    expect(src).toMatch(/process\.env\.OPENAI_API_KEY/);
  });
  it("refuseProduction is the FIRST statement after the imports: nothing runs before the guard (M17; mutation: move it below the arg parsing -> FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../../scripts/sofia-corpus.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const at = src.indexOf(`refuseProduction(process.env, "sofia:corpus");`);
    expect(at).toBeGreaterThan(0);
    // Everything before the guard must be import declarations and nothing else.
    expect(src.slice(0, at).replace(/import\s+[\s\S]*?\s+from\s+["'][^"']+["'];/g, "").trim()).toBe("");
  });
  it("redact strips an sk- key from any text it prints (M3; mutation: return the text unchanged -> FAILS)", () => {
    expect(redact("bad key sk-proj-AbC_123-xyz* rejected")).toBe("bad key sk-[redacted] rejected");
    expect(redact("no key here")).toBe("no key here");
  });
});
