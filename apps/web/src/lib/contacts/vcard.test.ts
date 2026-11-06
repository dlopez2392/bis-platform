import { describe, expect, it } from "vitest";
import {
  looksLikeVCard, parseVCardText, vCardContactsToRows, vCardFileTooLarge, decodeVCardBytes, vCardDisplayNames,
  MAX_VCARD_FILE_BYTES, VCARD_FIELDS,
} from "./vcard";
import { mapRows } from "./csv";
import { m as messages } from "@/lib/messages";

const CRLF = "\r\n";

describe("parseVCardText — real-shaped fixtures", () => {
  it("parses an iPhone 3.0 export: item1. groups stripped, N -> first/last, an escaped ORG semicolon unescaped (keeping only the org name), CRLF line endings", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:García;María;;;",
      "FN:María García",
      "item1.TEL:+1 555-010-0001",
      "item1.X-ABLabel:_$!<Mobile>!$_",
      "EMAIL;type=INTERNET;type=pref:maria@example.com",
      "ORG:Acme\\; Roofing;Consulting",
      "END:VCARD",
    ].join(CRLF);
    expect(parseVCardText(vcard)).toEqual([{
      firstName: "María", lastName: "García", email: "maria@example.com",
      phone: "+1 555-010-0001", company: "Acme; Roofing",
    }]);
  });

  it("unfolds a continuation line (RFC 6350) so a wrapped FN is not cut short (mutation: drop the fold-continuation branch in unfoldLines -> FAILS)", () => {
    // Folded mid-word, matching RFC 6350's own example: unfolding removes
    // exactly the ONE artificial leading space the fold inserted, so "Albert"
    // + "o Rodriguez..." must rejoin as "Alberto Rodriguez...", not
    // "AlbertoRodriguez..." (that would mean a REAL data space got eaten too).
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "FN:Carlos Albert",
      " o Rodriguez Fernandez",
      "TEL:5551230000",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.firstName).toBe("Carlos");
    expect(contact!.lastName).toBe("Alberto Rodriguez Fernandez");
  });

  it("decodes an Android 2.1 QUOTED-PRINTABLE UTF-8 name across a soft line break (mutation: make decodeValue always return prop.rawValue -> FAILS)", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "FN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Mar=C3=ADa Pe=",
      "=C3=B1a",
      "TEL:5550001111",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.firstName).toBe("María");
    expect(contact!.lastName).toBe("Peña");
  });

  it("decodes 2.1's bare QUOTED-PRINTABLE param (no ENCODING= prefix)", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N;QUOTED-PRINTABLE;CHARSET=UTF-8:Pe=C3=B1a;Ana;;;",
      "TEL:5550002222",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.firstName).toBe("Ana");
    expect(contact!.lastName).toBe("Peña");
  });

  it("prefers the CELL-typed phone over a HOME phone listed first (mutation: make phoneScore always return 0 -> FAILS)", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Lee;Sam;;;",
      "TEL;TYPE=HOME,VOICE:555-111-2222",
      "TEL;TYPE=CELL:555-333-4444",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.phone).toBe("555-333-4444");
  });

  it("recognises 2.1's bare CELL param (no TYPE= prefix) the same way", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:2.1", "N:Park;Jin;;;",
      "TEL;HOME:555-000-0000",
      "TEL;CELL:555-999-0000",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.phone).toBe("555-999-0000");
  });

  it("falls back to the first phone when none is typed CELL/mobile", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Ng;Wei;;;",
      "TEL;TYPE=HOME:555-444-5555",
      "TEL;TYPE=WORK:555-666-7777",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.phone).toBe("555-444-5555");
  });

  it("prefers a PREF/INTERNET-typed email over a plain WORK one listed first", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Diaz;Rosa;;;",
      "EMAIL;TYPE=WORK:rosa.work@example.com",
      "EMAIL;TYPE=INTERNET;TYPE=PREF:rosa.personal@example.com",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.email).toBe("rosa.personal@example.com");
  });

  // Fix round M-7(b) RULING: PREF is a 1-100 RANK, lower wins — not a flag
  // that's equally true for every PREF-marked entry regardless of its own
  // number. PREF=2 is written FIRST here so a tie-breaks-to-first rule
  // (the old behaviour, since both bare-matched \bPREF\b equally) would
  // pick the WRONG one.
  it("a lower PREF rank wins even when it appears SECOND in the file (mutation: drop the numeric PREF=N comparison -> the first email (PREF=2) wins instead -> FAILS)", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:4.0", "N:Cho;Min;;;",
      "EMAIL;PREF=2:min.second@example.com",
      "EMAIL;PREF=1:min.first@example.com",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.email).toBe("min.first@example.com");
  });

  it("reads a vCard 4.0 card: a tel: URI value stripped to the number, direct UTF-8 with no encoding param", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:4.0", "N:Peña;Luis;;;", "FN:Luis Peña",
      "TEL;VALUE=uri;TYPE=cell:tel:+1-555-777-8888",
      "EMAIL:luis@example.com",
      "END:VCARD",
    ].join(CRLF);
    expect(parseVCardText(vcard)).toEqual([{
      firstName: "Luis", lastName: "Peña", email: "luis@example.com", phone: "+1-555-777-8888",
    }]);
  });

  // Fix round M-7(a): the tel: URI (RFC 3966) can carry its OWN ";" params
  // (not vCard's own ";" syntax) — a extension number here, dropped along
  // with the scheme.
  it("strips a tel: URI's own ;params (e.g. ;ext=12), not just its scheme (mutation: drop the semicolon-strip in stripTelUri -> FAILS)", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:4.0", "N:Ruiz;Carla;;;",
      "TEL;VALUE=uri;TYPE=work:tel:+1-956-555-0101;ext=12",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.phone).toBe("+1-956-555-0101");
  });

  // Fix round M-6: renamed — this proves CORRECTNESS (the PHOTO data never
  // leaks, and the properties after it still parse), not efficiency; the
  // real speed claim is pinned separately below, where it can actually fail.
  it("skips a PHOTO block's many folded base64 lines, without losing the properties that follow it", () => {
    const chunk = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
    const photoLines = [`PHOTO;ENCODING=BASE64;TYPE=JPEG:${chunk}`,
      ...Array.from({ length: 500 }, () => ` ${chunk}`)];
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Kim;Ji;;;",
      ...photoLines,
      "TEL:555-222-3333", "EMAIL:ji@example.com", "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact).toEqual({ firstName: "Ji", lastName: "Kim", phone: "555-222-3333", email: "ji@example.com" });
    expect(JSON.stringify(contact)).not.toContain(chunk);
  });

  // Fix round M-1: the old join branch ran its string-copy (current =
  // current.slice(0,-1) + raw) for EVERY QP soft-break continuation line
  // regardless of whether the property was wanted, so a long QP-wrapped
  // NOTE or PHOTO was quadratic in its own line count. This NOTE is
  // "unwanted" (not in KEPT_PROPERTIES), so each of its ~14,000 continuation
  // lines must cost one flag check, never a copy.
  it("a ~1 MB QP-encoded NOTE (an unwanted property) finishes fast — linear, not quadratic (mutation: drop the `!currentIsUnwanted` guard in unfoldLines' QP-join branch -> exceeds the bound)", () => {
    const CHUNK = "A".repeat(69);
    const LINE_COUNT = Math.ceil(1_000_000 / 70);
    const bodyLines = Array.from({ length: LINE_COUNT }, (_, i) => (i === LINE_COUNT - 1 ? CHUNK : `${CHUNK}=`));
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Speed;Test;;;",
      `NOTE;ENCODING=QUOTED-PRINTABLE:${bodyLines[0]}`,
      ...bodyLines.slice(1),
      "TEL:5551112222", "EMAIL:speed@example.com", "END:VCARD",
    ].join(CRLF);
    const start = Date.now();
    const [contact] = parseVCardText(vcard);
    const elapsed = Date.now() - start;
    expect(contact).toEqual({ firstName: "Test", lastName: "Speed", phone: "5551112222", email: "speed@example.com" });
    expect(elapsed).toBeLessThan(500);
  });

  it("a card with no name, no phone and no email still returns an (empty) contact — mapRows is what skips and counts it", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "NOTE:just a note, nothing else", "END:VCARD"].join(CRLF);
    expect(parseVCardText(vcard)).toEqual([{}]);
  });

  it("falls back to splitting FN into first/last when N's components are all blank", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:;;;;", "FN:Jordan Baker", "TEL:5551112222", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.firstName).toBe("Jordan");
    expect(contact!.lastName).toBe("Baker");
  });

  it("keeps only ORG's first component (the org name), dropping a department/unit component", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Han;Mira;;;", "ORG:Acme Roofing;Field Ops", "TEL:5553334444", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.company).toBe("Acme Roofing");
  });

  // Fix round M-3(a) RULING: when N is blank and FN carries the SAME text
  // as ORG, this is a company card, not a person — splitting the business
  // name on its first space would invent a human first/last name from it.
  it("leaves first/last empty for a company card — FN equal to ORG, no N (mutation: drop the fnFallback !== company check -> FAILS)", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "FN:Acme Roofing", "ORG:Acme Roofing", "TEL:5551234567", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.firstName).toBeUndefined();
    expect(contact!.lastName).toBeUndefined();
    expect(contact!.company).toBe("Acme Roofing");
  });

  it("still splits FN into first/last when FN and ORG merely DIFFER (a person who also has an employer)", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "FN:Jordan Lee", "ORG:Acme Roofing", "TEL:5551234567", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.firstName).toBe("Jordan");
    expect(contact!.lastName).toBe("Lee");
    expect(contact!.company).toBe("Acme Roofing");
  });

  it("unescapes \\, \\; and \\\\ inside ORG, splitting only on a real (unescaped) semicolon", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Cruz;Ana;;;",
      "ORG:Smith\\; Jones\\, LLC\\\\Corp;Overflow",
      "TEL:5555556666", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.company).toBe("Smith; Jones, LLC\\Corp");
  });

  it("unescapes \\n to a real line break within a value", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "FN:Line one\\nLine two", "TEL:5557778888", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.lastName).toContain("\n");
  });

  it("ignores ADR and NOTE — no contact field carries their content", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Ortiz;Pablo;;;",
      "ADR:;;123 Main St;Phoenix;AZ;85001;US",
      "NOTE:Met at the trade show",
      "TEL:5559990000", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(JSON.stringify(contact)).not.toMatch(/Main St|trade show/);
  });

  it("reads multiple BEGIN/END blocks in one file", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Alpha;A;;;", "TEL:5551110000", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "N:Beta;B;;;", "TEL:5552220000", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "N:Gamma;C;;;", "TEL:5553330000", "END:VCARD",
    ].join(CRLF);
    const contacts = parseVCardText(vcard);
    expect(contacts.map((c) => c.lastName)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  // Fix round M-2(a): an AGENT's embedded vCard is the standard way a 2.1/3.0
  // card carries a SECOND person inline. It must be swallowed whole — never
  // allowed to reset the OUTER card's own already-collected properties.
  it("a nested AGENT card does not lose the outer card's own fields (mutation: always reset `current` on BEGIN:VCARD -> the outer Boss/Big card FAILS to appear)", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Boss;Big;;;", "TEL:5550001111",
      "AGENT:",
      "BEGIN:VCARD", "N:Assistant;Little;;;", "TEL:5559998888", "END:VCARD",
      "END:VCARD",
    ].join(CRLF);
    const contacts = parseVCardText(vcard);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toEqual({ firstName: "Big", lastName: "Boss", phone: "5550001111" });
  });

  // Fix round M-2(b): a card that forgot its own END:VCARD before the next
  // BEGIN:VCARD starts must still be recovered, not swallowed the way a
  // real nested AGENT card is (the two look identical except for that one
  // AGENT: line immediately before the inner BEGIN).
  it("a card with no END before the next BEGIN recovers BOTH cards (mutation: always treat a BEGIN inside an open card as nested -> Alpha is lost)", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Alpha;A;;;", "TEL:5551110000",
      "BEGIN:VCARD", "VERSION:3.0", "N:Beta;B;;;", "TEL:5552220000", "END:VCARD",
    ].join(CRLF);
    const contacts = parseVCardText(vcard);
    expect(contacts.map((c) => c.lastName)).toEqual(["Alpha", "Beta"]);
  });

  // Fix round M-2(c): a QP value's own stray trailing "=" must never be
  // read as a soft break onto a literal END:VCARD line. No second
  // BEGIN:VCARD follows here on purpose: M-2(b)'s own "missing END"
  // recovery would otherwise close this card anyway on the next BEGIN,
  // masking a swallowed END rather than proving it was recognised in
  // place. A stray TEL line sitting OUTSIDE any card (after the real END)
  // is the tell instead — it must stay outside and contribute nothing.
  it("a QP NOTE ending in a stray = does not swallow the card's own END:VCARD (mutation: drop the isStructuralLine guard in the QP-join branch -> a TEL line written AFTER the real END leaks into this card instead of being dropped)", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:One;Card;;;",
      "NOTE;ENCODING=QUOTED-PRINTABLE:Ends oddly=",
      "END:VCARD",
      "TEL:9999999999",
    ].join(CRLF);
    const contacts = parseVCardText(vcard);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toEqual({ firstName: "Card", lastName: "One" });
  });

  it("parses identically whether the file uses CRLF, LF or a lone CR", () => {
    const lines = ["BEGIN:VCARD", "VERSION:3.0", "N:Vega;Luz;;;", "TEL:5554440000", "EMAIL:luz@example.com", "END:VCARD"];
    const crlf = parseVCardText(lines.join("\r\n"));
    const lf = parseVCardText(lines.join("\n"));
    const cr = parseVCardText(lines.join("\r"));
    expect(lf).toEqual(crlf);
    expect(cr).toEqual(crlf);
  });

  it("reads property and keyword names case-insensitively", () => {
    const vcard = ["begin:vcard", "version:3.0", "n:Fox;Robin;;;", "tel:5556667777", "email:robin@example.com", "end:vcard"].join(CRLF);
    expect(parseVCardText(vcard)).toEqual([{ firstName: "Robin", lastName: "Fox", phone: "5556667777", email: "robin@example.com" }]);
  });

  it("strips a leading BOM so the first BEGIN:VCARD is still recognised", () => {
    const vcard = "﻿" + ["BEGIN:VCARD", "VERSION:3.0", "N:Soto;Eva;;;", "TEL:5558889999", "END:VCARD"].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.lastName).toBe("Soto");
  });

  it("still builds an unterminated trailing block (no closing END:VCARD) rather than dropping it", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Price;Tom;;;", "TEL:5551234567"].join(CRLF);
    const contacts = parseVCardText(vcard);
    expect(contacts).toEqual([{ firstName: "Tom", lastName: "Price", phone: "5551234567" }]);
  });

  it("an empty or unreadable file produces no contacts (never a crash)", () => {
    expect(parseVCardText("")).toEqual([]);
    expect(parseVCardText("not a vcard at all, just text")).toEqual([]);
  });
});

describe("the no-email-or-phone skip reuses mapRows' own reason (no new message needed)", () => {
  it("a card with nothing to match on is skipped and counted with the same reason a blank CSV row gets, in the reader's language", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Nobody;Here;;;", "END:VCARD"].join(CRLF);
    const { rows, mapping } = vCardContactsToRows(parseVCardText(vcard));
    const { mapped, errors } = mapRows(rows, mapping, "es");
    expect(mapped).toHaveLength(0);
    expect(errors[0]!.reason).toBe(messages["contacts.import.reason.noEmailOrPhone.es"]);
  });

  it("a fully-populated card flows through mapRows exactly like a CSV row — business name NOT included by default (fix round M-3(b) RULING: a vCard's ORG starts unmapped, since it's often the customer's employer, not their business)", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Gomez;Lupe;;;",
      "ORG:Gomez Landscaping", "TEL:5551112222", "EMAIL:lupe@example.com", "END:VCARD"].join(CRLF);
    const { rows, mapping } = vCardContactsToRows(parseVCardText(vcard));
    const { mapped, errors } = mapRows(rows, mapping);
    expect(errors).toHaveLength(0);
    expect(mapped[0]!.input).toEqual({ firstName: "Lupe", lastName: "Gomez", phone: "5551112222", email: "lupe@example.com" });
    expect("company" in mapped[0]!).toBe(false);
  });

  it("the business name DOES flow through once the owner maps ORG's column themselves (mutation: pre-map company_name to itself -> the test above FAILS instead)", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Gomez;Lupe;;;",
      "ORG:Gomez Landscaping", "TEL:5551112222", "END:VCARD"].join(CRLF);
    const { rows, mapping } = vCardContactsToRows(parseVCardText(vcard));
    const orgHeader = Object.keys(mapping).find((h) => mapping[h] === null)!;
    const ownerMapping = { ...mapping, [orgHeader]: "company_name" };
    const { mapped } = mapRows(rows, ownerMapping);
    expect(mapped[0]!.company).toBe("Gomez Landscaping");
  });

  it("a blank company cell is dropped before the patch, same as a blank CSV cell", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Reed;Nora;;;", "EMAIL:nora@example.com", "END:VCARD"].join(CRLF);
    const { rows, mapping } = vCardContactsToRows(parseVCardText(vcard));
    const { mapped } = mapRows(rows, mapping);
    expect("company" in mapped[0]!).toBe(false);
  });
});

describe("vCardContactsToRows", () => {
  it("pre-maps every header to its field EXCEPT company_name, in English by default (fix round M-3(b) RULING)", () => {
    const { headers, mapping } = vCardContactsToRows([{ firstName: "A", lastName: "B" }]);
    expect(headers).toEqual([
      messages["contacts.firstName"], messages["contacts.lastName"], messages["contacts.email"],
      messages["contacts.phone"], messages["contact.company"],
    ]);
    for (const h of headers.slice(0, 4)) expect(mapping[h]).toBe(VCARD_FIELDS[headers.indexOf(h)]);
    expect(mapping[messages["contact.company"]]).toBeNull();
  });

  it("pre-maps every header in Spanish when asked", () => {
    const { headers, mapping } = vCardContactsToRows([{ firstName: "A" }], "es");
    expect(headers).toEqual([
      messages["contacts.firstName.es"], messages["contacts.lastName.es"], messages["contacts.email.es"],
      messages["contacts.phone.es"], messages["contact.company.es"],
    ]);
    expect(mapping[messages["contacts.firstName.es"]]).toBe("first_name");
  });

  it("gives each row a 1-based line number and blank strings for fields the card lacked", () => {
    const { rows, headers } = vCardContactsToRows([{ firstName: "Only" }, { lastName: "Second" }]);
    expect(rows[0]!.line).toBe(1);
    expect(rows[0]!.values[headers[2]!]).toBe(""); // email, absent
    expect(rows[1]!.line).toBe(2);
    expect(rows[1]!.values[headers[0]!]).toBe(""); // first name, absent
    expect(rows[1]!.values[headers[1]!]).toBe("Second");
  });
});

describe("looksLikeVCard — detected by extension or content, never MIME alone", () => {
  it("is true for a .vcf extension regardless of content", () => {
    expect(looksLikeVCard("contacts.vcf", "garbage")).toBe(true);
    expect(looksLikeVCard("CONTACTS.VCF", "garbage")).toBe(true);
  });

  it("is true for a .csv-named file whose content starts with BEGIN:VCARD", () => {
    expect(looksLikeVCard("export.csv", "BEGIN:VCARD\r\nN:A;B;;;\r\nEND:VCARD")).toBe(true);
  });

  it("is false for a .csv file with ordinary CSV content", () => {
    expect(looksLikeVCard("export.csv", "first_name,last_name\nAda,Lovelace")).toBe(false);
  });

  it("takes no MIME type parameter at all — a phone's odd MIME string cannot be consulted", () => {
    expect(looksLikeVCard.length).toBe(2);
  });

  // Fix round M-7(c): only the FIRST non-empty line counts, not any line in
  // the sniffed slice — a CSV row further down that happens to contain the
  // literal text "BEGIN:VCARD" must not misfire.
  it("is false for a .csv file whose SECOND line merely starts with BEGIN:VCARD, not its first (mutation: revert to /^\\s*BEGIN:VCARD/im -> FAILS, since that regex's `m` flag matches the start of ANY line)", () => {
    expect(looksLikeVCard("export.csv", "first_name,last_name\nBEGIN:VCARD\nAda,Lovelace")).toBe(false);
  });

  it("is true when BEGIN:VCARD is the first non-empty line after a leading BOM and blank lines", () => {
    expect(looksLikeVCard("export.csv", "﻿\n\n  BEGIN:VCARD\r\nN:A;B;;;\r\nEND:VCARD")).toBe(true);
  });
});

describe("decodeVCardBytes — fix round I-1: the WHOLE FILE's own encoding", () => {
  it("decodes a genuinely UTF-8 file unchanged (mutation: always use windows-1252 -> FAILS, García would read GarcÃ­a)", () => {
    const text = ["BEGIN:VCARD", "N:García;María;;;", "END:VCARD"].join(CRLF);
    const bytes = new TextEncoder().encode(text);
    expect(decodeVCardBytes(bytes)).toBe(text);
  });

  it("falls back to windows-1252 for a raw 8-bit Latin-1 file with no declared encoding at all (mutation: drop the fatal-UTF-8-then-windows-1252 fallback -> FAILS, the byte decodes as U+FFFD instead of ñ)", () => {
    const prefix = new TextEncoder().encode("BEGIN:VCARD\r\nN:Pe");
    const nTilde = new Uint8Array([0xF1]); // raw windows-1252/ISO-8859-1 byte for "ñ" — NOT valid standalone UTF-8
    const suffix = new TextEncoder().encode("a;Ana;;;\r\nTEL:5551112222\r\nEND:VCARD");
    const bytes = new Uint8Array(prefix.length + 1 + suffix.length);
    bytes.set(prefix, 0);
    bytes.set(nTilde, prefix.length);
    bytes.set(suffix, prefix.length + 1);
    const text = decodeVCardBytes(bytes);
    const [contact] = parseVCardText(text);
    expect(contact!.lastName).toBe("Peña");
  });

  it("accepts a plain ArrayBuffer, not only a Uint8Array", () => {
    const text = "BEGIN:VCARD\r\nN:A;B;;;\r\nEND:VCARD";
    const buffer = new TextEncoder().encode(text).buffer;
    expect(decodeVCardBytes(buffer)).toBe(text);
  });
});

describe("QUOTED-PRINTABLE decoding reads the property's own CHARSET (fix round I-1)", () => {
  it("decodes a CHARSET=ISO-8859-1 QP value as ISO-8859-1, not UTF-8 (mutation: always decode QP bytes as utf-8 -> FAILS, the single =F1 byte is invalid UTF-8 alone)", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:2.1",
      "N;ENCODING=QUOTED-PRINTABLE;CHARSET=ISO-8859-1:Pe=F1a;Ana;;;",
      "TEL:5550003333",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.lastName).toBe("Peña");
  });

  it("decodes a CHARSET=WINDOWS-1252 QP value the same way", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:2.1",
      "FN;ENCODING=QUOTED-PRINTABLE;CHARSET=WINDOWS-1252:Pe=F1a Ni=F1o",
      "TEL:5550004444",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.firstName).toBe("Peña");
    expect(contact!.lastName).toBe("Niño");
  });

  it("an unrecognised or absent CHARSET still falls back to utf-8-then-windows-1252, not a crash", () => {
    const vcard = [
      "BEGIN:VCARD", "VERSION:2.1",
      "N;ENCODING=QUOTED-PRINTABLE;CHARSET=MACINTOSH:Garc=C3=ADa;Ana;;;",
      "TEL:5550005555",
      "END:VCARD",
    ].join(CRLF);
    const [contact] = parseVCardText(vcard);
    expect(contact!.lastName).toBe("García");
  });
});

describe("vCardDisplayNames — fix round M-4, the skipped-rows download's own name column", () => {
  it("joins first and last name, in order", () => {
    expect(vCardDisplayNames([{ firstName: "Ana", lastName: "Ruiz" }])).toEqual(["Ana Ruiz"]);
  });
  it("is blank for a card with neither (mutation: default to a placeholder string -> FAILS)", () => {
    expect(vCardDisplayNames([{}])).toEqual([""]);
  });
  it("uses whichever one name a card has", () => {
    expect(vCardDisplayNames([{ firstName: "Ana" }, { lastName: "Ruiz" }])).toEqual(["Ana", "Ruiz"]);
  });
});

describe("vCardFileTooLarge", () => {
  it("allows a file exactly at the ceiling", () => {
    expect(vCardFileTooLarge(MAX_VCARD_FILE_BYTES)).toBe(false);
  });
  it("refuses one byte over the ceiling", () => {
    expect(vCardFileTooLarge(MAX_VCARD_FILE_BYTES + 1)).toBe(true);
  });
});
