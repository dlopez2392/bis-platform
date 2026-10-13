import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { formatWhen } from "@/lib/booking/time";
import {
  smsReminderLead, defaultSmsReminderBody, composeSmsReminder, SMS_REMINDER_PREVIEW_INSTANT,
} from "./sms-reminder-copy";

describe("the text reminder in Spanish (spec §11.2, §13)", () => {
  const sat = formatWhen(new Date("2026-10-17T14:30:00Z"), "America/Chicago", "es");
  it("the lead and the default are Spanish, and the Saturday is folded to GSM-7 (mutation: no gsmFoldVowels -> FAILS)", () => {
    expect(smsReminderLead("Rio Roofing", sat, "es")).toBe("Recordatorio: su cita con Rio Roofing es el sab, 17 de oct, 9:30 a.m. CDT.");
    expect(defaultSmsReminderBody("es")).toBe("Si necesita hacer un cambio, responda a este mensaje.");
    expect(segmentsFor(composeSmsReminder("Rio Roofing", sat, defaultSmsReminderBody("es"), "es")).encoding).toBe("gsm7");
  });
  it("English is unchanged and never folded (mutation: fold for every language -> an English 'é' brand would change; here the English lead is byte-for-byte)", () => {
    expect(smsReminderLead("Rio Roofing", "Sat, Oct 17, 9:30 AM CDT")).toBe("Reminder: your appointment with Rio Roofing is Sat, Oct 17, 9:30 AM CDT.");
  });
  it("a blank brand drops the clause in Spanish too (mutation: always the named lead -> FAILS)", () => {
    expect(smsReminderLead("  ", sat, "es")).toBe("Recordatorio: su cita es el sab, 17 de oct, 9:30 a.m. CDT.");
  });
});

const WHEN = "Wed, Sep 30, 12:30 PM CDT";

describe("smsReminderLead — the time is never the operator's to place", () => {
  it("names the company and carries the rendered time", () => {
    expect(smsReminderLead("Rio Roofing", WHEN)).toBe(`Reminder: your appointment with Rio Roofing is ${WHEN}.`);
  });

  it("drops the identifying clause for a blank name instead of inventing one", () => {
    expect(smsReminderLead("  ", WHEN)).toBe(`Reminder: your appointment is ${WHEN}.`);
  });

  it("inserts a name containing $ patterns literally", () => {
    expect(smsReminderLead("A$&B", WHEN)).toContain("with A$&B is");
  });
});

describe("composeSmsReminder — lead, one space, the operator's prose", () => {
  it("is the lead followed by the trimmed body; the lead alone when the body is empty", () => {
    expect(composeSmsReminder("Rio Roofing", WHEN, "  See you soon!  ")).toBe(`Reminder: your appointment with Rio Roofing is ${WHEN}. See you soon!`);
    expect(composeSmsReminder("Rio Roofing", WHEN, "")).toBe(`Reminder: your appointment with Rio Roofing is ${WHEN}.`);
  });

  it("MEASURED: the default with a GSM-7 name is ONE segment at the widest common date width", () => {
    // Mutation: count the operator's body alone and this still passes —
    // which is why automations.spec.ts feeds the page's counter the composed
    // string.
    const s = segmentsFor(composeSmsReminder("Rio Roofing", WHEN, defaultSmsReminderBody()));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
    expect(s.chars).toBe(122);
  });

  it("MEASURED: an accented company name flips the whole message to UCS-2 and costs TWO segments", () => {
    const s = segmentsFor(composeSmsReminder("García Roofing", WHEN, defaultSmsReminderBody()));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(2);
  });

  it("the preview instant renders at the widest common width, so the count the operator sees is not optimistic", () => {
    expect(formatWhen(SMS_REMINDER_PREVIEW_INSTANT, "America/Chicago")).toBe(WHEN);
  });
});
