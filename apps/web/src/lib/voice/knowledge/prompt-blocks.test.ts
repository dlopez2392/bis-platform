// S-47c (spec 5.2, 5.2.1, 5.4; plan SD5-SD8, C20): every exported line of prompt-blocks.ts as a typed-out literal.
// Model input: a changed word here is a changed instruction on a live phone line.
import { describe, it, expect } from "vitest";
import {
  BUSINESS_HOURS_HEADING, SERVICES_AND_PRICES_HEADING, SERVICES_NAMES_ONLY_HEADING,
  LIST_PRICE_LINE, CLOSED_PRICE_LINE, AFTER_HOURS_CLOSED_WEB, AFTER_HOURS_CLOSED_WEB_VOICE,
  afterHoursClosedPhoneLine, transferToolLineClosed, businessHoursBlock, servicesBlock,
} from "./prompt-blocks";
import type { RenderedService } from "./payload";

describe("prompt-blocks — the fixed lines, word for word", () => {
  it("the three headings", () => {
    expect(BUSINESS_HOURS_HEADING).toBe("BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a closure written above for a specific date):");
    expect(SERVICES_AND_PRICES_HEADING).toBe("SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it is written here, in the language you are speaking):");
    expect(SERVICES_NAMES_ONLY_HEADING).toBe("SERVICES (what the business offers):");
  });
  it("the list's HARD LIMITS price line", () => {
    expect(LIST_PRICE_LINE).toBe("- Give a price only by saying, word for word, that service's sentence from SERVICES AND PRICES above. Any other amount written above, in the facts or the services, is not a price you may give. Never multiply, add up, estimate or round a price, never work out a total, and never quote a service that is not on the list: say the business will confirm pricing and offer to take their details. Wherever a rule below speaks of prices \"in the facts\", it means this list.");
  });
  it("the CLOSED price line, with its overriding last sentence (C20)", () => {
    expect(CLOSED_PRICE_LINE).toBe("- Do not give, confirm or estimate any price, rate or amount right now, not even one written above. If asked, say the business will confirm pricing and offer to take their details. This overrides any rule below that allows a price from the facts.");
  });
  it("the web chat's and the voice demo's closed AFTER HOURS lines (SD6)", () => {
    expect(AFTER_HOURS_CLOSED_WEB).toBe("AFTER HOURS — The business is closed right now (see Right now above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.");
    expect(AFTER_HOURS_CLOSED_WEB_VOICE).toBe("AFTER HOURS — The business is closed right now (see Right now above); say so briefly and take a message; do not attempt anything else.");
  });
});

describe("afterHoursClosedPhoneLine — all 8 combinations (spec 5.2; SD5)", () => {
  const HEAD = "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above";
  const MID = ". For anything that needs someone on the team, take a message and say the team will call them back once it opens.";
  const BOOK = ", and book a time that check_availability returns";
  const ASK = " If they ask for a person, you can still put them through.";
  const URGENT = " If they ask for a person, or it is urgent, you can still put them through.";
  const ROWS: Array<[canBook: boolean, handoffAvailable: boolean, hasTradeRules: boolean, want: string]> = [
    [false, false, false, `${HEAD}${MID}`],
    [false, false, true, `${HEAD}${MID}`],
    [false, true, false, `${HEAD}${MID}${ASK}`],
    [false, true, true, `${HEAD}${MID}${URGENT}`],
    [true, false, false, `${HEAD}${BOOK}${MID}`],
    [true, false, true, `${HEAD}${BOOK}${MID}`],
    [true, true, false, `${HEAD}${BOOK}${MID}${ASK}`],
    [true, true, true, `${HEAD}${BOOK}${MID}${URGENT}`],
  ];
  it("every row (mutation: drop the hasTradeRules branch of the person clause -> the SD5 rows FAIL)", () => {
    let seen = 0;
    for (const [canBook, handoffAvailable, hasTradeRules, want] of ROWS) {
      expect(afterHoursClosedPhoneLine({ canBook, handoffAvailable, hasTradeRules }), JSON.stringify({ canBook, handoffAvailable, hasTradeRules })).toBe(want);
      seen += 1;
    }
    expect(seen).toBe(8);
  });
  it("two rows typed out whole, so the composed pieces above cannot hide a typo", () => {
    expect(afterHoursClosedPhoneLine({ canBook: true, handoffAvailable: true, hasTradeRules: true })).toBe(
      "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above, and book a time that check_availability returns. For anything that needs someone on the team, take a message and say the team will call them back once it opens. If they ask for a person, or it is urgent, you can still put them through.");
    expect(afterHoursClosedPhoneLine({ canBook: false, handoffAvailable: true, hasTradeRules: false })).toBe(
      "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need, say so and say when it opens. You can still answer questions from what you know above. For anything that needs someone on the team, take a message and say the team will call them back once it opens. If they ask for a person, you can still put them through.");
  });
});

describe("transferToolLineClosed (spec 5.2.1 point 2)", () => {
  it("with a trade module it names the URGENT path; without, only a caller who asks", () => {
    expect(transferToolLineClosed(true)).toBe("- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person, or when they accept the offer on the URGENT path in the trade rules above. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.");
    expect(transferToolLineClosed(false)).toBe("- transfer_to_human() — the business is closed right now, so do not offer this. Call it only when the caller asks to speak to a person. Do not ask them to hold first; that line is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and take a message instead.");
  });
});

describe("businessHoursBlock", () => {
  // 2027-06-01T15:00:00Z = Tuesday 10:00 AM in America/Chicago.
  const now = new Date("2027-06-01T15:00:00Z");
  it("open: a blank line, the heading, seven days Monday first, the Right now line", () => {
    expect(businessHoursBlock({ tue: [["08:00", "18:00"]] }, "America/Chicago", now)).toEqual({
      open: true,
      lines: [
        "",
        "BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a closure written above for a specific date):",
        "Monday: closed", "Tuesday: 8:00 AM to 6:00 PM", "Wednesday: closed", "Thursday: closed", "Friday: closed", "Saturday: closed", "Sunday: closed",
        "Right now: open until 6:00 PM.",
      ],
    });
  });
  it("closed: open is false and the Right now line says when it opens", () => {
    const b = businessHoursBlock({ tue: [["13:00", "18:00"]] }, "America/Chicago", now);
    expect(b.open).toBe(false);
    expect(b.lines.at(-1)).toBe("Right now: closed; opens today at 1:00 PM.");
  });
});

describe("servicesBlock (spec 5.2; SD7, SD8)", () => {
  const LIST: RenderedService[] = [
    {
      name_en: "Haircut", name_es: "Corte de cabello", description_en: "Wash and cut.", description_es: "Lavado y corte.",
      sentence_en: "The price for Haircut is $25.", sentence_es: "El precio de Corte de cabello es $25.",
    },
    {
      name_en: "Beard trim", name_es: null, description_en: null, description_es: null,
      sentence_en: "The price for Beard trim starts at $10.", sentence_es: "El precio de Beard trim es desde $10.",
    },
  ];
  it("an empty list gives no lines at all, on either setting", () => {
    expect(servicesBlock([], false)).toEqual([]);
    expect(servicesBlock([], true)).toEqual([]);
  });
  it("with prices: both sentences on every item, each description that exists on its own line", () => {
    expect(servicesBlock(LIST, false)).toEqual([
      "",
      "SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it is written here, in the language you are speaking):",
      `- Haircut — English: "The price for Haircut is $25." Spanish: "El precio de Corte de cabello es $25."`,
      "  About it, in English: Wash and cut.",
      "  About it, in Spanish: Lavado y corte.",
      `- Beard trim — English: "The price for Beard trim starts at $10." Spanish: "El precio de Beard trim es desde $10."`,
    ]);
  });
  it("insurance (namesOnly): names and descriptions, no sentence and no amount (C13; mutation: print sentence_en on insurance -> FAILS)", () => {
    const lines = servicesBlock(LIST, true);
    expect(lines).toEqual([
      "",
      "SERVICES (what the business offers):",
      "- Haircut (in Spanish: Corte de cabello)",
      "  About it, in English: Wash and cut.",
      "  About it, in Spanish: Lavado y corte.",
      "- Beard trim",
    ]);
    for (const s of ["$", "The price for", "El precio de", "SERVICES AND PRICES"]) expect(lines.join("\n")).not.toContain(s);
  });
});
