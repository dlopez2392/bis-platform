import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrand } from "./shell";
import {
  bookingAlertEmail, bookingConfirmationEmail, bookingReminderEmail, bookingRescheduledEmail,
  bookingPhoneChangeAlertEmail, bookingCancelledEmail, bookingCancelledSubject,
  bookingRescheduledSubject, bookingCancelledByBusinessEmail, bookingCancelledByBusinessSubject,
  bookingMovedAlertEmail, bookingReminderSubject,
  bookingAlertSubject, bookingCancelNoticeEmail, ownerAlertFallbackName,
} from "./booking";
import { formatWhen } from "@/lib/booking/time";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });

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

// D-038: a booking moved by phone, for a caller who spoke Spanish. Same tú
// register as the Spanish confirmation and cancellation.
describe("bookingRescheduledEmail — Spanish", () => {
  const WHEN_BOOKER_ES = "mar, 26 ago, 3:00 p. m. EDT";
  const WHEN_COMPANY_ES = "mar, 26 ago, 2:00 p. m. CDT";

  it("speaks Spanish throughout when the caller did, the replaces-line included", () => {
    const { html, text } = bookingRescheduledEmail({
      brand, locale: "es", whenBookerZone: WHEN_BOOKER_ES, whenCompanyZone: WHEN_COMPANY_ES,
      cancelUrl: CANCEL_URL, meetingUrl: MEETING_URL,
    });
    expect(bookingRescheduledSubject("es")).toBe("Tu cita fue reprogramada");
    for (const part of [html, text]) {
      expect(part).toContain("Tu cita fue reprogramada.");
      expect(part).toContain(`${WHEN_COMPANY_ES} para nosotros`);
      expect(part).toContain("Unirse a la videollamada");
      expect(part).toContain("Este enlace reemplaza al de tu confirmación anterior.");
      expect(part).toContain("Cancelar esta cita");
      expect(part.toLowerCase()).not.toContain("moved");
      expect(part).not.toContain(" for us");
      expect(part).not.toContain("replaces");
    }
  });

  it("defaults to English when no locale is given, byte-identical to the explicit en", () => {
    const input = {
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY,
      cancelUrl: CANCEL_URL, meetingUrl: MEETING_URL,
    };
    expect(bookingRescheduledEmail(input)).toEqual(bookingRescheduledEmail({ ...input, locale: "en" }));
    expect(bookingRescheduledSubject()).toBe("Your booking has been moved");
    expect(bookingRescheduledSubject("en")).toBe("Your booking has been moved");
  });
});

// The staff alert for a booking the phone receptionist cancelled or moved.
// Operator-facing (English, like every staff alert), but the contact's name
// on it is customer-supplied: typed into a booking page or spoken on a call.
describe("bookingPhoneChangeAlertEmail", () => {
  const WHEN_NEW = "Wed, Aug 27 · 10:00 AM CDT";

  it("a cancellation names the kind, the old time, the contact and the calling number in both parts", () => {
    const { subject, html, text } = bookingPhoneChangeAlertEmail({
      brand, kind: "cancelled", whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      callerNumber: "+19562921696", contactUrl: CONTACT_URL,
    });
    expect(subject).toBe(`Booking cancelled by phone: ${WHEN_COMPANY} — Jane Doe`);
    for (const part of [html, text]) {
      expect(part).toContain("Booking cancelled by phone");
      expect(part).toContain(WHEN_COMPANY);
      expect(part).toContain("Jane Doe");
      expect(part).toContain("+19562921696");
    }
    expect(html).toContain(`href="${CONTACT_URL}"`);
    expect(html).toContain("Open this contact");
    expect(text).toContain(`Open this contact: ${CONTACT_URL}`);
  });

  it("a move carries BOTH times, old and new, in the subject and both parts", () => {
    const { subject, html, text } = bookingPhoneChangeAlertEmail({
      brand, kind: "moved", whenCompanyZone: WHEN_COMPANY, newWhenCompanyZone: WHEN_NEW,
      contactName: "Jane Doe", callerNumber: "+19562921696", contactUrl: CONTACT_URL,
    });
    expect(subject).toContain("Booking moved by phone");
    expect(subject).toContain(WHEN_COMPANY);
    expect(subject).toContain(WHEN_NEW);
    // Old before new: the subject reads as the change it reports.
    expect(subject.indexOf(WHEN_COMPANY)).toBeLessThan(subject.indexOf(WHEN_NEW));
    for (const part of [html, text]) {
      expect(part).toContain("Booking moved by phone");
      expect(part).toContain(WHEN_COMPANY);
      expect(part).toContain(WHEN_NEW);
    }
  });

  it("escapes a hostile contact name in html", () => {
    const { html } = bookingPhoneChangeAlertEmail({
      brand, kind: "cancelled", whenCompanyZone: WHEN_COMPANY,
      contactName: "<script>alert(1)</script>", callerNumber: null, contactUrl: null,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("strips CR/LF from the subject — a name cannot add a header line", () => {
    const { subject } = bookingPhoneChangeAlertEmail({
      brand, kind: "moved", whenCompanyZone: WHEN_COMPANY, newWhenCompanyZone: WHEN_NEW,
      contactName: "Jane\r\nBcc: someone@example.com", callerNumber: null, contactUrl: null,
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain("Jane Bcc: someone@example.com");
  });

  it("says the number was not shown when the call had no caller ID, and omits the button with no url", () => {
    const { html, text } = bookingPhoneChangeAlertEmail({
      brand, kind: "cancelled", whenCompanyZone: WHEN_COMPANY, contactName: "Jane Doe",
      callerNumber: null, contactUrl: null,
    });
    expect(text).toContain("Number not shown");
    expect(html).toContain("Number not shown");
    expect(html).not.toContain("<a href");
    expect(text).not.toContain("http");
  });

  it("never returns an empty text part and carries no template syntax", () => {
    const { subject, html, text } = bookingPhoneChangeAlertEmail({
      brand, kind: "moved", whenCompanyZone: WHEN_COMPANY, newWhenCompanyZone: WHEN_NEW,
      contactName: "Jane Doe", callerNumber: "+19562921696", contactUrl: CONTACT_URL,
    });
    expect(text.trim().length).toBeGreaterThan(0);
    for (const part of [subject, html, text]) expect(part).not.toContain("{{");
  });
});

// The customer-facing cancellation notice. Its one job beyond confirming the
// news is the "if you didn't ask for this" line: a phone cancellation is the
// one change a customer may learn about only from this email.
describe("bookingCancelledEmail", () => {
  const WHEN_COMPANY_ES = "mar, 26 ago, 2:00 p. m. CDT";

  it("English: says the booking was cancelled, carries the time and the didn't-ask-for-this line", () => {
    const { html, text } = bookingCancelledEmail({ brand, locale: "en", whenCompanyZone: WHEN_COMPANY });
    expect(bookingCancelledSubject("en")).toBe("Your booking has been cancelled");
    for (const part of [html, text]) {
      expect(part).toContain("Your booking has been cancelled.");
      expect(part).toContain(WHEN_COMPANY);
      expect(part).toContain("If you didn't ask for this, please contact us right away.");
    }
  });

  it("Spanish: speaks Spanish throughout", () => {
    const { html, text } = bookingCancelledEmail({ brand, locale: "es", whenCompanyZone: WHEN_COMPANY_ES });
    expect(bookingCancelledSubject("es")).toBe("Tu cita fue cancelada");
    for (const part of [html, text]) {
      expect(part).toContain("Tu cita fue cancelada.");
      expect(part).toContain(WHEN_COMPANY_ES);
      expect(part).toContain("Si no pediste esta cancelación, comunícate con nosotros cuanto antes.");
      expect(part).not.toContain("cancelled");
      expect(part).not.toContain("contact us");
    }
  });

  it("defaults to English, carries no button and no template syntax in either language", () => {
    const input = { brand, whenCompanyZone: WHEN_COMPANY };
    expect(bookingCancelledEmail(input)).toEqual(bookingCancelledEmail({ ...input, locale: "en" }));
    expect(bookingCancelledSubject()).toBe(bookingCancelledSubject("en"));
    for (const locale of ["en", "es"] as const) {
      const { html, text } = bookingCancelledEmail({ ...input, locale });
      for (const part of [html, text, bookingCancelledSubject(locale)]) expect(part).not.toContain("{{");
      // Customer-facing restraint, same as the confirmation: plain paragraphs,
      // nothing to click.
      expect(html).not.toContain("<a href");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("bookingConfirmationEmail — the add-to-calendar link (F-048)", () => {
  const ICS_URL = "https://bis-platform-six.vercel.app/b/pub1/ics/tok_1";

  it("links the calendar file plainly in both parts when there is one (mutation: drop the link → FAILS)", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL, calendarUrl: ICS_URL,
    });
    expect(html).toContain(`href="${ICS_URL}"`);
    expect(html).toContain("Add to your calendar");
    expect(text).toContain(`Add to your calendar: ${ICS_URL}`);
  });

  it("speaks Spanish for a Spanish booker", () => {
    const { html, text } = bookingConfirmationEmail({
      brand, locale: "es", whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL, calendarUrl: ICS_URL,
    });
    for (const part of [html, text]) {
      expect(part).toContain("Agregar a tu calendario");
      expect(part).not.toContain("Add to your calendar");
    }
  });

  it("omits the line entirely without a url — never a link to nowhere", () => {
    for (const calendarUrl of [undefined, ""]) {
      const { html, text } = bookingConfirmationEmail({
        brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL, calendarUrl,
      });
      expect(html).not.toContain("Add to your calendar");
      expect(text).not.toContain("Add to your calendar");
    }
  });
});

/**
 * F-048: the notice a customer gets when the BUSINESS cancels from the
 * Calendar page. The owner sees and can edit `message` in the Cancel dialog;
 * the rest is fixed. Customer-facing restraint, as the confirmation: plain
 * paragraphs and one plain link (to book again), never a button.
 */
describe("bookingCancelledByBusinessEmail", () => {
  const REBOOK = "https://bis-platform-six.vercel.app/b/pub1";

  it("says the booking was cancelled, with the time and the owner's own message, in both parts", () => {
    const { html, text } = bookingCancelledByBusinessEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY,
      message: "Our truck broke down.\nWe're sorry!", rebookUrl: REBOOK,
    });
    expect(bookingCancelledByBusinessSubject("en")).toBe("Your booking has been cancelled");
    for (const part of [html, text]) {
      expect(part).toContain("Your booking has been cancelled.");
      expect(part).toContain(WHEN_BOOKER);
      expect(part).toContain(WHEN_COMPANY);
      expect(part).toContain("Our truck broke down.");
    }
    // The owner's line break survives into the html part as a break.
    expect(html).toContain("Our truck broke down.<br />We're sorry!");
    expect(text).toContain("Our truck broke down.\nWe're sorry!");
    expect(html).toContain(`href="${REBOOK}"`);
    expect(text).toContain(`Book a new time: ${REBOOK}`);
  });

  it("escapes the owner's message (mutation: drop escapeHtml on the message → FAILS)", () => {
    const { html } = bookingCancelledByBusinessEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_BOOKER,
      message: "<script>alert(1)</script>", rebookUrl: "",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows the time once when both zones read the same, and leaves out an empty message and an absent rebook link", () => {
    const { html, text } = bookingCancelledByBusinessEmail({
      brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_BOOKER, message: "   ", rebookUrl: "",
    });
    expect(text.split(WHEN_BOOKER).length - 1).toBe(1);
    expect(html).not.toContain("<a href");
    expect(text).not.toContain("Book a new time");
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("speaks Spanish throughout when the owner chose Spanish, and carries no template syntax in either language", () => {
    const es = bookingCancelledByBusinessEmail({
      brand, locale: "es", whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY,
      message: "Lo sentimos.", rebookUrl: REBOOK,
    });
    expect(bookingCancelledByBusinessSubject("es")).toBe("Tu cita fue cancelada");
    for (const part of [es.html, es.text]) {
      expect(part).toContain("Tu cita fue cancelada.");
      expect(part).toContain("Agendar otro horario");
      expect(part).toContain("para nosotros");
      expect(part).not.toContain("cancelled");
    }
    for (const locale of ["en", "es"] as const) {
      const { html, text } = bookingCancelledByBusinessEmail({
        brand, locale, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, message: "x", rebookUrl: REBOOK,
      });
      for (const part of [html, text, bookingCancelledByBusinessSubject(locale)]) expect(part).not.toContain("{{");
    }
  });
});

/**
 * F-048 (rider): the customer moves their own booking. The confirmation and
 * the "moved" email carry a way to change the time; the moved email also
 * carries the NEW booking's add-to-calendar file, whose UID is the old one's,
 * so the saved event is updated rather than doubled.
 */
describe("the move link and the moved email's calendar file (F-048)", () => {
  const MOVE_URL = "https://x.example/b/pub_1/move/tok_new";
  const ICS_URL = "https://x.example/b/pub_1/ics/tok_new";

  for (const locale of ["en", "es"] as const) {
    const label = locale === "es" ? "Cambiar el horario" : "Change the time";
    const calendarLabel = locale === "es" ? "Agregar a tu calendario" : "Add to your calendar";

    it(`${locale}: the confirmation links a change of time plainly, in both parts (mutation: drop the link → FAILS)`, () => {
      const { html, text } = bookingConfirmationEmail({
        brand, locale, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL, moveUrl: MOVE_URL,
      });
      expect(html).toContain(`<a href="${MOVE_URL}" style="color:#71717a;">${label}</a>`);
      expect(text).toContain(`${label}: ${MOVE_URL}`);
    });

    it(`${locale}: the moved email carries the new calendar file and the change link, in both parts (mutation: drop either → FAILS)`, () => {
      const { html, text } = bookingRescheduledEmail({
        brand, locale, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL,
        calendarUrl: ICS_URL, moveUrl: MOVE_URL,
      });
      expect(html).toContain(`<a href="${ICS_URL}" style="color:#71717a;">${calendarLabel}</a>`);
      expect(text).toContain(`${calendarLabel}: ${ICS_URL}`);
      expect(html).toContain(`<a href="${MOVE_URL}" style="color:#71717a;">${label}</a>`);
      expect(text).toContain(`${label}: ${MOVE_URL}`);
    });
  }

  it("omits both lines entirely without a url — never a link to nowhere — and the receptionist's call (no new fields) is byte-identical", () => {
    const base = { brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_COMPANY, cancelUrl: CANCEL_URL };
    expect(bookingRescheduledEmail({ ...base, calendarUrl: "", moveUrl: "" })).toEqual(bookingRescheduledEmail(base));
    expect(bookingConfirmationEmail({ ...base, moveUrl: "" })).toEqual(bookingConfirmationEmail(base));
    const { html, text } = bookingRescheduledEmail(base);
    expect(html).not.toContain("Change the time");
    expect(text).not.toContain("Add to your calendar");
  });
});

describe("bookingMovedAlertEmail — the business hears the customer moved it (F-048)", () => {
  const input = {
    brand, whenCompanyZone: "Tue, Aug 26, 2:00 PM CDT", newWhenCompanyZone: "Thu, Aug 28, 10:00 AM CDT",
    contactName: "Jane Doe", contactUrl: CONTACT_URL,
  };

  it("carries BOTH times, in words, in the subject and both parts, and links the contact (mutation: drop the old time → FAILS)", () => {
    const { subject, html, text } = bookingMovedAlertEmail(input);
    expect(subject).toBe("Booking moved: Tue, Aug 26, 2:00 PM CDT to Thu, Aug 28, 10:00 AM CDT — Jane Doe");
    for (const part of [html, text]) {
      expect(part).toContain(input.whenCompanyZone);
      expect(part).toContain(input.newWhenCompanyZone);
      expect(part).toContain("Jane Doe moved their booking.");
      expect(part).toContain(CONTACT_URL);
    }
    expect(text).toContain(`Was: ${input.whenCompanyZone}`);
    expect(text).toContain(`Now: ${input.newWhenCompanyZone}`);
    // Words between the times, never an arrow (DESIGN.md: a delta is words).
    expect(`${subject}${text}`).not.toMatch(/→|->/);
  });

  it("is written out in Spanish for a Spanish account (S-10); English stays the default, byte-identical (mutation: drop the es copy → FAILS)", () => {
    const es = bookingMovedAlertEmail({ ...input, locale: "es" });
    expect(es.subject).toBe(`Cita cambiada: ${input.whenCompanyZone} a ${input.newWhenCompanyZone} — Jane Doe`);
    for (const part of [es.html, es.text]) {
      expect(part).toContain("Jane Doe cambió su cita.");
      expect(part).toContain("Abrir este contacto");
    }
    expect(es.text).toContain(`Antes: ${input.whenCompanyZone}`);
    expect(es.text).toContain(`Ahora: ${input.newWhenCompanyZone}`);
    expect(es.text).toContain("Quién: Jane Doe");
    expect(bookingMovedAlertEmail({ ...input, locale: "en" })).toEqual(bookingMovedAlertEmail(input));
  });

  it("escapes a hostile name in html, strips CR/LF from the subject, and omits the button with no url", () => {
    const { subject, html, text } = bookingMovedAlertEmail({ ...input, contactName: "<b>x</b>\r\nBcc: a@b.c", contactUrl: null });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).not.toContain("Open this contact");
    expect(text).not.toContain("Open this contact");
  });
});

describe("the reminder in Spanish (spec §11.1, C11)", () => {
  const brand = {
    name: "Rio Roofing", logoUrl: null,
    accent: { accent: "#6D28D9", accentForeground: "#ffffff" } as Parameters<typeof bookingReminderEmail>[0]["brand"]["accent"],
  };
  it("subject, intro, video button and cancel link are Spanish when locale is es (mutation: ignore locale -> FAILS)", () => {
    expect(bookingReminderSubject("es")).toBe("Recordatorio: su próxima cita");
    expect(bookingReminderSubject()).toBe("Reminder: your upcoming booking");
    const { html, text } = bookingReminderEmail({ brand, whenBookerZone: "sáb, 17 de oct", cancelUrl: "https://x/c?locale=es", meetingUrl: "https://m", locale: "es" });
    expect(text).toContain("Le recordamos su próxima cita.");
    expect(text).toContain("Entrar a la videollamada: https://m");
    expect(text).toContain("Cancelar esta cita: https://x/c?locale=es");
    expect(html).toContain("Entrar a la videollamada");
    expect(text).not.toMatch(/reminder|Cancel this/);
  });
  it("no locale is today's English, byte for byte (mutation: default to es -> FAILS)", () => {
    const { text } = bookingReminderEmail({ brand, whenBookerZone: "Sat, Oct 17", cancelUrl: "https://x/c" });
    expect(text).toBe("This is a reminder for your upcoming booking.\n\nSat, Oct 17\n\nCancel this booking: https://x/c");
  });
});

/**
 * F-046 part 1 (spec 6.6, owner decision 4): a job staff put on the calendar tells the customer WHERE, on one
 * line ("Where" / "Dónde"), in both parts. Only the address: the job's own "what" line never reaches them
 * (the templates have no field for it). No address, no row: never an empty label.
 */
describe("the Where line on the confirmation and the moved email (F-046)", () => {
  const WHERE = "Home · 1 Main St & 2nd <Apt>";
  const base = { brand, whenBookerZone: WHEN_BOOKER, whenCompanyZone: WHEN_BOOKER, cancelUrl: CANCEL_URL };
  const templates = [
    ["bookingConfirmationEmail", bookingConfirmationEmail],
    ["bookingRescheduledEmail", bookingRescheduledEmail],
  ] as const;

  for (const [name, render] of templates) {
    for (const locale of ["en", "es"] as const) {
      const label = locale === "es" ? "Dónde" : "Where";
      it(`${name}, ${locale}: a where renders a "${label}" row in the html (escaped) and the text (mutation: drop the row → FAILS)`, () => {
        const { html, text } = render({ ...base, locale, where: WHERE });
        expect(html).toContain(`>${label}</td>`);
        expect(html).toContain("Home · 1 Main St &amp; 2nd &lt;Apt&gt;");
        expect(html).not.toContain("<Apt>");
        expect(text).toContain(`${label}: ${WHERE}`);
      });

      it(`${name}, ${locale}: no where, or "", renders no row at all (mutation: always render the row → FAILS)`, () => {
        const without = render({ ...base, locale });
        expect(render({ ...base, locale, where: "" })).toEqual(without);
        expect(without.html).not.toContain(`>${label}</td>`);
        expect(without.text).not.toContain(`${label}:`);
      });
    }
  }
});

/**
 * S-10 (booking alerts): the OWNER's booking mail arrives in the account's
 * language (spec 2026-10-31-spanish-dashboard-design.md §3.3, DESIGN.md "A
 * customer's language"): one message, one language, end to end, in both
 * parts. The templates still format nothing: each when-string is the
 * caller's, formatted by `formatWhen` in the account's zone AND language, so
 * these tests hand in a real Spanish rendering and assert it arrives intact
 * beside Spanish labels. The English half pins today's exact text.
 */
describe("S-10: the owner's booking alerts in Spanish, and English unchanged", () => {
  const AT = new Date("2026-09-01T14:00:00Z");
  const AT2 = new Date("2026-09-03T16:30:00Z");
  const W_EN = formatWhen(AT, "America/Chicago");
  const W2_EN = formatWhen(AT2, "America/Chicago");
  const W_ES = formatWhen(AT, "America/Chicago", "es");
  const W2_ES = formatWhen(AT2, "America/Chicago", "es");
  // English words that must never appear in a Spanish owner alert.
  const ENGLISH = /\b(New booking|booked a time|When|Who|Note|Was|Now|Called from|Number not shown|Open this contact|by phone|moved their|cancelled their|Booking (moved|cancelled))\b/;

  it("the Spanish date really differs from the English one (else every date assertion below could pass vacuously)", () => {
    expect(W_ES).not.toBe(W_EN);
    expect(W2_ES).not.toBe(W2_EN);
  });

  describe("bookingAlertEmail + bookingAlertSubject", () => {
    const input = { brand, whenCompanyZone: W_ES, contactName: "Ana Ruiz", note: "Llamar antes", contactUrl: CONTACT_URL };

    it("es: subject, heading, sentence, every row label, the date and the button are Spanish, in both parts (mutation: hard-code \"en\" at any one t() call → FAILS)", () => {
      expect(bookingAlertSubject(W_ES, "Ana\r\nRuiz", "es")).toBe(`Nueva cita: ${W_ES} — Ana Ruiz`);
      const { html, text } = bookingAlertEmail({ ...input, locale: "es" });
      expect(text).toBe(
        `Nueva cita de Ana Ruiz.\n\nCuándo: ${W_ES}\nQuién: Ana Ruiz\nNota: Llamar antes\n\nAbrir este contacto: ${CONTACT_URL}`,
      );
      expect(html).toContain(">Nueva cita</p>");
      expect(html).toContain("Ana Ruiz agendó una cita con usted.");
      for (const label of ["Cuándo", "Quién", "Nota"]) expect(html).toContain(`>${label}</td>`);
      expect(html).toContain(W_ES);
      expect(html).toContain(">Abrir este contacto<");
      expect(html).not.toMatch(ENGLISH);
      expect(text).not.toMatch(ENGLISH);
    });

    it("en: no locale is today's text and subject, byte for byte, and equals an explicit \"en\" (mutation: default the locale to \"es\" → FAILS)", () => {
      expect(bookingAlertSubject(W_EN, "Ana\r\nRuiz")).toBe(`New booking: ${W_EN} — Ana Ruiz`);
      const en = bookingAlertEmail({ ...input, whenCompanyZone: W_EN, note: "Call ahead" });
      expect(en.text).toBe(
        `New booking from Ana Ruiz.\n\nWhen: ${W_EN}\nWho: Ana Ruiz\nNote: Call ahead\n\nOpen this contact: ${CONTACT_URL}`,
      );
      expect(en.html).toContain(">New booking</p>");
      expect(en.html).toContain("Ana Ruiz booked a time with you.");
      expect(bookingAlertEmail({ ...input, whenCompanyZone: W_EN, note: "Call ahead", locale: "en" })).toEqual(en);
    });
  });

  describe("bookingCancelNoticeEmail (the customer cancelled from their link)", () => {
    it("es: subject and text in Spanish with the Spanish date; text-only, as on main (mutation: hard-code \"en\" → FAILS)", () => {
      const es = bookingCancelNoticeEmail({ whenCompanyZone: W_ES, contactName: "Ana\nRuiz", note: "Otra vez", locale: "es" });
      expect(es).toEqual({
        subject: `Cita cancelada: ${W_ES} — Ana Ruiz`,
        text: `Ana\nRuiz canceló su cita.\n\nCuándo: ${W_ES}\nNota: Otra vez`,
      });
    });

    it("en: today's subject and text, byte for byte, with and without a note (mutation: drop the note line → FAILS)", () => {
      expect(bookingCancelNoticeEmail({ whenCompanyZone: W_EN, contactName: "Maria Lopez", note: null })).toEqual({
        subject: `Booking cancelled: ${W_EN} — Maria Lopez`,
        text: `Maria Lopez cancelled their booking.\n\nWhen: ${W_EN}`,
      });
      expect(bookingCancelNoticeEmail({ whenCompanyZone: W_EN, contactName: "Maria Lopez", note: "Later", locale: "en" }).text)
        .toBe(`Maria Lopez cancelled their booking.\n\nWhen: ${W_EN}\nNote: Later`);
    });
  });

  describe("bookingPhoneChangeAlertEmail", () => {
    const base = { brand, contactName: "Ana Ruiz", callerNumber: "+19562921696", contactUrl: CONTACT_URL };

    it("es, cancelled: subject, heading, sentence, labels, date and button in Spanish, both parts (mutation: hard-code \"en\" → FAILS)", () => {
      const { subject, html, text } = bookingPhoneChangeAlertEmail({ ...base, kind: "cancelled", whenCompanyZone: W_ES, locale: "es" });
      expect(subject).toBe(`Cita cancelada por teléfono: ${W_ES} — Ana Ruiz`);
      expect(text).toBe(
        `Cita cancelada por teléfono.\nAna Ruiz canceló su cita por teléfono.\n\nCuándo: ${W_ES}\nQuién: Ana Ruiz\n`
        + `Llamó desde: +19562921696\n\nAbrir este contacto: ${CONTACT_URL}`,
      );
      expect(html).toContain(">Cita cancelada por teléfono</p>");
      expect(html).toContain("Ana Ruiz canceló su cita por teléfono.");
      for (const label of ["Cuándo", "Quién", "Llamó desde"]) expect(html).toContain(`>${label}</td>`);
      expect(html).toContain(W_ES);
      expect(html).toContain(">Abrir este contacto<");
      for (const part of [subject, html, text]) expect(part).not.toMatch(ENGLISH);
    });

    it("es, moved: both Spanish dates in words (\"a\", never an arrow), Antes/Ahora rows, and a hidden number in Spanish (mutation: drop the es twin of numberHidden → FAILS)", () => {
      const { subject, html, text } = bookingPhoneChangeAlertEmail({
        ...base, kind: "moved", whenCompanyZone: W_ES, newWhenCompanyZone: W2_ES, callerNumber: null, locale: "es",
      });
      expect(subject).toBe(`Cita cambiada por teléfono: ${W_ES} a ${W2_ES} — Ana Ruiz`);
      expect(text).toBe(
        `Cita cambiada por teléfono.\nAna Ruiz cambió su cita por teléfono.\n\nAntes: ${W_ES}\nAhora: ${W2_ES}\n`
        + `Quién: Ana Ruiz\nLlamó desde: Número oculto\n\nAbrir este contacto: ${CONTACT_URL}`,
      );
      for (const label of ["Antes", "Ahora", "Quién", "Llamó desde"]) expect(html).toContain(`>${label}</td>`);
      expect(html).toContain("Número oculto");
      expect(html).toContain(W2_ES);
      for (const part of [subject, html, text]) expect(part).not.toMatch(ENGLISH);
      expect(`${subject}${text}`).not.toMatch(/→|->/);
    });

    it("en: no locale is today's subject and text for both kinds, byte for byte, and equals an explicit \"en\" (mutation: default to \"es\" → FAILS)", () => {
      const cancelled = bookingPhoneChangeAlertEmail({ ...base, kind: "cancelled", whenCompanyZone: W_EN });
      expect(cancelled.subject).toBe(`Booking cancelled by phone: ${W_EN} — Ana Ruiz`);
      expect(cancelled.text).toBe(
        `Booking cancelled by phone.\nAna Ruiz cancelled their booking by phone.\n\nWhen: ${W_EN}\nWho: Ana Ruiz\n`
        + `Called from: +19562921696\n\nOpen this contact: ${CONTACT_URL}`,
      );
      const moved = bookingPhoneChangeAlertEmail({ ...base, kind: "moved", whenCompanyZone: W_EN, newWhenCompanyZone: W2_EN, callerNumber: null });
      expect(moved.subject).toBe(`Booking moved by phone: ${W_EN} to ${W2_EN} — Ana Ruiz`);
      expect(moved.text).toBe(
        `Booking moved by phone.\nAna Ruiz moved their booking by phone.\n\nWas: ${W_EN}\nNow: ${W2_EN}\n`
        + `Who: Ana Ruiz\nCalled from: Number not shown\n\nOpen this contact: ${CONTACT_URL}`,
      );
      expect(bookingPhoneChangeAlertEmail({ ...base, kind: "cancelled", whenCompanyZone: W_EN, locale: "en" })).toEqual(cancelled);
    });
  });

  describe("bookingMovedAlertEmail (the customer moved it from their link)", () => {
    const input = { brand, whenCompanyZone: W_ES, newWhenCompanyZone: W2_ES, contactName: "Ana Ruiz", contactUrl: CONTACT_URL };

    it("es: the whole text, the subject and the html rows in Spanish with both Spanish dates (mutation: hard-code \"en\" at the subject → FAILS)", () => {
      const { subject, html, text } = bookingMovedAlertEmail({ ...input, locale: "es" });
      expect(subject).toBe(`Cita cambiada: ${W_ES} a ${W2_ES} — Ana Ruiz`);
      expect(text).toBe(
        `Cita cambiada.\nAna Ruiz cambió su cita.\n\nAntes: ${W_ES}\nAhora: ${W2_ES}\nQuién: Ana Ruiz\n\nAbrir este contacto: ${CONTACT_URL}`,
      );
      expect(html).toContain(">Cita cambiada</p>");
      for (const label of ["Antes", "Ahora", "Quién"]) expect(html).toContain(`>${label}</td>`);
      for (const part of [subject, html, text]) expect(part).not.toMatch(ENGLISH);
    });

    it("en: no locale is today's subject and text, byte for byte (mutation: default to \"es\" → FAILS)", () => {
      const en = bookingMovedAlertEmail({ ...input, whenCompanyZone: W_EN, newWhenCompanyZone: W2_EN });
      expect(en.subject).toBe(`Booking moved: ${W_EN} to ${W2_EN} — Ana Ruiz`);
      expect(en.text).toBe(
        `Booking moved.\nAna Ruiz moved their booking.\n\nWas: ${W_EN}\nNow: ${W2_EN}\nWho: Ana Ruiz\n\nOpen this contact: ${CONTACT_URL}`,
      );
    });
  });

  it("ownerAlertFallbackName: \"Someone\" in English, \"Alguien\" in Spanish (mutation: return the English word for both → FAILS)", () => {
    expect(ownerAlertFallbackName("en")).toBe("Someone");
    expect(ownerAlertFallbackName()).toBe("Someone");
    expect(ownerAlertFallbackName("es")).toBe("Alguien");
  });
});
