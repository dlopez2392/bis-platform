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
  it("reads spf, dkim with its domain, dmarc, dmarc's header.from and both verdicts (mutation: read the LAST matching header → the forged bank.com dkim, FAILS)", () => {
    const v = readSesVerdict(parseHeaderBlock(raw(SES, `${FORGED}\r\n`)));
    expect(v).toEqual({ found: true, spf: "pass", dmarc: "pass", dmarcDomain: "gmail.com", dkim: [{ result: "pass", domain: "gmail.com" }], spam: "PASS", virus: "PASS" });
  });

  it("ignores an Authentication-Results from any other authserv-id, even above (mutation: take the first header of any id → mx.google.com's fail is read, FAILS)", () => {
    const other = "Authentication-Results: mx.google.com; spf=fail; dkim=fail; dmarc=fail";
    const v = readSesVerdict(parseHeaderBlock(raw(`${other}\r\n${SES}`)));
    expect(v.spf).toBe("pass");
  });

  it("no amazonses.com header reads as not found, every field null (mutation: default spf to 'pass' → FAILS)", () => {
    expect(readSesVerdict(parseHeaderBlock(raw("X-Other: 1")))).toEqual({ found: false, spf: null, dmarc: null, dmarcDomain: null, dkim: [], spam: null, virus: null });
  });

  it("reads header.d when there is no header.i", () => {
    const v = readSesVerdict(parseHeaderBlock(raw("Authentication-Results: amazonses.com; spf=pass; dkim=pass header.d=shop.example; dmarc=none")));
    expect(v.dkim).toEqual([{ result: "pass", domain: "shop.example" }]);
  });

  // CRITICAL 2 (review, round 1): a sender-controlled quoted value
  // (`envelope-from="a;dmarc=pass"@evil.com`) must not be split on its
  // embedded `;` — that would manufacture a fake extra "dmarc=" token ahead
  // of the real one. Here the real dmarc is "fail", so a naive split would
  // read the injected "pass" first and authenticate a spoofed sender.
  it("does not split a quoted value's embedded ';' into a fake extra token (mutation: split blindly on ';' → the injected 'dmarc=pass' is read, FAILS)", () => {
    const injected = [
      "Authentication-Results: amazonses.com;",
      ' spf=fail (dummy) envelope-from="a;dmarc=pass"@evil.com; helo=mail.evil.com;',
      " dkim=fail;",
      " dmarc=fail header.from=customer.com;",
    ].join("\r\n");
    const v = readSesVerdict(parseHeaderBlock(raw(injected)));
    expect(v.spf).toBe("fail");
    expect(v.dmarc).toBe("fail");
  });

  // CRITICAL 2, second probe: an unquoted but out-of-place "dmarc=pass"
  // ahead of the real "dmarc=fail" must not win by virtue of being first —
  // a repeated method inside one Authentication-Results header is itself
  // the attack, so it fails closed instead of trusting either occurrence.
  it("fails closed (nulls the field) when spf or dmarc appears more than once in one header (mutation: keep the first occurrence → the fake 'dmarc=pass' wins, FAILS)", () => {
    const duplicateDmarc = "Authentication-Results: amazonses.com; helo=x;dmarc=pass; dkim=fail; dmarc=fail";
    const v1 = readSesVerdict(parseHeaderBlock(raw(duplicateDmarc)));
    expect(v1.dmarc).toBeNull();

    const duplicateSpf = "Authentication-Results: amazonses.com; spf=pass; spf=fail; dmarc=none";
    const v2 = readSesVerdict(parseHeaderBlock(raw(duplicateSpf)));
    expect(v2.spf).toBeNull();
  });

  // CRITICAL (review, round 2): a backslash escapes the next character
  // inside BOTH a quoted string and a comment (RFC 8601's own grammar).
  // Without tracking escapes, a sender can plant an escaped quote or an
  // escaped `)` that fools the tokenizer into ending the quote/comment
  // early, letting a forged "dmarc=pass header.from=customer.com" segment
  // slip past it. The real tail after each probe is the same:
  // `dkim=fail header.i=@customer.com; dmarc=fail header.from=customer.com;`
  // — the honest verdict is "not authenticated" every time. Each probe also
  // carries PASS spam/virus verdicts, so a `senderAuthenticated` false comes
  // from the injection defense, not from an incidental missing header.
  const REAL_TAIL = "dkim=fail header.i=@customer.com; dmarc=fail header.from=customer.com;";
  const SES_PASS = "X-SES-Spam-Verdict: PASS\r\nX-SES-Virus-Verdict: PASS";

  it("an escaped quote inside a quoted value does not end the quote early (mutation: ignore backslash escapes → the forged dmarc=pass escapes the quote and wins, FAILS)", () => {
    const header = `Authentication-Results: amazonses.com; spf=fail; helo=x;dmarc=pass header.from=customer.com;y";${REAL_TAIL}\r\n${SES_PASS}`;
    const v = readSesVerdict(parseHeaderBlock(raw(header)));
    expect(senderAuthenticated(v, "customer.com")).toBe(false);
  });

  it("an escaped ')' inside a comment does not end the comment early (mutation: ignore backslash escapes in comments → the forged dmarc=pass escapes the comment and wins, FAILS)", () => {
    const header = `Authentication-Results: amazonses.com; spf=fail; helo=x;dmarc=pass header.from=customer.com;(y;${REAL_TAIL}\r\n${SES_PASS}`;
    const v = readSesVerdict(parseHeaderBlock(raw(header)));
    expect(senderAuthenticated(v, "customer.com")).toBe(false);
  });

  it("a scan that ENDS still inside a quote or a comment reads as not found (mutation: still return found:true when unterminated → FAILS)", () => {
    const header = `Authentication-Results: amazonses.com; spf=fail; envelope-from="a\\";dmarc=pass header.from=customer.com;\\"@evil.com;${REAL_TAIL}\r\n${SES_PASS}`;
    const v = readSesVerdict(parseHeaderBlock(raw(header)));
    expect(v.found).toBe(false);
    expect(senderAuthenticated(v, "customer.com")).toBe(false);
  });

  it("a comment after dmarc=pass's header.from still fails closed (pin: already true today)", () => {
    const header = `Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@customer.com; dmarc=pass header.from=customer.com(x)\r\n${SES_PASS}`;
    const v = readSesVerdict(parseHeaderBlock(raw(header)));
    expect(senderAuthenticated(v, "customer.com")).toBe(false);
  });

  it("the spike's real Gmail header, and a dmarc=pass with a (p=none) comment, still authenticate", () => {
    const v1 = readSesVerdict(parseHeaderBlock(raw(SES)));
    expect(senderAuthenticated(v1, "gmail.com")).toBe(true);

    const withComment = `Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@gmail.com; dmarc=pass (p=none) header.from=gmail.com;\r\n${SES_PASS}`;
    const v2 = readSesVerdict(parseHeaderBlock(raw(withComment)));
    expect(senderAuthenticated(v2, "gmail.com")).toBe(true);
  });
});

describe("senderAuthenticated (spec Inbound step 4)", () => {
  const v = (over: Partial<ReturnType<typeof readSesVerdict>>) => ({ found: true, spf: "pass", dmarc: "pass", dmarcDomain: "gmail.com", dkim: [{ result: "pass", domain: "gmail.com" }], spam: "PASS", virus: "PASS", ...over });

  it("dmarc=pass with both verdicts PASS → true", () => {
    expect(senderAuthenticated(v({}), "gmail.com")).toBe(true);
  });

  // CRITICAL 1 (review, round 1): dmarc=pass alone proves the message
  // aligned with SOME domain — it says nothing about which one without
  // reading dmarc's own header.from and binding it to the From address,
  // exactly as G15 already binds DKIM's header.i/header.d. Without this, a
  // dmarc=pass stamped for evil.com would authenticate a From of
  // customer.com.
  it("dmarc=pass does not authenticate unless its header.from matches the From domain exactly (mutation: drop the dmarcDomain check → FAILS)", () => {
    expect(senderAuthenticated(v({ dmarc: "pass", dmarcDomain: "evil.com" }), "customer.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: "pass", dmarcDomain: "gmail.com" }), "gmail.com")).toBe(true);
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
