// The brief's words, EN and ES. Every sentence is deterministic copy filled from the content; the guards below are
// the ones both copy catalogues carry (no milestone codes), plus no template syntax, plus plural agreement.
import { describe, expect, it } from "vitest";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import type { BriefContent } from "./brief-content";
import { briefHeading, briefOff, briefSections, briefSubject } from "./brief-copy";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;

const full = (locale: Locale): BriefContent => ({
  locale, brandName: "Rio Roofing", dayLabel: locale === "es" ? "martes, 15 de junio" : "Tuesday, June 15",
  bookings: { count: 3, more: 0, items: [
    { time: "9:00 AM", customer: "Ana Ruiz", meetingType: "On site" },
    { time: "11:00 AM", customer: null, meetingType: null },
    { time: "2:00 PM", customer: "Bo Lee", meetingType: "Phone" },
  ] },
  calls: { count: 2 },
  leads: { count: 1 },
  todos: { count: 7, more: 2, items: [{ what: "Call back Cy", due: "Tuesday, June 15, 10:00 AM" }, { what: "Send the estimate", due: null }] },
});
const only = (locale: Locale, patch: Partial<BriefContent>): BriefContent => ({
  locale, brandName: "Rio Roofing", dayLabel: "x", bookings: null, calls: null, leads: null, todos: null, ...patch,
});

describe("briefSubject", () => {
  it("EN: parts present only, plural-correct, the brand name", () => {
    expect(briefSubject(full("en"))).toBe("Your day at Rio Roofing: 3 jobs today, 2 calls answered yesterday, 1 new lead yesterday, 7 things to do");
    expect(briefSubject(only("en", { bookings: { count: 1, more: 0, items: [] } }))).toBe("Your day at Rio Roofing: 1 job today");
    expect(briefSubject(only("en", { calls: { count: 1 }, leads: { count: 4 } }))).toBe("Your day at Rio Roofing: 1 call answered yesterday, 4 new leads yesterday");
    expect(briefSubject(only("en", { todos: { count: 1, more: 0, items: [] } }))).toBe("Your day at Rio Roofing: 1 thing to do");
  });
  it("ES: usted, the glossary's words, plural-correct", () => {
    expect(briefSubject(full("es"))).toBe(
      "Su día en Rio Roofing: 3 trabajos hoy, 2 llamadas atendidas ayer, 1 cliente potencial nuevo ayer, 7 cosas pendientes");
    expect(briefSubject(only("es", { bookings: { count: 1, more: 0, items: [] } }))).toBe("Su día en Rio Roofing: 1 trabajo hoy");
    expect(briefSubject(only("es", { todos: { count: 1, more: 0, items: [] } }))).toBe("Su día en Rio Roofing: 1 cosa pendiente");
  });
  it("a blank brand name drops the clause instead of inventing a noun", () => {
    expect(briefSubject({ ...full("en"), brandName: "  " })).toBe("Your day: 3 jobs today, 2 calls answered yesterday, 1 new lead yesterday, 7 things to do");
    expect(briefSubject({ ...only("es", {}), brandName: "" })).toBe("Su día");
  });
  it("with no section at all it still reads as a subject", () => {
    expect(briefSubject(only("en", {}))).toBe("Your day at Rio Roofing");
  });
  it("a name that looks like a replacement pattern comes through literally", () => {
    expect(briefSubject({ ...full("en"), brandName: "Ana $& Co." })).toContain("Ana $& Co.");
  });
});

describe("briefHeading", () => {
  it("names the day in the content's language", () => {
    expect(briefHeading(full("en"))).toBe("Your day: Tuesday, June 15");
    expect(briefHeading(full("es"))).toBe("Su día: martes, 15 de junio");
  });
});

describe("briefSections", () => {
  it("EN: the four sections in the order the day runs, each with its words", () => {
    const s = briefSections(full("en"));
    expect(s.map((x) => x.id)).toEqual(["bookings", "calls", "leads", "todos"]);
    expect(s[0]).toMatchObject({ title: "On the calendar today", link: "calendar", linkLabel: "Open the calendar" });
    expect(s[0]!.lines).toEqual(["9:00 AM: Ana Ruiz, On site", "11:00 AM: A customer", "2:00 PM: Bo Lee, Phone"]);
    expect(s[1]).toMatchObject({ title: "Calls yesterday", link: "calls" });
    expect(s[1]!.lines).toEqual(["2 calls answered."]);
    expect(s[2]!.lines).toEqual(["1 new lead, from a call or a form.", "A lead taken by phone is also one of the calls above."]);
    expect(s[3]).toMatchObject({ title: "To do", link: "todos" });
    expect(s[3]!.lines).toEqual(["7 things are waiting for you.", "Call back Cy (due Tuesday, June 15, 10:00 AM)", "Send the estimate", "and 2 more"]);
  });

  it("ES: usted and the glossary (cita/trabajo, cliente potencial, pendientes), the date in Spanish", () => {
    const s = briefSections(full("es"));
    expect(s[0]).toMatchObject({ title: "En el calendario de hoy", linkLabel: "Abrir el calendario" });
    expect(s[0]!.lines[1]).toBe("11:00 AM: Un cliente");
    expect(s[1]!.lines).toEqual(["2 llamadas atendidas."]);
    expect(s[2]!.lines[0]).toBe("1 cliente potencial nuevo, por llamada o formulario.");
    expect(s[3]!.lines[0]).toBe("Tiene 7 pendientes.");
    expect(s[3]!.lines).toContain("Call back Cy (vence Tuesday, June 15, 10:00 AM)");
    expect(s[3]!.lines.at(-1)).toBe("y 2 más");
  });

  it("the overlap note appears only when calls and leads are BOTH there, and only once", () => {
    expect(briefSections(only("en", { leads: { count: 2 } }))[0]!.lines).toEqual(["2 new leads, from calls and forms."]);
    expect(briefSections(only("en", { calls: { count: 2 } }))[0]!.lines).toEqual(["2 calls answered."]);
    const both = briefSections(only("en", { calls: { count: 2 }, leads: { count: 2 } }));
    expect(both.flatMap((x) => x.lines).filter((l) => l.includes("also one of the calls"))).toHaveLength(1);
  });

  it("plurals agree at one in both languages", () => {
    const one = (locale: Locale) => briefSections(only(locale, { calls: { count: 1 }, todos: { count: 1, more: 0, items: [] } }));
    expect(one("en").map((x) => x.lines[0])).toEqual(["1 call answered.", "1 thing is waiting for you."]);
    expect(one("es").map((x) => x.lines[0])).toEqual(["1 llamada atendida.", "Tiene 1 pendiente."]);
  });

  it("jobs the read did not list say so (never a silent cap)", () => {
    const s = briefSections(only("en", { bookings: { count: 4, more: 3, items: [{ time: "9:00 AM", customer: "Ana Ruiz", meetingType: null }] } }));
    expect(s[0]!.lines).toEqual(["9:00 AM: Ana Ruiz", "and 3 more"]);
  });

  it("a section with nothing in it is not there", () => {
    expect(briefSections(only("en", {}))).toEqual([]);
  });
});

describe("briefOff", () => {
  it("is a plain sentence and a plain link label, in the reader's language", () => {
    expect(briefOff("en")).toEqual({ lead: "You get this each morning because you turned it on.", link: "Turn this off" });
    expect(briefOff("es")).toEqual({ lead: "Recibe esto cada mañana porque lo activó.", link: "Desactivar este resumen" });
  });
});

describe("the catalogue guards (every email.dailyBrief.* string)", () => {
  const keys = Object.keys(m).filter((k) => k.startsWith("email.dailyBrief."));
  it("there are keys, and every English key has a Spanish twin and the reverse", () => {
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      if (k.endsWith(".es")) expect(keys, `${k} has no English`).toContain(k.slice(0, -3));
      else expect(keys, `${k} has no Spanish twin`).toContain(`${k}.es`);
    }
  });
  it("carries no milestone code (the INTERNAL_MILESTONE guard) and no {{template}} syntax", () => {
    for (const k of keys) {
      const v = (m as Record<string, string>)[k]!;
      expect(v, k).not.toMatch(INTERNAL_MILESTONE);
      expect(v, k).not.toContain("{{");
      expect(v, k).not.toContain("}}");
    }
  });
  it("no rendered subject or line carries either, in either language", () => {
    for (const locale of ["en", "es"] as const) {
      const text = [briefSubject(full(locale)), briefHeading(full(locale)), ...briefSections(full(locale)).flatMap((s) => [s.title, s.linkLabel, ...s.lines]),
        briefOff(locale).lead, briefOff(locale).link].join("\n");
      expect(text, locale).not.toContain("{{");
      expect(text, locale).not.toMatch(INTERNAL_MILESTONE);
      expect(text, locale).not.toMatch(/\{[a-z]+\}/);
    }
  });
});
