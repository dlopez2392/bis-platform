import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordHeader } from "./record-header";

const render = (actions: Parameters<typeof RecordHeader>[0]["actions"], subtitle: string | null = "García family · Household") =>
  renderToStaticMarkup(createElement(RecordHeader, {
    name: "Ana García", subtitle, back: { href: "/dashboard/accounts/a1/contacts", label: "Contacts" }, actions,
  }));

const ALL = [
  { id: "call", label: "Call", href: "tel:+19565550100", ariaLabel: "Call Ana García", primary: true },
  { id: "text", label: "Text", href: "#compose-sms" },
  { id: "email", label: "Email", href: "#compose-email" },
  { id: "directions", label: "Directions", href: "https://www.google.com/maps/search/?api=1&query=x", external: true },
];

describe("RecordHeader (spec §9.1)", () => {
  it("the name is the page's one h1, truncating with its full text in title", () => {
    const html = render(ALL);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*title="Ana García"[^>]*>Ana García<\/h1>/);
  });

  it("renders the actions in the order given, exactly one primary (mutation: render every action primary -> FAILS)", () => {
    const html = render(ALL);
    expect([...html.matchAll(/data-record-action="(\w+)"/g)].map((x) => x[1])).toEqual(["call", "text", "email", "directions"]);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(/data-variant="default"[^>]*data-record-action="call"|data-record-action="call"[^>]*data-variant="default"/);
  });

  it("Directions opens a new tab without a referrer; Call carries its aria-label", () => {
    const html = render(ALL);
    expect(html).toMatch(/target="_blank"[^>]*rel="noreferrer"|rel="noreferrer"[^>]*target="_blank"/);
    expect(html).toContain('aria-label="Call Ana García"');
  });

  it("no actions: no action row at all; no group: no subtitle line", () => {
    const html = render([], null);
    expect(html).not.toContain("data-record-actions");
    expect(html).not.toContain("data-record-subtitle");
    expect(html).toContain('href="/dashboard/accounts/a1/contacts"');
  });
});
