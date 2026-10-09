import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import type { EmailLoad } from "@/lib/consent/email-row";

// Server actions are stubbed: this renders, nothing is clicked (the clicks are e2e, Task 14).
vi.mock("./email-actions", () => ({ stopEmailsAction: vi.fn(), undoStopEmailsAction: vi.fn(), resumeEmailsAction: vi.fn() }));

const { EmailRow } = await import("./email-row");

const ready = (view: Extract<EmailLoad, { status: "ready" }>["view"]): EmailLoad => ({ status: "ready", view, zone: "America/Chicago" });
const html = (load: EmailLoad, showTitle = false) => renderToStaticMarkup(createElement(EmailRow, { accountId: "a1", contactId: "c1", load, showTitle }));
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((b) => b[1]);

describe("EmailRow — spec §6's Email row", () => {
  it("Allowed: 'Email', the dot + word, ONE ghost 'Stop emails', no primary (rules 3, 8; mutation: make Stop emails the default variant → FAILS)", () => {
    const out = html(ready({ kind: "allowed", newestId: null }));
    // renderedText turns each tag into a space, so the label and the word are
    // apart in the text (review R2-I2): match the two with whitespace between.
    expect(renderedText(out)).toMatch(new RegExp(`${m["contact.messages.email"]}\\s+${m["contact.email.allowed"]}`));
    expect(buttons(out)).toEqual([m["contact.email.stopEmails"]]);
    expect(out).toContain('data-variant="ghost"');
    expect(out).not.toContain('data-variant="default"');
  });

  it("Stopped by the customer: the since line, the customer-only line, NO Resume (choice 19; mutation: offer Resume → FAILS)", () => {
    const out = renderedText(html(ready({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "unsubscribe_link" }, canResume: false })));
    expect(out).toContain("unsubscribe link");
    expect(out).toContain(m["contact.email.customerOnly"]);
    expect(out).not.toContain(m["contact.email.resume"]);
  });

  it("Stopped by a hard bounce or a complaint: the short how, the suppression-specific explanation, never the (false, once suppressed) customer-only line, NO Resume (D-016 item 4; mutation: fall back to customerOnly → FAILS)", () => {
    const bounced = renderedText(html(ready({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "bounced" }, canResume: false })));
    expect(bounced).toContain("it bounced");
    expect(bounced).toContain(m["contact.email.bouncedExplain"]);
    expect(bounced).not.toContain(m["contact.email.customerOnly"]);
    expect(bounced).not.toContain(m["contact.email.resume"]);

    const complained = renderedText(html(ready({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "complained" }, canResume: false })));
    expect(complained).toContain("they marked it as spam");
    expect(complained).toContain(m["contact.email.complainedExplain"]);
    expect(complained).not.toContain(m["contact.email.customerOnly"]);
  });

  it("Stopped by staff or the fold: ghost 'Resume emails…' (the note form opens on click, e2e), no customer-only line (mutation: canResume ignored → FAILS)", () => {
    const out = html(ready({ kind: "stopped", eventId: "e", since: "2026-09-01T15:00:00Z", how: { kind: "backfill_0049" }, canResume: true }));
    expect(buttons(out)).toEqual([m["contact.email.resume"]]);
    expect(renderedText(out)).toContain("you marked them “No marketing emails”");
    expect(renderedText(out)).not.toContain(m["contact.email.customerOnly"]);
  });

  it("no email address renders nothing; loading is the two-row skeleton; error is the line and Retry (spec §6 states; mutation: render 'Allowed' while loading → FAILS)", () => {
    expect(html(ready({ kind: "no_email" }))).toBe("");
    expect(html({ status: "loading" })).toContain('data-testid="email-row-skeleton"');
    expect(renderedText(html({ status: "error" }))).toContain(m["contact.email.loadFailed"]);
  });

  it("shows the Messages label only when told to (the Texts row shows none for a contact with no number; mutation: always show it → two labels, FAILS)", () => {
    expect(renderedText(html(ready({ kind: "allowed", newestId: null }), true))).toContain(m["contact.messages.title"]);
    expect(renderedText(html(ready({ kind: "allowed", newestId: null }), false))).not.toContain(m["contact.messages.title"]);
  });
});
