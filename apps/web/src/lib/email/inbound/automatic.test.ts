import { describe, it, expect } from "vitest";
import { parseHeaderBlock } from "./auth-results";
import { classifyAutomatic } from "./automatic";

/** S-06 part 2, spec "Pipeline order" 1 and "Tests". Real header blocks through the real parser. */
const H = (block: string) => parseHeaderBlock(block);
const GMAIL_REPLY = H([
  "Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;",
  "From: Ana Ruiz <ana@gmail.com>",
  "Subject: Re: Thursday",
  "Content-Type: multipart/alternative; boundary=\"000000000000abc\"",
  "",
  "body",
].join("\r\n"));

describe("classifyAutomatic", () => {
  it("a normal Gmail reply is none (mutation: treat any Content-Type multipart as a report → FAILS)", () => {
    expect(classifyAutomatic(GMAIL_REPLY, "ana@gmail.com")).toBe("none");
  });

  it("Auto-Submitted present and not 'no' is automatic, any value or case; 'no' is none (mutation: only 'auto-replied' → auto-generated passes, FAILS)", () => {
    expect(classifyAutomatic(H("Auto-Submitted: auto-replied\r\n"), "ana@gmail.com")).toBe("automatic");
    expect(classifyAutomatic(H("auto-submitted: Auto-Generated\r\n"), "ana@gmail.com")).toBe("automatic");
    expect(classifyAutomatic(H("Auto-Submitted: auto-replied; owner-email=\"a@b.com\"\r\n"), "ana@gmail.com")).toBe("automatic");
    expect(classifyAutomatic(H("Auto-Submitted: No\r\n"), "ana@gmail.com")).toBe("none");
    expect(classifyAutomatic(H("Auto-Submitted: no (a person wrote this)\r\n"), "ana@gmail.com")).toBe("none");
  });

  it("auto-forwarded alone is its own class; beside any other marker it is automatic (G10 as ruled; mutation: answer automatic for auto-forwarded → a teammate's rule drops, FAILS; let auto-forwarded win over Precedence: bulk → a forwarded newsletter files, FAILS)", () => {
    expect(classifyAutomatic(H("Auto-Submitted: Auto-Forwarded\r\n"), "maria@rio.com")).toBe("auto_forwarded");
    expect(classifyAutomatic(H("Auto-Submitted: auto-forwarded\r\nPrecedence: bulk\r\n"), "maria@rio.com")).toBe("automatic");
    expect(classifyAutomatic(H("Precedence: bulk\r\nAuto-Submitted: auto-forwarded\r\n"), "maria@rio.com")).toBe("automatic");
    expect(classifyAutomatic(H("Auto-Submitted: auto-forwarded\r\n"), "mailer-daemon@rio.com")).toBe("automatic");
  });

  it("X-Autoreply, X-Autorespond or X-Autoresponse present is automatic (mutation: drop X-Autorespond → FAILS)", () => {
    for (const h of ["X-Autoreply: yes", "X-Autorespond: on", "X-AutoResponse: 1"]) expect(classifyAutomatic(H(`${h}\r\n`), "ana@gmail.com"), h).toBe("automatic");
  });

  it("Precedence auto_reply, bulk or junk is automatic; list is none (mutation: add list → a mailing-list reply drops, FAILS)", () => {
    for (const v of ["auto_reply", "bulk", "Junk"]) expect(classifyAutomatic(H(`Precedence: ${v}\r\n`), "ana@gmail.com"), v).toBe("automatic");
    expect(classifyAutomatic(H("Precedence: list\r\n"), "ana@gmail.com")).toBe("none");
  });

  it("a delivery-status report is automatic; another multipart/report is none (mutation: match multipart/report alone → a read receipt drops, FAILS)", () => {
    expect(classifyAutomatic(H("Content-Type: multipart/report; report-type=delivery-status; boundary=\"b\"\r\n"), "x@example.com")).toBe("automatic");
    expect(classifyAutomatic(H("Content-Type: Multipart/Report; boundary=\"b\"; report-type=\"delivery-status\"\r\n"), "x@example.com")).toBe("automatic");
    expect(classifyAutomatic(H("Content-Type: multipart/report; report-type=disposition-notification; boundary=\"b\"\r\n"), "x@example.com")).toBe("none");
  });

  it("a mailer-daemon or postmaster sender is automatic, even with no raw headers (G9; mutation: return none when headers are null before the From check → FAILS)", () => {
    expect(classifyAutomatic(null, "mailer-daemon@googlemail.com")).toBe("automatic");
    expect(classifyAutomatic(GMAIL_REPLY, "postmaster@example.com")).toBe("automatic");
    expect(classifyAutomatic(null, "ana@gmail.com")).toBe("none");
    expect(classifyAutomatic(null, null)).toBe("none");
    expect(classifyAutomatic(GMAIL_REPLY, "mailer-daemon.fan@example.com")).toBe("none");
  });

  it("a marker below the top-level block (inside the body) is not read (mutation: scan the whole raw text → FAILS)", () => {
    expect(classifyAutomatic(H("From: a@b.com\r\n\r\nAuto-Submitted: auto-replied\r\n"), "a@b.com")).toBe("none");
  });
});
