import { describe, it, expect } from "vitest";
import {
  isPlaceholderValue, isPlaceholderName, isFillerBestTime, stripPlaceholderSegments, nameTakenFromEmail,
  sanitizeLeadFields, capturePhoneLead, messageBody, bookingName, sanitizeWebLead, droppedNote, withDroppedNote,
} from "./placeholders";

// S-47b v3 (corpus run 2): placeholder values never get stored, on every account. Each table row is one pattern;
// deleting that pattern from placeholders.ts fails its row BY NAME (the mutation table in the task report).

/** Every "no value" placeholder, in any field, any case, with or without accents or a trailing period. */
const GENERIC_STRIP = [
  "not specified", "Not Specified.", "unspecified", "Unknown", "N/A", "n/a", "None", "not given",
  "No se indicó", "no se indico", "NO SE INDICÓ.", "No especificado", "no especificada", "Sin especificar",
  "Desconocido", "desconocida",
];
/** Only as a NAME. */
const NAME_ONLY_STRIP = ["User", "Guest", "guest", "Customer", "Cliente", "Caller"];
/** Real values that merely contain a placeholder word. */
const NAME_KEEP = ["Guest House LLC", "Usera", "Nonestop Plumbing", "Ana Ruiz", "Users", "Callery Ortiz", "Cliente Hernández", "Unknown Mortal Orchestra"];
const BEST_TIME_FILLER = ["any time", "Anytime", "anytime.", "cualquier hora", "A cualquier hora"];
const BEST_TIME_KEEP = ["anytime after 3pm", "any time before noon", "cualquier hora después de las 3", "mornings", "en la mañana"];

describe("isPlaceholderValue: a whole value that says nothing was given", () => {
  it.each(GENERIC_STRIP)("strips %j", (v) => { expect(isPlaceholderValue(v)).toBe(true); });
  it.each([...NAME_KEEP, ...BEST_TIME_FILLER, "Guest", "User", "no", "nonetheless", "unknown caller ID, call 956-555-0100"])(
    "keeps %j (not a generic placeholder)", (v) => { expect(isPlaceholderValue(v)).toBe(false); });
});

describe("isPlaceholderName: a stand-in instead of a name", () => {
  it.each([...GENERIC_STRIP, ...NAME_ONLY_STRIP])("strips %j", (v) => { expect(isPlaceholderName(v)).toBe(true); });
  it.each(NAME_KEEP)("keeps %j", (v) => { expect(isPlaceholderName(v)).toBe(false); });
});

describe("isFillerBestTime: 'any time' ONLY as a filler best time", () => {
  it.each(BEST_TIME_FILLER)("strips %j", (v) => { expect(isFillerBestTime(v)).toBe(true); });
  it.each(BEST_TIME_KEEP)("keeps %j", (v) => { expect(isFillerBestTime(v)).toBe(false); });
});

describe("stripPlaceholderSegments: drops the placeholder part of a one-line need, never the line", () => {
  const STRIP: Array<[string, string, string[]]> = [
    // Run 2's own lines (insurance 02, 15; events 11, 25).
    ["Quote: auto. Best time: no se indicó.", "Quote: auto.", ["Best time: no se indicó."]],
    ["Quote: auto. Best time: not specified.", "Quote: auto.", ["Best time: not specified."]],
    ["Event: quinceañera. Date: not specified, in April. Guests: not specified.", "Event: quinceañera. Date: in April.", ["Date: not specified", "Guests: not specified."]],
    ["Event: quinceañera. Date: sábado 9 de mayo. Guests: no se indicó.", "Event: quinceañera. Date: sábado 9 de mayo.", ["Guests: no se indicó."]],
    // The filler best time, EN and ES.
    ["Quote: renters. Best time: any time.", "Quote: renters.", ["Best time: any time."]],
    ["Cotización: casa. Mejor hora: cualquier hora.", "Cotización: casa.", ["Mejor hora: cualquier hora."]],
    // A middle segment, a comma-separated segment, a Spanish label.
    ["Quote: home. Current: unknown. Best time: mornings.", "Quote: home. Best time: mornings.", ["Current: unknown."]],
    ["Event: boda, Guests: unknown", "Event: boda", ["Guests: unknown"]],
    ["Evento: boda. Invitados: desconocido. Fecha: 14 de marzo.", "Evento: boda. Fecha: 14 de marzo.", ["Invitados: desconocido."]],
    ["Urgent: crash on 10th St. Name: N/A.", "Urgent: crash on 10th St.", ["Name: N/A."]],
  ];
  it.each(STRIP)("%j -> %j", (input, out, dropped) => {
    const r = stripPlaceholderSegments(input);
    expect(r.text).toBe(out);
    expect(r.dropped).toEqual(dropped);
  });
  const KEEP = [
    "Quote: auto. Best time: anytime after 3pm.",
    "Gold: $5,800 for up to 200 guests.",
    "Quote: auto. Best time: 3:30 PM.",
    "Quote: auto + home. Current: Unknown Mutual, renews March. Best time: mornings.",
    "Event: boda. Invitados: 150.",
    "Cliente quiere agregar un auto Toyota Corolla 2021 a su póliza y cancelar otro.",
    "Quote: auto. Notes: any time.",
    "Event: quinceañera. Date: Saturday March 14, or March 21. Guests: about 150.",
    "Quote: auto. He said unknown, then remembered.",
  ];
  it.each(KEEP)("keeps %j unchanged", (input) => {
    expect(stripPlaceholderSegments(input)).toEqual({ text: input, dropped: [] });
  });
  it("a whole line that is only a placeholder becomes empty", () => {
    expect(stripPlaceholderSegments("No especificado")).toEqual({ text: "", dropped: ["No especificado"] });
    expect(stripPlaceholderSegments("Best time: not specified.")).toEqual({ text: "", dropped: ["Best time: not specified."] });
  });
});

describe("nameTakenFromEmail: a name that only appears in their email address", () => {
  const T: Array<[string, string, string, string[], boolean]> = [
    ["run 2 insurance 04: never said, only in the address", "Juan", "juan.p@example.com", ["Hola, ¿más o menos cuánto cuesta asegurar mi casa?", "Mi correo es juan.p@example.com"], true],
    ["said as their name", "Juan", "juan.p@example.com", ["Soy Juan", "juan.p@example.com"], false],
    ["both words from the address, neither said", "Juan Pérez", "juan.perez@example.com", ["mi correo es juan.perez@example.com"], true],
    ["one word said", "Juan Pérez", "juan.perez@example.com", ["me llamo Juan", "juan.perez@example.com"], false],
    ["not from the address at all", "Ana", "juan.p@example.com", ["juan.p@example.com"], false],
    ["accent- and case-insensitive on both sides", "JOSÉ", "Jose_R@example.com", ["write to Jose_R@example.com"], true],
    ["said with its accent", "Jose", "jose.r@example.com", ["me llamo José", "jose.r@example.com"], false],
    ["no email", "Juan", "", ["hola"], false],
    ["a word inside a longer word is not saying it", "Ana", "ana.g@example.com", ["I live on Anaya Street", "ana.g@example.com"], true],
  ];
  it.each(T)("%s", (_n, fullName, email, said, want) => {
    expect(nameTakenFromEmail(fullName, email, said)).toBe(want);
  });
});

describe("droppedNote: what the model hears about a dropped value", () => {
  it("names each value and why, whole (mutation: drop the 'ask them' clause -> FAILS)", () => {
    expect(droppedNote([
      { field: "fullName", value: "User", why: "placeholder" },
      { field: "need", value: "Best time: any time.", why: "filler" },
      { field: "fullName", value: "Juan", why: "email_name" },
    ], "web")).toBe(
      `Left out of the record, because a record holds only what they said: fullName "User" (a placeholder, not something they said); need "Best time: any time." (a filler, not a time they gave); fullName "Juan" (taken from their email address; they never said it). If you need any of it, ask them; never fill it in yourself.`,
    );
  });
  it("on the phone, a dropped name adds the take_message path (the module's own no-name path)", () => {
    expect(droppedNote([{ field: "fullName", value: "Guest", why: "placeholder" }], "phone")).toBe(
      `Left out of the record, because a record holds only what they said: fullName "Guest" (a placeholder, not something they said). If you need any of it, ask them; never fill it in yourself. If they will not give their name, use take_message instead.`,
    );
  });
  it("nothing dropped: no note, and withDroppedNote leaves the result byte-identical", () => {
    expect(droppedNote([], "phone")).toBeUndefined();
    expect(withDroppedNote({ ok: true }, [], "phone")).toEqual({ ok: true });
    expect(withDroppedNote({ ok: true }, [{ field: "need", value: "N/A", why: "placeholder" }], "phone"))
      .toEqual({ ok: true, note: droppedNote([{ field: "need", value: "N/A", why: "placeholder" }], "phone") });
  });
});

describe("every best-time label and key, EN and ES (one row per label, so deleting one fails its row)", () => {
  it.each(["Best time", "Best time to call", "Best time to reach", "Mejor hora", "Mejor horario", "Mejor momento"])(
    "a %s segment with a filler time is dropped", (label) => {
      expect(stripPlaceholderSegments(`Quote: auto. ${label}: any time.`)).toEqual({ text: "Quote: auto.", dropped: [`${label}: any time.`] });
    });
  it.each(["bestTime", "best_time_to_call", "bestTimeToReach", "mejorHora", "mejor_horario", "mejorMomento"])(
    "a %s field with a filler time is dropped", (key) => {
      expect(sanitizeLeadFields({ fullName: "Ana", need: "x", [key]: "cualquier hora" }).dropped).toEqual([{ field: key, value: "cualquier hora", why: "filler" }]);
    });
  it("'any time' under any other label is kept (only a best time can be a filler)", () => {
    expect(stripPlaceholderSegments("Quote: auto. Hora: any time.").dropped).toEqual([]);
  });
});

describe("every name key (one row per key)", () => {
  it.each(["fullName", "name", "firstName", "lastName"])("a stand-in in %s is dropped as a placeholder name", (key) => {
    expect(sanitizeLeadFields({ [key]: "Guest", need: "x" }).dropped).toEqual([{ field: key, value: "Guest", why: "placeholder" }]);
  });
  it("a stand-in in any other field is kept ('Customer' as a need is not a name)", () => {
    expect(sanitizeLeadFields({ fullName: "Ana", need: "Customer" }).dropped).toEqual([]);
  });
});

describe("sanitizeLeadFields: the phone capture_lead fields", () => {
  it("drops a placeholder name, contact or need, keeps real ones (mutation: skip the name check -> FAILS)", () => {
    const r = sanitizeLeadFields({ fullName: "User", callbackNumber: "unknown", email: "n/a", need: "Quote: auto. Best time: no se indicó." });
    expect(r.fields).toEqual({ need: "Quote: auto." });
    expect(r.dropped).toEqual([
      { field: "fullName", value: "User", why: "placeholder" },
      { field: "callbackNumber", value: "unknown", why: "placeholder" },
      { field: "email", value: "n/a", why: "placeholder" },
      { field: "need", value: "Best time: no se indicó.", why: "placeholder" },
    ]);
  });
  it("a filler best time in its own field is dropped; a real one and any other field's 'any time' are kept", () => {
    expect(sanitizeLeadFields({ fullName: "Ana", need: "Quote: home.", bestTime: "any time" }))
      .toEqual({ fields: { fullName: "Ana", need: "Quote: home." }, dropped: [{ field: "bestTime", value: "any time", why: "filler" }] });
    expect(sanitizeLeadFields({ fullName: "Ana", need: "Quote: home.", best_time: "anytime after 3pm", notes: "any time" }).dropped).toEqual([]);
    expect(sanitizeLeadFields({ fullName: "Ana", need: "Best time: any time." }).dropped).toEqual([{ field: "need", value: "Best time: any time.", why: "filler" }]);
  });
  it("keeps every real value untouched", () => {
    const fields = { fullName: "Guest House LLC", need: "Quote: commercial. Best time: anytime after 3pm.", callbackNumber: "956-555-0123" };
    expect(sanitizeLeadFields(fields)).toEqual({ fields, dropped: [] });
  });
});

describe("capturePhoneLead: the whole phone capture_lead answer, shared by registry.ts and the corpus stub", () => {
  it("records a clean lead with the caller ID as callbackNumber, answer {ok:true} exactly", () => {
    expect(capturePhoneLead({ fullName: " Ana ", need: "roof quote" }, "+19565550142"))
      .toEqual({ fields: { fullName: "Ana", need: "roof quote", callbackNumber: "+19565550142" }, result: { ok: true } });
  });
  it("a placeholder name is absent: refused as missing fullName, with the note (mutation: keep the placeholder name -> FAILS)", () => {
    const r = capturePhoneLead({ fullName: "Caller", need: "Quote: auto." }, null);
    expect(r.result).toEqual({ ok: false, missing: ["fullName"], note: droppedNote([{ field: "fullName", value: "Caller", why: "placeholder" }], "phone") });
  });
  it("a placeholder part of the need is stripped and the lead is still recorded, with the note", () => {
    const r = capturePhoneLead({ fullName: "Ana", need: "Quote: auto. Best time: not specified." }, null);
    expect(r.fields).toEqual({ fullName: "Ana", need: "Quote: auto." });
    expect(r.result).toEqual({ ok: true, note: droppedNote([{ field: "need", value: "Best time: not specified.", why: "placeholder" }], "phone") });
  });
  it("a placeholder callbackNumber falls back to the caller ID", () => {
    expect(capturePhoneLead({ fullName: "Ana", need: "x", callbackNumber: "N/A" }, "+19565550142").fields.callbackNumber).toBe("+19565550142");
  });
  it("tolerates no fields at all", () => {
    expect(capturePhoneLead(undefined, null).result).toEqual({ ok: false, missing: ["fullName", "need"] });
  });
});

describe("messageBody and bookingName (take_message, book_appointment)", () => {
  it("strips placeholder parts of a message body; a body that is only a placeholder is empty", () => {
    expect(messageBody("Urgent: crash on 10th St. Name: unknown.")).toEqual({ body: "Urgent: crash on 10th St.", dropped: [{ field: "body", value: "Name: unknown.", why: "placeholder" }] });
    expect(messageBody("No se indicó")).toEqual({ body: "", dropped: [{ field: "body", value: "No se indicó", why: "placeholder" }] });
    expect(messageBody("  call me back ")).toEqual({ body: "call me back", dropped: [] });
  });
  it("a placeholder booking name is no name; a real one is kept", () => {
    expect(bookingName("Guest")).toEqual({ name: "", dropped: [{ field: "name", value: "Guest", why: "placeholder" }] });
    expect(bookingName(" Guest House LLC ")).toEqual({ name: "Guest House LLC", dropped: [] });
  });
});

describe("sanitizeWebLead: the website chat's capture_lead", () => {
  const said = ["I want a quote for my car", "I'm Diana, diana@example.com"];
  it("a placeholder name: no lead (the route's 'unusable' path), with what was dropped", () => {
    expect(sanitizeWebLead({ fullName: "User", email: "", phone: "", need: "Urgent: flooding." }, said))
      .toEqual({ lead: null, dropped: [{ field: "fullName", value: "User", why: "placeholder" }] });
  });
  it("a name taken from the email address: no lead (mutation: skip the email check -> FAILS)", () => {
    expect(sanitizeWebLead({ fullName: "Juan", email: "juan.p@example.com", phone: "", need: "Quote: home." }, ["¿Cuánto cuesta?", "juan.p@example.com"]))
      .toEqual({ lead: null, dropped: [{ field: "fullName", value: "Juan", why: "email_name" }] });
  });
  it("strips the need's placeholder parts and a placeholder phone or email, keeps the rest", () => {
    expect(sanitizeWebLead({ fullName: "Diana", email: "diana@example.com", phone: "none", need: "Quote: auto. Best time: any time." }, said))
      .toEqual({
        lead: { fullName: "Diana", email: "diana@example.com", phone: "", need: "Quote: auto." },
        dropped: [{ field: "phone", value: "none", why: "placeholder" }, { field: "need", value: "Best time: any time.", why: "filler" }],
      });
  });
  it("a clean lead passes through unchanged", () => {
    const lead = { fullName: "Diana", email: "diana@example.com", phone: "", need: "Quote: auto." };
    expect(sanitizeWebLead(lead, said)).toEqual({ lead, dropped: [] });
  });
});
