import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import { bookingAlertEmail, bookingConfirmationEmail, bookingReminderEmail } from "./booking";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" }, "Acme");

const WHEN_COMPANY = "Tue, Aug 26 · 2:00 PM CDT";
const WHEN_BOOKER = "Tue, Aug 26 · 3:00 PM EDT";
const CONTACT_URL = "https://bis-platform-six.vercel.app/dashboard/accounts/acct_1/contacts/contact_1";
const CANCEL_URL = "https://bis-platform-six.vercel.app/book/cancel/tok_1";

describe("bookingAlertEmail", () => {
  it("carries the contact name and the when-string in both parts", () => {
    const { html, text } = bookingAlertEmail({
      brand, whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      note: null, contactUrl: null,
    });
    expect(html).toContain("Jane Doe");
    expect(html).toContain(WHEN_COMPANY);
    expect(text).toContain("Jane Doe");
    expect(text).toContain(WHEN_COMPANY);
  });

  it("links the contact ABSOLUTELY, in both parts", () => {
    const { html, text } = bookingAlertEmail({
      brand, whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      note: null, contactUrl: CONTACT_URL,
    });
    expect(html).toContain(`href="${CONTACT_URL}"`);
    expect(text).toContain(CONTACT_URL);
  });

  it("omits the link entirely when contactUrl is null", () => {
    const { html, text } = bookingAlertEmail({
      brand, whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      note: null, contactUrl: null,
    });
    expect(html).not.toContain("<a href");
    expect(text).not.toContain("http");
    // Losing the link must never lose the booking itself.
    expect(text).toContain("Jane Doe");
  });

  it("carries the note when present", () => {
    const { html, text } = bookingAlertEmail({
      brand, whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      note: "Please call ahead", contactUrl: null,
    });
    expect(html).toContain("Please call ahead");
    expect(text).toContain("Please call ahead");
  });

  it("never returns an empty text part", () => {
    const { text } = bookingAlertEmail({
      brand, whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      note: null, contactUrl: null,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  // contactName and note are attacker-supplied: typed into a public booking page.
  it("escapes an attacker-supplied contactName", () => {
    const { html } = bookingAlertEmail({
      brand, whenCompanyZone: WHEN_COMPANY, contactName: "<script>alert(1)</script>",
      note: null, contactUrl: null,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an attacker-supplied note", () => {
    const { html } = bookingAlertEmail({
      brand, whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      note: "<script>alert(1)</script>", contactUrl: null,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("bookingConfirmationEmail", () => {
  it("carries both zone strings when they differ", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(html).toContain(WHEN_BOOKER);
    expect(html).toContain(WHEN_COMPANY);
    expect(text).toContain(WHEN_BOOKER);
    expect(text).toContain(WHEN_COMPANY);
  });

  it("renders the when-line once when both zone strings match", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_BOOKER, cancelUrl: CANCEL_URL,
    });
    const htmlOccurrences = html.split(WHEN_BOOKER).length - 1;
    const textOccurrences = text.split(WHEN_BOOKER).length - 1;
    expect(htmlOccurrences).toBe(1);
    expect(textOccurrences).toBe(1);
  });

  it("links cancellation as a plain link, not a button", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(html).toContain(`href="${CANCEL_URL}"`);
    expect(text).toContain(CANCEL_URL);
  });

  it("never returns an empty text part", () => {
    const { text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe("bookingReminderEmail", () => {
  it("carries the booker-zone when-string and the cancel link", () => {
    const { html, text } = bookingReminderEmail({
      brand, whenBookerZone: WHEN_BOOKER, cancelUrl: CANCEL_URL,
    });
    expect(html).toContain(WHEN_BOOKER);
    expect(html).toContain(`href="${CANCEL_URL}"`);
    expect(text).toContain(WHEN_BOOKER);
    expect(text).toContain(CANCEL_URL);
  });

  it("carries no company-zone line and no 'you're booked' novelty", () => {
    const { html, text } = bookingReminderEmail({
      brand, whenBookerZone: WHEN_BOOKER, cancelUrl: CANCEL_URL,
    });
    expect(html).not.toContain(WHEN_COMPANY);
    expect(text).not.toContain(WHEN_COMPANY);
    expect(html.toLowerCase()).not.toContain("you're booked");
    expect(text.toLowerCase()).not.toContain("you're booked");
  });

  it("never returns an empty text part", () => {
    const { text } = bookingReminderEmail({
      brand, whenBookerZone: WHEN_BOOKER, cancelUrl: CANCEL_URL,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
