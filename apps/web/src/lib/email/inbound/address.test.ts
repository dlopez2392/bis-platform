import { describe, it, expect } from "vitest";
import { BIS_REPLY_DOMAIN as DB_DOMAIN } from "@bis/db";
import { BIS_REPLY_DOMAIN, bareAddress, displayName, parseReplyAddress, replyAddressFor, domainOf } from "./address";

const T = "0123456789abcdef01234567";

describe("the reply address", () => {
  it("agrees with @bis/db's domain (mutation: change either literal → FAILS)", () => {
    expect(BIS_REPLY_DOMAIN).toBe(DB_DOMAIN);
  });

  it("parses r-<token>@domain, case-insensitively, with or without a display name (mutation: drop the lowercase → the uppercase form is null, FAILS)", () => {
    expect(parseReplyAddress(`r-${T}@reply.bis-rgv.com`)).toEqual({ token: T, domain: "reply.bis-rgv.com" });
    expect(parseReplyAddress(`"Rio" <R-${T.toUpperCase()}@Reply.Example.com>`)).toEqual({ token: T, domain: "reply.example.com" });
  });

  it("refuses anything that is not exactly one r- token (mutation: accept any length → the 23-char token parses, FAILS)", () => {
    for (const bad of [`r-${T.slice(1)}@reply.bis-rgv.com`, `${T}@reply.bis-rgv.com`, `r-${T}x@reply.bis-rgv.com`, `r-${T}`, "", `s-${T}@reply.bis-rgv.com`, `r-${T}@`]) {
      expect(parseReplyAddress(bad), bad).toBeNull();
    }
  });

  it("builds the Reply-To for bis and own_domain, nothing for off or own_domain without a domain (mutation: answer the BIS domain for own_domain → FAILS)", () => {
    expect(replyAddressFor(T, { mode: "bis", domain: "reply.example.com" })).toBe(`r-${T}@reply.bis-rgv.com`);
    expect(replyAddressFor(T, { mode: "own_domain", domain: "reply.example.com" })).toBe(`r-${T}@reply.example.com`);
    expect(replyAddressFor(T, { mode: "own_domain", domain: null })).toBeNull();
    expect(replyAddressFor(T, { mode: "off", domain: null })).toBeNull();
  });

  it("reads a bare address and a display name out of a From value (mutation: keep the brackets → FAILS)", () => {
    expect(bareAddress("Ana Ruiz <Ana@Example.COM>")).toBe("ana@example.com");
    expect(bareAddress("ana@example.com")).toBe("ana@example.com");
    expect(bareAddress("not an address")).toBeNull();
    expect(displayName(`"Ana Ruiz" <ana@example.com>`)).toBe("Ana Ruiz");
    expect(displayName("ana@example.com")).toBeNull();
    expect(domainOf("ana@Mail.Example.com")).toBe("mail.example.com");
  });

  // CRITICAL 1 (review, round 1): a quoted display name can itself contain an
  // angle-addr, and an unquoted From can carry two. Either way there is more
  // than one address-shaped token in the value, so bareAddress must refuse
  // to guess and fail closed, rather than silently picking the first one
  // (which let a forged From win the sender's identity).
  it("refuses a From with more than one angle-addr, quoted or not (mutation: take the first angle-addr → the evil address wins, FAILS)", () => {
    expect(bareAddress(`"<ana@customer.com>" <x@evil.com>`)).toBeNull();
    expect(bareAddress(`Ana <ana@customer.com> <x@evil.com>`)).toBeNull();
  });

  it("refuses a From whose only angle-addr sits inside a quoted string (mutation: use the quoted address anyway → FAILS)", () => {
    expect(bareAddress(`"<ana@evil.com>"`)).toBeNull();
  });

  // M4: a quoted fake address collapses displayName's result to a bare
  // quote character with no letter in it — not a name.
  it("displayName with no letter in the result is null, not a lone quote (mutation: drop the letter check → the quote mark is returned, FAILS)", () => {
    expect(displayName(`"<ana@customer.com>" <x@evil.com>`)).toBeNull();
  });

  // CRITICAL (review, round 2): a strict, fail-closed grammar replaces the
  // case-by-case patching. Only a bare addr-spec, or an optional display
  // then exactly one angle-addr that ENDS the value, is accepted; anything
  // else — a trailing comment, trailing junk after the angle-addr, or a
  // backslash-escape trick inside a quoted display — is refused outright.
  // Review round 3: pinned by the grammar's shape, not by the explicit
  // `includes("(")` guard in bareAddress. Verified (and reverted) two ways:
  // deleting the guard line leaves this test green (the regexes' own
  // character classes already exclude "("), AND widening just the
  // domain-label charset to allow "(" ALSO leaves it green, because the
  // string ends in ")" while both BARE_RE and ANGLE_RE are anchored to end
  // in a bare addr-spec or ">" — an end-anchor mismatch no single
  // character-class widening can repair. No mutation of either regex or of
  // the `includes("(")` guard found during this review kills this specific
  // test; it is pinned by the grammar's overall end-anchored SHAPE rather
  // than by any one guard or charset, and is kept as a named regression
  // case for the real forgery this closes, not as evidence the test can
  // fail on demand.
  it("refuses a comment anywhere in the From, which closes the parenthetical forgery (pinned by the grammar's end-anchored shape; no single-line mutation found that fails this case — see comment above)", () => {
    expect(bareAddress("attacker@customer.com (<ana@customer.com>)")).toBeNull();
  });

  it("refuses trailing junk after the angle-addr (mutation: drop the end anchor → FAILS)", () => {
    expect(bareAddress("Ana <ana@customer.com> trailing")).toBeNull();
  });

  it("refuses a backslash-escape trick inside a quoted display (mutation: allow a backslash in the quoted content → FAILS)", () => {
    expect(bareAddress(`"a \\" b" <ana@customer.com>`)).toBeNull();
  });

  it("keeps a quoted display with a comma (mutation: exclude ',' from the quoted charset too → FAILS)", () => {
    expect(bareAddress(`"Ruiz, Ana" <Ana@Customer.com>`)).toBe("ana@customer.com");
    expect(displayName(`"Ruiz, Ana" <Ana@Customer.com>`)).toBe("Ruiz, Ana");
  });
});
