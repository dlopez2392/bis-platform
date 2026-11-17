import { describe, expect, it } from "vitest";
import type { BriefContent } from "@/lib/brief/brief-content";
import type { EmailBrand } from "./shell";
import { UNSUBSCRIBE_MARKER } from "./shell";
import { dailyBriefEmail } from "./daily-brief";

const brand: EmailBrand = {
  name: "Rio Roofing", logoUrl: null,
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const links = {
  calendar: "https://app.example.com/dashboard/accounts/a1/calendar",
  calls: "https://app.example.com/dashboard/accounts/a1/calls",
  todos: "https://app.example.com/dashboard/accounts/a1/tasks",
};
const offUrl = "https://app.example.com/brief/off/1.abc.def";
const content = (locale: "en" | "es", patch: Partial<BriefContent> = {}): BriefContent => ({
  locale, brandName: "Rio Roofing", dayLabel: locale === "es" ? "martes, 15 de junio" : "Tuesday, June 15",
  bookings: { count: 1, more: 0, items: [{ time: "9:00 AM", customer: "Ana Ruiz", meetingType: "On site" }] },
  calls: { count: 2 }, leads: null,
  todos: { count: 1, more: 0, items: [{ what: "Call back Cy", due: null }] }, ...patch,
});

describe("dailyBriefEmail", () => {
  it("EN: subject, text and html carry the day, the sections, the links and the way off", () => {
    const e = dailyBriefEmail({ brand, content: content("en"), links, offUrl });
    expect(e.subject).toBe("Your day at Rio Roofing: 1 job today, 2 calls answered yesterday, 1 thing to do");
    for (const part of ["Your day: Tuesday, June 15", "On the calendar today", "9:00 AM: Ana Ruiz, On site", "2 calls answered.", "Call back Cy"]) {
      expect(e.text, part).toContain(part);
      expect(e.html, part).toContain(part);
    }
    expect(e.text).toContain(`Open the calendar: ${links.calendar}`);
    expect(e.text).toContain(`See the calls: ${links.calls}`);
    expect(e.text).toContain(`Open To do: ${links.todos}`);
    expect(e.text).toContain(`Turn this off: ${offUrl}`);
    expect(e.html).toContain(`href="${links.calendar}"`);
    expect(e.html).toContain(`href="${offUrl}"`);
    expect(e.html).toContain("Rio Roofing");
  });

  it("ES: one message in one language end to end, usted, the brand name still there", () => {
    const e = dailyBriefEmail({ brand, content: content("es"), links, offUrl });
    expect(e.subject).toBe("Su día en Rio Roofing: 1 trabajo hoy, 2 llamadas atendidas ayer, 1 cosa pendiente");
    for (const part of ["Su día: martes, 15 de junio", "En el calendario de hoy", "2 llamadas atendidas.", "Abrir el calendario", "Recibe esto cada mañana porque lo activó.", "Desactivar este resumen"]) {
      expect(e.html, part).toContain(part);
    }
    expect(e.text).toContain(`Desactivar este resumen: ${offUrl}`);
    expect(e.text + e.html).not.toMatch(/Your day|Turn this off|Open the calendar|On the calendar/);
  });

  it("only the sections with something in them are rendered", () => {
    const e = dailyBriefEmail({ brand, content: content("en", { bookings: null, todos: null }), links, offUrl });
    expect(e.text).toContain("Calls yesterday");
    expect(e.text).not.toContain("On the calendar today");
    expect(e.text).not.toContain("To do\n");
    expect(e.html).not.toContain("Open the calendar");
  });

  it("escapes what a customer typed, in html, and leaves the text part alone", () => {
    const e = dailyBriefEmail({
      brand, links, offUrl,
      content: content("en", { bookings: { count: 1, more: 0, items: [{ time: "9:00 AM", customer: "<img src=x onerror=1> & Co", meetingType: null }] } }),
    });
    expect(e.html).not.toContain("<img src=x");
    expect(e.html).toContain("&lt;img src=x onerror=1&gt; &amp; Co");
    expect(e.text).toContain("<img src=x onerror=1> & Co");
  });

  it("leaves the shell's footer marker for the gate to remove (operator mail), and no template syntax anywhere", () => {
    for (const locale of ["en", "es"] as const) {
      const e = dailyBriefEmail({ brand, content: content(locale), links, offUrl });
      expect(e.html).toContain(UNSUBSCRIBE_MARKER);
      expect(e.html + e.text + e.subject).not.toContain("{{");
      expect(e.html + e.text + e.subject).not.toMatch(/\bM\d[a-z]?\b/);
    }
  });

  it("the brand name in the subject comes from the content, never from anything called accounts.name", () => {
    const e = dailyBriefEmail({ brand, content: { ...content("en"), brandName: "Ana $& Co." }, links, offUrl });
    expect(e.subject).toContain("Ana $& Co.");
    expect(e.subject).not.toContain("accounts.name");
  });
});
