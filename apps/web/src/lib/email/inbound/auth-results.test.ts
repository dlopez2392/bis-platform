import { describe, it, expect } from "vitest";
import { parseHeaderBlock, readSesVerdict, senderAuthenticated, authRecord } from "./auth-results";

const SES = [
  "Authentication-Results: amazonses.com;",
  " spf=pass (spfCheck: domain of gmail.com designates 209.85.0.1 as permitted sender) client-ip=209.85.0.1; envelope-from=ana@gmail.com; helo=mail.gmail.com;",
  " dkim=pass header.i=@gmail.com;",
  " dmarc=pass header.from=gmail.com;",
  "X-SES-Spam-Verdict: PASS",
  "X-SES-Virus-Verdict: PASS",
].join("\r\n");
const FORGED = "Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@bank.com; dmarc=pass header.from=bank.com;";
const raw = (top: string, rest = "") => `${top}\r\nFrom: Ana <ana@gmail.com>\r\nSubject: Re: Hi\r\n${rest}\r\nbody line\r\n`;

describe("parseHeaderBlock", () => {
  it("stops at the first blank line, lowercases names, unfolds continuation lines, keeps order (mutation: read past the blank line → 'body line' is a header, FAILS)", () => {
    const h = parseHeaderBlock(raw(SES));
    expect(h[0]![0]).toBe("authentication-results");
    expect(h[0]![1]).toContain("dkim=pass header.i=@gmail.com;");
    expect(h.map(([n]) => n)).toEqual(["authentication-results", "x-ses-spam-verdict", "x-ses-virus-verdict", "from", "subject"]);
  });
});

describe("readSesVerdict: ONLY the topmost amazonses.com header (spec 'Rule from the spike')", () => {
  it("reads spf, dkim with its domain, dmarc and both verdicts (mutation: read the LAST matching header → the forged bank.com dkim, FAILS)", () => {
    const v = readSesVerdict(parseHeaderBlock(raw(SES, `${FORGED}\r\n`)));
    expect(v).toEqual({ found: true, spf: "pass", dmarc: "pass", dkim: [{ result: "pass", domain: "gmail.com" }], spam: "PASS", virus: "PASS" });
  });

  it("ignores an Authentication-Results from any other authserv-id, even above (mutation: take the first header of any id → mx.google.com's fail is read, FAILS)", () => {
    const other = "Authentication-Results: mx.google.com; spf=fail; dkim=fail; dmarc=fail";
    const v = readSesVerdict(parseHeaderBlock(raw(`${other}\r\n${SES}`)));
    expect(v.spf).toBe("pass");
  });

  it("no amazonses.com header reads as not found, every field null (mutation: default spf to 'pass' → FAILS)", () => {
    expect(readSesVerdict(parseHeaderBlock(raw("X-Other: 1")))).toEqual({ found: false, spf: null, dmarc: null, dkim: [], spam: null, virus: null });
  });

  it("reads header.d when there is no header.i", () => {
    const v = readSesVerdict(parseHeaderBlock(raw("Authentication-Results: amazonses.com; spf=pass; dkim=pass header.d=shop.example; dmarc=none")));
    expect(v.dkim).toEqual([{ result: "pass", domain: "shop.example" }]);
  });
});

describe("senderAuthenticated (spec Inbound step 4)", () => {
  const v = (over: Partial<ReturnType<typeof readSesVerdict>>) => ({ found: true, spf: "pass", dmarc: "pass", dkim: [{ result: "pass", domain: "gmail.com" }], spam: "PASS", virus: "PASS", ...over });

  it("dmarc=pass with both verdicts PASS → true", () => {
    expect(senderAuthenticated(v({}), "gmail.com")).toBe(true);
  });

  it("dmarc=none: true only with spf=pass AND a passing dkim ON the From domain (mutation: accept spf alone → FAILS; accept any dkim domain → FAILS)", () => {
    expect(senderAuthenticated(v({ dmarc: "none" }), "gmail.com")).toBe(true);
    expect(senderAuthenticated(v({ dmarc: "none", spf: "softfail" }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: "none", dkim: [{ result: "pass", domain: "other.com" }] }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: "none", dkim: [{ result: "fail", domain: "gmail.com" }] }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: "none", dkim: [{ result: "pass", domain: "mail.gmail.com" }] }), "gmail.com")).toBe(false);   // G15: exact
  });

  it("dmarc fail, missing headers, or a verdict other than PASS → false (mutation: skip the verdict check → the FAIL spam case is true, FAILS)", () => {
    expect(senderAuthenticated(v({ dmarc: "fail" }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: null }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ spam: "FAIL" }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ virus: null }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ found: false }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({}), null)).toBe(false);
  });

  it("authRecord keeps what the row stores (mutation: drop dkim → FAILS)", () => {
    expect(authRecord(v({ dkim: [{ result: "fail", domain: "x.com" }, { result: "pass", domain: "gmail.com" }] }))).toEqual({ spf: "pass", dkim: "fail,pass", dmarc: "pass", spam: "PASS", virus: "PASS" });
  });
});
