import { describe, expect, it } from "vitest";
import {
  looksLikeVCard, parseVCardText, vCardContactsToRows, vCardFileTooLarge,
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

  it("skips a PHOTO block's many folded base64 lines efficiently, without losing the properties that follow it", () => {
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

  it("a fully-populated card flows through mapRows exactly like a CSV row, business name included", () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Gomez;Lupe;;;",
      "ORG:Gomez Landscaping", "TEL:5551112222", "EMAIL:lupe@example.com", "END:VCARD"].join(CRLF);
    const { rows, mapping } = vCardContactsToRows(parseVCardText(vcard));
    const { mapped, errors } = mapRows(rows, mapping);
    expect(errors).toHaveLength(0);
    expect(mapped[0]!.input).toEqual({ firstName: "Lupe", lastName: "Gomez", phone: "5551112222", email: "lupe@example.com" });
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
  it("pre-maps every header to its field, in English by default", () => {
    const { headers, mapping } = vCardContactsToRows([{ firstName: "A", lastName: "B" }]);
    expect(headers).toEqual([
      messages["contacts.firstName"], messages["contacts.lastName"], messages["contacts.email"],
      messages["contacts.phone"], messages["contact.company"],
    ]);
    for (const h of headers) expect(mapping[h]).toBe(VCARD_FIELDS[headers.indexOf(h)]);
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
});

describe("vCardFileTooLarge", () => {
  it("allows a file exactly at the ceiling", () => {
    expect(vCardFileTooLarge(MAX_VCARD_FILE_BYTES)).toBe(false);
  });
  it("refuses one byte over the ceiling", () => {
    expect(vCardFileTooLarge(MAX_VCARD_FILE_BYTES + 1)).toBe(true);
  });
});
