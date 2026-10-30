// S-47d fix round C8 (design review I9 + final M-6): ONE presentational row for an appointment a closure
// affects, drawn the same way on the dashboard's status card (a server component) and the Calendar page's
// Closed days card (a client component). Rendered with renderToStaticMarkup + createElement, the house
// device for components (no .tsx test convention in this repo).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { AffectedAppointmentRow, type AffectedAppointment } from "./affected-appointment-row";

const here = path.dirname(fileURLToPath(import.meta.url));
// Import lines only: a guard over the whole file would be tripped (or satisfied) by a comment.
const imports = readFileSync(path.join(here, "affected-appointment-row.tsx"), "utf8")
  .split("\n").filter((l) => /^import\b/.test(l)).join("\n");
const text = (html: string) => renderedText(html).replace(/\s+/g, " ");

const APPT: AffectedAppointment = {
  id: "bk_1", contactId: "c_1", name: "Ana Reyes", startsAt: "2027-06-08T19:14:00.000Z", held: 0, kept: false,
};

function render(over: Partial<Parameters<typeof AffectedAppointmentRow>[0]> = {}): string {
  return renderToStaticMarkup(createElement("ul", null, createElement(AffectedAppointmentRow, {
    accountId: "a1", appointment: APPT, timezone: "America/Chicago", locale: "en", canAct: true,
    keep: createElement("button", { type: "button" }, "KEEP-CONTROL"),
    ...over,
  })));
}

describe("AffectedAppointmentRow", () => {
  it("reads \"when · name\", one separator, the time in the account's zone (mutation: name first, or a second separator -> FAILS)", () => {
    const t1 = text(render());
    expect(t1).toContain("Jun 8, 2:14 PM · Ana Reyes");
    expect(t1.match(/·/g)?.length).toBe(1);
  });

  it("Spanish: the shared tables, \"8 de jun., 2:14 PM · Ana Reyes\"", () => {
    expect(text(render({ locale: "es" }))).toContain("8 de jun., 2:14 PM · Ana Reyes");
  });

  it("the name links to the customer's record", () => {
    expect(render()).toContain('href="/dashboard/accounts/a1/contacts/c_1"');
  });

  it("a nameless contact gets the catalogue's fallback, never an empty link (mutation: render the empty name -> FAILS)", () => {
    const html = render({ appointment: { ...APPT, name: "" } });
    expect(text(html)).toContain(`Jun 8, 2:14 PM · ${m["contact.noName"]}`);
    expect(html).not.toMatch(/<a [^>]*href="\/dashboard\/accounts\/a1\/contacts\/c_1"[^>]*><\/a>/);
  });

  it("\"{n} messages waiting\" when any are held, the singular at 1, nothing at 0", () => {
    expect(text(render({ appointment: { ...APPT, held: 3 } }))).toContain("3 messages waiting");
    expect(text(render({ appointment: { ...APPT, held: 1 } }))).toContain(m["business.card.waitingOne"]);
    expect(text(render())).not.toMatch(/waiting/);
  });

  it("whoever may act sees the caller's Keep control and \"Cancel on the calendar\", linking to that booking's drawer, ?job=<id> (F-046 part 1; mutation: the old #booking- anchor → FAILS)", () => {
    const html = render();
    expect(html).toContain("KEEP-CONTROL");
    expect(text(html)).toContain(m["business.card.cancelOnCalendar"]);
    expect(html).toContain('href="/dashboard/accounts/a1/calendar?job=bk_1"');
    expect(html).not.toContain("#booking-");
  });

  it("a kept appointment shows \"Kept\" as TEXT, never a button (mutation: keep rendering the control once kept -> FAILS)", () => {
    const html = render({ appointment: { ...APPT, kept: true } });
    expect(html).not.toContain("KEEP-CONTROL");
    expect(html).toMatch(new RegExp(`<span[^>]*>${m["business.card.kept"]}</span>`));
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${m["business.card.kept"]}</button>`));
  });

  it("whoever may NOT act (a Technician) sees neither Keep nor \"Cancel on the calendar\" (mutation: ignore canAct -> FAILS)", () => {
    const html = render({ canAct: false });
    expect(html).not.toContain("KEEP-CONTROL");
    expect(text(html)).not.toContain(m["business.card.cancelOnCalendar"]);
    expect(text(html)).toContain("Ana Reyes");
  });

  it("every link is a 44px tap target below md (min-h-11)", () => {
    const links = render().match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBe(2);
    for (const a of links) expect(a).toMatch(/\bmin-h-11\b/);
  });

  it("the pseudo-locale wraps the row's own words", () => {
    const t2 = text(render({ pseudo: true, appointment: { ...APPT, held: 2 } }));
    expect(t2).not.toContain("2 messages waiting");
    expect(t2).not.toContain(m["business.card.cancelOnCalendar"]);
  });

  it("imports nothing server-only (import lines): no database, no Clerk, no request helpers (the Closed days card is a client component; a server import broke the build once)", () => {
    expect(imports).toMatch(/^import Link from "next\/link";$/m);
    expect(imports).not.toMatch(/from "@bis\/db"/);
    expect(imports).not.toMatch(/@\/lib\/db"/);
    expect(imports).not.toMatch(/@clerk\//);
    expect(imports).not.toMatch(/server-only/);
    expect(imports).not.toMatch(/next\/headers/);
    expect(imports).not.toMatch(/@\/lib\/auth"/);
  });
});
