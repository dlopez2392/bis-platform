// apps/web/src/lib/brief/brief-copy.ts
// The daily brief's words (plan D5): deterministic, one language end to end, filled from BriefContent. No AI, no
// template syntax, no internal codes (the catalogue under email.dailyBrief.*, guarded in brief-copy.test.ts). This
// returns plain strings; templates/daily-brief.ts decides how they sit in html and in text.
import { m } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { BriefContent } from "./brief-content";

export type BriefLink = "calendar" | "calls" | "todos";
export type BriefSection = {
  id: "bookings" | "calls" | "leads" | "todos";
  title: string;
  lines: string[];
  link: BriefLink;
  linkLabel: string;
};

/** "Your day at {business}: 3 jobs today, 2 calls answered yesterday". Parts only when present. `brandName` is the
 *  customer-facing name; blank drops the clause rather than inventing one. */
export function briefSubject(c: BriefContent): string {
  const { locale } = c;
  const parts = [
    c.bookings ? plural(m, "email.dailyBrief.part.jobs", c.bookings.count, locale, { count: c.bookings.count }) : null,
    c.calls ? plural(m, "email.dailyBrief.part.calls", c.calls.count, locale, { count: c.calls.count }) : null,
    c.leads ? plural(m, "email.dailyBrief.part.leads", c.leads.count, locale, { count: c.leads.count }) : null,
    c.todos ? plural(m, "email.dailyBrief.part.todos", c.todos.count, locale, { count: c.todos.count }) : null,
  ].filter((p): p is string => p !== null);
  const business = c.brandName.trim();
  if (parts.length === 0) {
    return business ? t(m, "email.dailyBrief.subject.bare", locale, { business }) : t(m, "email.dailyBrief.subject.bareNoName", locale);
  }
  const joined = parts.join(", ");
  return business
    ? t(m, "email.dailyBrief.subject", locale, { business, parts: joined })
    : t(m, "email.dailyBrief.subject.noName", locale, { parts: joined });
}

export function briefHeading(c: BriefContent): string {
  return t(m, "email.dailyBrief.heading", c.locale, { date: c.dayLabel });
}

export function briefSections(c: BriefContent): BriefSection[] {
  const { locale } = c;
  const out: BriefSection[] = [];
  const more = (n: number) => t(m, "email.dailyBrief.more", locale, { count: n });

  if (c.bookings) {
    const lines = c.bookings.items.map((b) => {
      const customer = b.customer ?? t(m, "email.dailyBrief.aCustomer", locale);
      return b.meetingType
        ? t(m, "email.dailyBrief.booking.itemType", locale, { time: b.time, customer, type: b.meetingType })
        : t(m, "email.dailyBrief.booking.item", locale, { time: b.time, customer });
    });
    if (c.bookings.more > 0) lines.push(more(c.bookings.more));
    out.push({ id: "bookings", title: t(m, "email.dailyBrief.section.bookings", locale), lines, link: "calendar", linkLabel: t(m, "email.dailyBrief.link.calendar", locale) });
  }
  if (c.calls) {
    out.push({
      id: "calls", title: t(m, "email.dailyBrief.section.calls", locale),
      lines: [plural(m, "email.dailyBrief.calls.line", c.calls.count, locale, { count: c.calls.count })],
      link: "calls", linkLabel: t(m, "email.dailyBrief.link.calls", locale),
    });
  }
  if (c.leads) {
    // A lead taken by phone is in both numbers; say so once, only when both are on the page, never add them.
    const lines = [plural(m, "email.dailyBrief.leads.line", c.leads.count, locale, { count: c.leads.count })];
    if (c.calls) lines.push(t(m, "email.dailyBrief.leads.overlap", locale));
    out.push({ id: "leads", title: t(m, "email.dailyBrief.section.leads", locale), lines, link: "calls", linkLabel: t(m, "email.dailyBrief.link.calls", locale) });
  }
  if (c.todos) {
    const lines = [plural(m, "email.dailyBrief.todos.line", c.todos.count, locale, { count: c.todos.count })];
    for (const i of c.todos.items) {
      lines.push(i.due ? t(m, "email.dailyBrief.todos.itemDue", locale, { what: i.what, due: i.due }) : i.what);
    }
    if (c.todos.more > 0) lines.push(more(c.todos.more));
    out.push({ id: "todos", title: t(m, "email.dailyBrief.section.todos", locale), lines, link: "todos", linkLabel: t(m, "email.dailyBrief.link.todos", locale) });
  }
  return out;
}

export function briefOff(locale: BriefContent["locale"]): { lead: string; link: string } {
  return { lead: t(m, "email.dailyBrief.off.lead", locale), link: t(m, "email.dailyBrief.off.link", locale) };
}
