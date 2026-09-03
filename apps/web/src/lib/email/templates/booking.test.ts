import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import {
  bookingAlertEmail, bookingConfirmationEmail, bookingReminderEmail, bookingRescheduledEmail,
} from "./booking";

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
const MEETING_URL = "https://acme.daily.co/bis-abc123";

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

  it("omits the cancel line/anchor entirely when cancelUrl is empty", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: "",
    });
    expect(html).not.toContain("<a href");
    expect(html.toLowerCase()).not.toContain("cancel this booking");
    expect(text.toLowerCase()).not.toContain("cancel this booking");
    // Losing the cancel link must never lose the booking confirmation itself.
    expect(html).toContain(WHEN_BOOKER);
    expect(text).toContain(WHEN_BOOKER);
  });

  it("shows a promoted \"Join your video meeting\" link in html and a plain URL line in text when meetingUrl is present", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY,
      cancelUrl: CANCEL_URL, meetingUrl: MEETING_URL,
    });
    expect(html).toContain("Join your video meeting");
    expect(html).toContain(`href="${MEETING_URL}"`);
    expect(text).toContain(`Join your video meeting: ${MEETING_URL}`);
  });

  it("renders the meeting link with more visual weight (a button) than the plain cancel link", () => {
    const { html } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY,
      cancelUrl: CANCEL_URL, meetingUrl: MEETING_URL,
    });
    const meetingAnchor = html.match(new RegExp(`<a href="${MEETING_URL}"[^>]*>`))?.[0] ?? "";
    const cancelAnchor = html.match(new RegExp(`<a href="${CANCEL_URL}"[^>]*>`))?.[0] ?? "";
    expect(meetingAnchor).toContain("background-color");
    expect(cancelAnchor).not.toContain("background-color");
  });

  it("omits the video meeting link entirely when meetingUrl is absent (same empty-cancelUrl precedent)", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(html).not.toContain("Join your video meeting");
    expect(html).not.toContain(MEETING_URL);
    expect(text).not.toContain("Join your video meeting");
    expect(text).not.toContain(MEETING_URL);
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

  it("omits the cancel line/anchor entirely when cancelUrl is empty", () => {
    const { html, text } = bookingReminderEmail({
      brand, whenBookerZone: WHEN_BOOKER, cancelUrl: "",
    });
    expect(html).not.toContain("<a href");
    expect(html.toLowerCase()).not.toContain("cancel this booking");
    expect(text.toLowerCase()).not.toContain("cancel this booking");
    expect(html).toContain(WHEN_BOOKER);
    expect(text).toContain(WHEN_BOOKER);
  });

  // Mirrors bookingConfirmationEmail's meetingUrl treatment (Task 3): a
  // promoted button in html, a plain URL line in text, present only when the
  // provider minted a room.
  it("shows a promoted \"Join your video meeting\" link in html and a plain URL line in text when meetingUrl is present", () => {
    const { html, text } = bookingReminderEmail({
      brand, whenBookerZone: WHEN_BOOKER, cancelUrl: CANCEL_URL, meetingUrl: MEETING_URL,
    });
    expect(html).toContain("Join your video meeting");
    expect(html).toContain(`href="${MEETING_URL}"`);
    expect(text).toContain(`Join your video meeting: ${MEETING_URL}`);
  });

  it("omits the video meeting link entirely when meetingUrl is absent", () => {
    const { html, text } = bookingReminderEmail({
      brand, whenBookerZone: WHEN_BOOKER, cancelUrl: CANCEL_URL,
    });
    expect(html).not.toContain("Join your video meeting");
    expect(html).not.toContain(MEETING_URL);
    expect(text).not.toContain("Join your video meeting");
    expect(text).not.toContain(MEETING_URL);
  });
});

describe("bookingRescheduledEmail", () => {
  it("says the booking MOVED — never the confirmation's 'you're booked' novelty — and carries the new when-string", () => {
    const { html, text } = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(html.toLowerCase()).toContain("moved");
    expect(text.toLowerCase()).toContain("moved");
    expect(html.toLowerCase()).not.toContain("you're booked");
    expect(text.toLowerCase()).not.toContain("you're booked");
    expect(html).toContain(WHEN_BOOKER);
    expect(text).toContain(WHEN_BOOKER);
  });

  it("carries both zone strings when they differ, once when they match", () => {
    const differ = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(differ.html).toContain(WHEN_COMPANY);
    expect(differ.text).toContain(WHEN_COMPANY);
    const same = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_BOOKER, cancelUrl: CANCEL_URL,
    });
    expect(same.html.split(WHEN_BOOKER).length - 1).toBe(1);
    expect(same.text.split(WHEN_BOOKER).length - 1).toBe(1);
  });

  it("promotes the NEW meeting link as a button and says it replaces the earlier one, in both parts", () => {
    const { html, text } = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY,
      cancelUrl: CANCEL_URL, meetingUrl: MEETING_URL,
    });
    expect(html).toContain("Join your video meeting");
    expect(html).toContain(`href="${MEETING_URL}"`);
    expect(text).toContain(`Join your video meeting: ${MEETING_URL}`);
    // The whole reason this email exists: a same-day video reschedule leaves
    // the customer holding the OLD confirmation's link. Both parts must say
    // this one replaces it.
    expect(html.toLowerCase()).toContain("replaces");
    expect(text.toLowerCase()).toContain("replaces");
  });

  it("omits the meeting link AND the replaces-line entirely when meetingUrl is absent", () => {
    const { html, text } = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(html).not.toContain("Join your video meeting");
    expect(html).not.toContain(MEETING_URL);
    expect(text).not.toContain(MEETING_URL);
    // A replaces-line with no link to replace it with would read as "your
    // link is dead and we have nothing for you" — never render it alone.
    expect(html.toLowerCase()).not.toContain("replaces");
    expect(text.toLowerCase()).not.toContain("replaces");
  });

  it("links cancellation plainly and omits the line entirely when cancelUrl is empty", () => {
    const withUrl = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(withUrl.html).toContain(`href="${CANCEL_URL}"`);
    expect(withUrl.text).toContain(CANCEL_URL);
    const without = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: "",
    });
    expect(without.html).not.toContain("<a href");
    expect(without.html.toLowerCase()).not.toContain("cancel this booking");
    expect(without.text.toLowerCase()).not.toContain("cancel this booking");
    expect(without.html).toContain(WHEN_BOOKER);
    expect(without.text).toContain(WHEN_BOOKER);
  });

  it("never returns an empty text part", () => {
    const { text } = bookingRescheduledEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe("bookingConfirmationEmail — Spanish", () => {
  const WHEN_BOOKER_ES = "mar, 26 ago, 3:00 p. m. EDT";
  const WHEN_COMPANY_ES = "mar, 26 ago, 2:00 p. m. CDT";

  it("speaks Spanish throughout when the booker did", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, locale: "es", whenBookerZone: WHEN_BOOKER_ES, whenCompanyZone: WHEN_COMPANY_ES,
      cancelUrl: CANCEL_URL, meetingUrl: MEETING_URL,
    });
    for (const part of [html, text]) {
      expect(part).toContain("Tu cita quedó agendada.");
      expect(part).toContain(`${WHEN_COMPANY_ES} para nosotros`);
      expect(part).toContain("Unirse a la videollamada");
      expect(part).toContain("Cancelar esta cita");
      expect(part).not.toContain("booked in");
      expect(part).not.toContain(" for us");
    }
  });

  it("defaults to English when no locale is given, byte-identical to the explicit en", () => {
    const input = { brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL };
    expect(bookingConfirmationEmail(input)).toEqual(bookingConfirmationEmail({ ...input, locale: "en" }));
    expect(bookingConfirmationEmail(input).text).toContain("You're booked in.");
  });
});
