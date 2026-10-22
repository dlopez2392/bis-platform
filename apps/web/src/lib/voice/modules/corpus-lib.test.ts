import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseCorpusItem, parseFixture, promptInputFor, toolsFor, stubToolResult, renderTranscript,
  resultsSheetSkeleton, moduleForSlug, redact, routeRealtimeError, strayErrorTurn, CorpusItemFailed,
  selectCorpusFiles, handlerFailureReason, parseRepeat, runFileName,
  CORPUS_SLUGS, DEFAULT_PHONE_ENGINE, PHONE_FALLBACK_MODEL,
  type CorpusFixture,
} from "./corpus-lib";
import { CAPTURE_LEAD_TOOL, parseCaptureLead } from "../../concierge/prompt";
import { leadHasContact } from "../../concierge/lead";
import { capturePhoneLead, droppedNote } from "../tools/placeholders";

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
      callerId: "shown", afterHours: null, facts: "agencia-de-seguros-rio",
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
    // Final-fix item 10: the two override keys refuse any value but their own.
    ["a callerId value that is not shown or withheld", ITEM.replace("booking: false", "booking: false\ncallerId: hidden"), /callerId/],
    ["an afterHours value that is not a live after-hours mode", ITEM.replace("booking: false", "booking: false\nafterHours: never"), /afterHours/],
    // Transfer false, so ONLY the callerId refusal can throw: the chat has no caller ID to withhold.
    ["a withheld caller ID on a web item",
      ITEM.replace("medium: phone", "medium: web").replace("transfer: true", "transfer: false").replace("booking: false", "booking: false\ncallerId: withheld"),
      /callerId/],
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
  it("callerId: withheld plays a call with no caller ID: callerNumber is null on the phone (mutation: ignore callerId -> FAILS)", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM.replace("booking: false", "booking: false\ncallerId: withheld"));
    expect(item.callerId).toBe("withheld");
    expect(promptInputFor(item, FIXTURE, "insurance_pc").callerNumber).toBeNull();
    // and without the key the fixture's number is the caller ID, as before
    expect(promptInputFor(parseCorpusItem("10-es-choque.md", ITEM), FIXTURE, "insurance_pc").callerNumber).toBe("+19565550142");
  });
  it("afterHours: message_only overrides the fixture's mode, so a booking item loses book_appointment but keeps check_availability (mutation: always the fixture's afterHours -> FAILS)", () => {
    const booking = ITEM.replace("transfer: true", "transfer: false").replace("booking: false", "booking: true");
    const full = parseCorpusItem("10-es-choque.md", booking);
    const msgOnly = parseCorpusItem("10-es-choque.md", booking.replace("booking: true", "booking: true\nafterHours: message_only"));
    expect(msgOnly.afterHours).toBe("message_only");
    expect(promptInputFor(msgOnly, FIXTURE, "events").afterHours).toBe("message_only");
    expect(promptInputFor(full, FIXTURE, "events").afterHours).toBe("hours_then_message");
    const names = (i: typeof full) => toolsFor(i, promptInputFor(i, FIXTURE, "events")).map((t) => t.name);
    expect(names(full)).toContain("book_appointment");
    expect(names(msgOnly)).not.toContain("book_appointment");
    expect(names(msgOnly)).toContain("check_availability");
  });
});

describe("stubToolResult: every tool answers ok, except the live refusals a corpus item can trigger", () => {
  const PHONE = { medium: "phone", timezone: "America/Chicago" } as const;
  const WEB = { medium: "web", timezone: "America/Chicago" } as const;
  /** Typed out from captureResult("needs_contact"), api/concierge/[publicId]/turn/route.ts. */
  const NEEDS_CONTACT = "Not recorded yet: the team needs an email address or a phone number to reach them. Ask the visitor for one, then call capture_lead again with it. If they would rather not give one, nothing is recorded; do not say the team will follow up.";

  it("web capture_lead with a name but neither a phone nor an email -> the live needs-contact refusal, word for word (mutation: always ok -> FAILS)", () => {
    expect(stubToolResult("capture_lead", { fullName: "Ana Ruiz", need: "Quote: auto." }, WEB)).toEqual({ ok: false, error: NEEDS_CONTACT });
    expect(stubToolResult("capture_lead", { fullName: "Ana Ruiz", email: " ", phone: "", need: "Quote: auto." }, WEB))
      .toEqual({ ok: false, error: NEEDS_CONTACT });
  });
  it("the needs-contact literal is still the live route's own (drift guard: edit the route's text -> FAILS)", () => {
    const route = readFileSync(path.resolve(__dirname, "../../../app/api/concierge/[publicId]/turn/route.ts"), "utf8");
    expect(route).toContain(`case "needs_contact":\n      return { ok: false, error: ${JSON.stringify(NEEDS_CONTACT)} };`);
  });
  /** Typed out from captureResult("unusable"): parseCaptureLead returns null with no fullName, and the route files nothing. */
  const UNUSABLE = "Not recorded: their name is missing. Ask for it.";
  it("web capture_lead with no name (blank, or the key missing) -> the live unusable refusal, even with a valid phone (v2; mutation: drop the null-lead branch -> FAILS)", () => {
    expect(stubToolResult("capture_lead", { phone: "956-555-0199", need: "Urgent: flooding." }, WEB)).toEqual({ ok: false, error: UNUSABLE });
    expect(stubToolResult("capture_lead", { fullName: "  ", email: "ana@example.com", need: "Quote: home." }, WEB)).toEqual({ ok: false, error: UNUSABLE });
    // The phone tool takes a free-form `fields` object and is not this refusal's: v3, it answers as registry.ts
    // does (capturePhoneLead), which is a missing-fields refusal, not ok (v2's stub said ok here, unlike live).
    expect(stubToolResult("capture_lead", { fields: { need: "Quote: auto." } }, PHONE)).toEqual({ ok: false, missing: ["fullName"] });
  });
  it("the unusable literal is still the live route's own (drift guard: edit the route's text -> FAILS)", () => {
    const route = readFileSync(path.resolve(__dirname, "../../../app/api/concierge/[publicId]/turn/route.ts"), "utf8");
    expect(route).toContain(`case "unusable":\n      return { ok: false, error: ${JSON.stringify(UNUSABLE)} };`);
  });
  it("the stub's needs-contact decision is the live leadHasContact's, case by case (parity with lib/concierge/lead.ts)", () => {
    const cases = [
      { fullName: "Ana", need: "x" },
      { fullName: "Ana", need: "x", phone: "956-555-0199" },
      { fullName: "Ana", need: "x", email: "ana@example.com" },
      { fullName: "Ana", need: "x", phone: "12" },
      { fullName: "Ana", need: "x", email: "not-an-email" },
    ];
    // v3: the visitor said "Ana", so the name-from-email check (a different refusal) stays out of this parity.
    const SAID = { ...WEB, said: ["I'm Ana"] };
    expect(cases.map((a) => stubToolResult("capture_lead", a, SAID).ok))
      .toEqual(cases.map((a) => leadHasContact(parseCaptureLead(JSON.stringify(a))!)));
    expect(cases.map((a) => stubToolResult("capture_lead", a, SAID).ok)).toEqual([false, true, true, false, false]);
  });
  it("phone take_message with an empty or blank body -> { ok: false, error: \"message body required\" }, as registry.ts does (mutation: always ok -> FAILS)", () => {
    expect(stubToolResult("take_message", {}, PHONE)).toEqual({ ok: false, error: "message body required" });
    expect(stubToolResult("take_message", { body: "   " }, PHONE)).toEqual({ ok: false, error: "message body required" });
  });
  it("everything else answers { ok: true }: a web lead with a phone, a phone lead with no phone (the phone fills it from the caller ID), a message with a body, a transfer, an unknown tool", () => {
    expect(stubToolResult("capture_lead", { fullName: "Ana Ruiz", phone: "956-555-0199", need: "Quote" }, WEB)).toEqual({ ok: true });
    expect(stubToolResult("capture_lead", { fields: { fullName: "Ana Ruiz", need: "Quote" } }, PHONE)).toEqual({ ok: true });
    expect(stubToolResult("take_message", { body: "Call me about my policy" }, PHONE)).toEqual({ ok: true });
    expect(stubToolResult("transfer_to_human", {}, PHONE)).toEqual({ ok: true });
    expect(stubToolResult("nope", {}, PHONE)).toEqual({ ok: true });
  });
  it("check_availability returns { slots } and nothing else, each local rendered by formatWhen in the fixture's zone (M5; mutations: add ok: true -> FAILS; render in UTC -> FAILS)", () => {
    const chicago = stubToolResult("check_availability", { date: "2027-06-08" }, PHONE) as { slots: Array<{ startsAt: string; local: string }> };
    expect(Object.keys(chicago)).toEqual(["slots"]);
    expect(chicago.slots.map((s) => s.startsAt)).toEqual(["2027-06-08T16:00:00.000Z", "2027-06-08T20:00:00.000Z"]);
    // ICU writes a narrow no-break space before AM/PM, hence \s.
    expect(chicago.slots[0]!.local).toMatch(/^Tue, Jun 8, 11:00\sAM CDT$/);
    expect(chicago.slots[1]!.local).toMatch(/^Tue, Jun 8, 3:00\sPM CDT$/);
    const la = stubToolResult("check_availability", { date: "2027-06-08" }, { medium: "phone", timezone: "America/Los_Angeles" }) as typeof chicago;
    expect(la.slots[0]!.local).toMatch(/^Tue, Jun 8, 9:00\sAM PDT$/);
  });
  // S-47b v3 (A3): the stub runs the SAME sanitizer the live tools run (tools/placeholders.ts), so a transcript
  // shows what a real call or chat would have stored and heard.
  describe("v3: placeholders, through the live sanitizer", () => {
    const CASES: Array<[string, Record<string, unknown>]> = [
      ["clean", { fullName: "Ana Ruiz", need: "Quote: auto." }],
      ["placeholder name", { fullName: "User", need: "Urgent: flooding." }],
      ["placeholder need part", { fullName: "Ana", need: "Quote: auto. Best time: no se indicó." }],
      ["filler best time", { fullName: "Ana", need: "Quote: renters.", bestTime: "any time" }],
      ["no name", { need: "Quote: auto." }],
    ];
    it.each(CASES)("phone capture_lead (%s) answers exactly what registry.ts answers (mutation: stub returns ok -> FAILS)", (_n, fields) => {
      expect(stubToolResult("capture_lead", { fields }, PHONE)).toEqual(capturePhoneLead(fields, "+19565550142").result);
    });
    it("phone capture_lead with a placeholder name: missing fullName, and the note naming it", () => {
      expect(stubToolResult("capture_lead", { fields: { fullName: "Guest", need: "Event: boda." } }, PHONE)).toEqual({
        ok: false, missing: ["fullName"],
        note: `Left out of the record, because a record holds only what they said: fullName "Guest" (a placeholder, not something they said). If you need any of it, ask them; never fill it in yourself. If they will not give their name, use take_message instead.`,
      });
    });
    it("phone take_message: a placeholder part is stripped (ok, with the note); a placeholder-only body is refused", () => {
      expect(stubToolResult("take_message", { body: "Urgent: crash. Name: unknown." }, PHONE)).toEqual({ ok: true, note: droppedNote([{ field: "body", value: "Name: unknown.", why: "placeholder" }], "phone") });
      expect(stubToolResult("take_message", { body: "N/A" }, PHONE)).toEqual({ ok: false, error: "message body required", note: droppedNote([{ field: "body", value: "N/A", why: "placeholder" }], "phone") });
    });
    it("phone book_appointment: a placeholder name is refused as registry.ts refuses it; a real one is ok", () => {
      expect(stubToolResult("book_appointment", { startsAt: "2027-06-08T16:00:00.000Z", name: "Guest" }, PHONE))
        .toEqual({ ok: false, error: "name required", note: droppedNote([{ field: "name", value: "Guest", why: "placeholder" }], "phone") });
      expect(stubToolResult("book_appointment", { startsAt: "2027-06-08T16:00:00.000Z", name: "Guest House LLC" }, PHONE)).toEqual({ ok: true });
    });
    it("web capture_lead with a placeholder name -> the unusable refusal plus the note", () => {
      expect(stubToolResult("capture_lead", { fullName: "User", phone: "956-555-0199", need: "Urgent: flooding." }, WEB))
        .toEqual({ ok: false, error: UNUSABLE, note: droppedNote([{ field: "fullName", value: "User", why: "placeholder" }], "web") });
    });
    it("web capture_lead with a name taken from the email address: refused unless the visitor said it (the caller's lines reach the stub; mutation: ignore `said` -> FAILS)", () => {
      const args = { fullName: "Juan", email: "juan.p@example.com", need: "Quote: home." };
      expect(stubToolResult("capture_lead", args, { ...WEB, said: ["¿Cuánto cuesta?", "juan.p@example.com"] }))
        .toEqual({ ok: false, error: UNUSABLE, note: droppedNote([{ field: "fullName", value: "Juan", why: "email_name" }], "web") });
      expect(stubToolResult("capture_lead", args, { ...WEB, said: ["Soy Juan", "juan.p@example.com"] })).toEqual({ ok: true });
    });
    it("web capture_lead with a placeholder need part: ok, with the note", () => {
      expect(stubToolResult("capture_lead", { fullName: "Ana", phone: "956-555-0199", need: "Quote: auto. Best time: any time." }, WEB))
        .toEqual({ ok: true, note: droppedNote([{ field: "need", value: "Best time: any time.", why: "filler" }], "web") });
    });
    it("imports the live sanitizer rather than carrying a copy (mutation: paste a local placeholder list -> FAILS)", () => {
      const src = readFileSync(path.resolve(__dirname, "corpus-lib.ts"), "utf8");
      expect(src).toMatch(/from "\.\.\/tools\/placeholders";/);
      expect(src).not.toMatch(/no se indic|not specified|"guest"/i);
    });
  });

  it("check_availability with a date that is not YYYY-MM-DD -> the live refusal, never a thrown Invalid Date", () => {
    expect(stubToolResult("check_availability", { date: "June 8" }, PHONE)).toEqual({ ok: false, error: "date must be YYYY-MM-DD" });
  });
});

describe("a Realtime error event is never dropped (m1)", () => {
  it.each([
    [{ response: true, session: false }, "response"],
    [{ response: false, session: true }, "session"],
    [{ response: false, session: false }, "stray"],
  ] as const)("pending %j -> %s (mutation: no stray route, the old `waiter ? reject : sessionFailed` -> FAILS)", (pending, route) => {
    expect(routeRealtimeError(pending)).toBe(route);
  });
  it("a stray error becomes a transcript line saying the item failed, and the failure carries the turns so far", () => {
    const turn = strayErrorTurn("server_error");
    expect(turn).toEqual({ role: "tool", text: "realtime error while no response was pending: server_error. This item FAILED." });
    const item = parseCorpusItem("10-es-choque.md", ITEM);
    const meta = { moduleId: "insurance_pc" as const, slug: "insurance-pc", version: 1, sha256: "b".repeat(64), date: "2026-10-22",
      phoneEngine: "realtime" as const, phoneModel: "gpt-realtime", chatModel: "gpt-4o-mini" };
    expect(renderTranscript(item, meta, [{ role: "caller", text: "Hola" }, turn]))
      .toContain("- tool: `realtime error while no response was pending: server_error. This item FAILED.`");
    const failure = new CorpusItemFailed("realtime error: server_error", [turn]);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("realtime error: server_error");
    expect(failure.turns).toEqual([turn]);
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
  it("the transcript's Item line names a withheld caller ID and an after-hours override, so the grader sees them (and says nothing when neither is set)", () => {
    const plain = parseCorpusItem("10-es-choque.md", ITEM);
    const both = parseCorpusItem("10-es-choque.md", ITEM.replace("booking: false", "booking: false\ncallerId: withheld\nafterHours: message_only"));
    expect(renderTranscript(both, meta, [])).toContain(
      "Item: phone, es, transfer true, booking false, facts agencia-de-seguros-rio, caller ID withheld, after hours message_only\n");
    expect(renderTranscript(plain, meta, [])).toContain("Item: phone, es, transfer true, booking false, facts agencia-de-seguros-rio\n");
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
  it("the phone engine is realtime, as Task 0's spike showed on 2026-10-22 (run 39814905846: gpt-realtime takes a text-only session via output_modalities), and the fallback is gpt-4o (spec section 7; mutation: \"chat\" -> FAILS)", () => {
    expect(DEFAULT_PHONE_ENGINE).toBe("realtime");
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

describe("--only that selects nothing is an error, never a green run of zero items", () => {
  const files = ["02-es-b.md", "01-en-a.md", "notes.txt", "26-en-z.md"];
  it("plays every .md in file order without --only", () => {
    expect(selectCorpusFiles(files, null, "events")).toEqual({ files: ["01-en-a.md", "02-es-b.md", "26-en-z.md"], error: null });
  });
  it("keeps the one item --only names", () => {
    expect(selectCorpusFiles(files, "02", "events")).toEqual({ files: ["02-es-b.md"], error: null });
  });
  it("names the number and the module when --only matches no item (mutation: return error null for an empty pick -> FAILS)", () => {
    expect(selectCorpusFiles(files, "27", "events")).toEqual({ files: [], error: "--only 27 selects no item in events" });
  });
  it("the script stops non-zero on that error, before playing anything (mutation: drop the check -> FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../../scripts/sofia-corpus.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/if \(picked\.error\) \{ console\.error\(picked\.error\); process\.exit\(2\); \}/);
  });
});

describe("a throw inside the Realtime message handler fails THAT item, by the error's kind only", () => {
  const SENTINEL = "SENTINEL caller said 555-0142";
  it("names the error's class, never its message (a message can carry transcript text; mutation: append the message -> FAILS)", () => {
    const reason = handlerFailureReason(new RangeError(SENTINEL));
    expect(reason).toBe("local error while handling a Realtime event: RangeError");
    expect(reason).not.toContain("SENTINEL");
  });
  it("answers for something thrown that is not an Error", () => {
    expect(handlerFailureReason(SENTINEL)).toBe("local error while handling a Realtime event: unknown");
    expect(handlerFailureReason({ name: `x ${SENTINEL}` })).toBe("local error while handling a Realtime event: unknown");
  });
  it("stubToolResult's RangeError on an impossible date is exactly such a throw (the reviewer's 2026-13-01)", () => {
    expect(() => stubToolResult("check_availability", { date: "2026-13-01" }, { medium: "phone", timezone: "America/Chicago" })).toThrow(RangeError);
  });
  it("the script's message handler catches every throw and routes it like an error event (mutation: drop the try/catch -> FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../../scripts/sofia-corpus.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/ws\.on\("message", \(raw\) => \{\s*try \{\s*onEvent\(raw\);\s*\} catch \(err\) \{\s*failCurrent\(new Error\(handlerFailureReason\(err\)\), "local error"\);\s*\}\s*\}\);/);
  });
});

// S-47b v3 (C): every item played N times, so a rule that holds once by luck shows up as a split column.
describe("--repeat N plays each item N times (1 to 5, default 1)", () => {
  const SCRIPT = () => readFileSync(path.resolve(__dirname, "../../../../scripts/sofia-corpus.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it.each([[null, 1], ["1", 1], ["3", 3], ["5", 5]] as const)("%j -> %d", (raw, n) => {
    expect(parseRepeat(raw)).toEqual({ repeat: n, error: null });
  });
  it.each(["0", "6", "x", "2.5", "", "03 ", "-1"])("refuses %j, naming it (mutation: clamp instead of refusing -> FAILS)", (raw) => {
    expect(parseRepeat(raw)).toEqual({ repeat: 1, error: `--repeat must be a whole number from 1 to 5, not "${raw}"` });
  });
  it("names each run's transcript NN-…-rK.md; a single run keeps the item's own name (mutation: always -r1 -> FAILS)", () => {
    expect(runFileName("07-en-drop-um.md", 1, 1)).toBe("07-en-drop-um.md");
    expect(runFileName("07-en-drop-um.md", 1, 3)).toBe("07-en-drop-um-r1.md");
    expect(runFileName("07-en-drop-um.md", 3, 3)).toBe("07-en-drop-um-r3.md");
  });
  const meta = { moduleId: "events" as const, slug: "events", version: 3, sha256: "a".repeat(64), date: "2026-10-22",
    phoneEngine: "realtime" as const, phoneModel: "gpt-realtime", chatModel: "gpt-4o-mini" };
  it("the sheet gets one Pass/Fail column per run, and one count line per run (mutation: one column regardless -> FAILS)", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM);
    const sheet = resultsSheetSkeleton(meta, [item], 3);
    expect(sheet).toContain("Runs: 3 per item (columns Run 1 to Run 3; transcripts NN-…-r1.md to -r3.md)\n");
    expect(sheet).toContain("| Item | Kind | Rule | Run 1 | Run 2 | Run 3 | Note |\n|---|---|---|---|---|---|---|\n");
    expect(sheet).toContain("| 10-es-choque.md | MUST | Asks whether anyone is hurt before anything else. |  |  |  |  |\n");
    expect(sheet).toContain("| 10-es-choque.md | MUST NOT | Says the claim is covered or opened. |  |  |  |  |\n");
    for (const r of [1, 2, 3]) expect(sheet).toContain(`Run ${r}: MUST _ of _ pass. MUST NOT _ of _ pass.\n`);
  });
  it("one run: the sheet is byte-for-byte the v2 sheet (mutation: always print a Runs line -> FAILS)", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM);
    expect(resultsSheetSkeleton(meta, [item], 1)).toBe(resultsSheetSkeleton(meta, [item]));
    expect(resultsSheetSkeleton(meta, [item])).not.toContain("Runs:");
    expect(resultsSheetSkeleton(meta, [item])).toContain("| Item | Kind | Rule | Pass/Fail | Note |\n");
  });
  it("each transcript says which run it is when there is more than one", () => {
    const item = parseCorpusItem("10-es-choque.md", ITEM);
    expect(renderTranscript(item, meta, [], { run: 2, of: 3 })).toMatch(/^Run: 2 of 3$/m);
    expect(renderTranscript(item, meta, [], { run: 1, of: 1 })).not.toContain("Run:");
    expect(renderTranscript(item, meta, [])).not.toContain("Run:");
  });
  it("the script reads --repeat through parseRepeat and stops non-zero on its error before playing anything (mutation: drop the check -> FAILS)", () => {
    const src = SCRIPT();
    expect(src).toMatch(/const repeatArg = parseRepeat\(flag\("--repeat"\)\);/);
    expect(src).toMatch(/if \(repeatArg\.error\) \{ console\.error\(repeatArg\.error\); process\.exit\(2\); \}/);
    expect(src.indexOf("if (repeatArg.error)")).toBeLessThan(src.indexOf("mkdirSync(outDir"));
  });
  it("the script plays every run of every item and writes each run's own file (mutation: write item.file -> FAILS)", () => {
    const src = SCRIPT();
    expect(src).toMatch(/for \(let run = 1; run <= repeat; run \+= 1\)/);
    expect(src).toMatch(/runFileName\(item\.file, run, repeat\)/);
    expect(src).toMatch(/resultsSheetSkeleton\(meta, items, repeat\)/);
  });
  it("the script hands the caller's lines so far to the stub (v3 A3: the web name-from-email check; mutation: drop said -> FAILS)", () => {
    const src = SCRIPT();
    expect(src).toMatch(/stubToolResult\(name, a, \{ medium: item\.medium, timezone: f\.timezone, said \}\)/);
    expect(src.match(/stub\((?:String\(ev\.name\)|c\.function\.name), a, callerLines\(turns\)\)/g)?.length).toBe(2);
  });
});
