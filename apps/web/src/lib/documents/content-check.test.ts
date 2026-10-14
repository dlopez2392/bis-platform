import { describe, it, expect } from "vitest";
import { sniffDocumentType, checkDocumentBytes } from "./content-check";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const bytes = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => new TextEncoder().encode(s);

/** A minimal, valid ZIP (stored, no compression) with the named entries and a central directory. */
function zipOf(names: string[]): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const name of names) {
    const nb = [...ascii(name)];
    const offset = parts.length;
    parts.push(0x50, 0x4b, 0x03, 0x04, ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0), ...le32(0),
      ...le16(nb.length), ...le16(0), ...nb);
    central.push(0x50, 0x4b, 0x01, 0x02, ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0), ...le32(0),
      ...le16(nb.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...nb);
  }
  const cdOffset = parts.length;
  const eocd = [0x50, 0x4b, 0x05, 0x06, ...le16(0), ...le16(0), ...le16(names.length), ...le16(names.length),
    ...le32(central.length), ...le32(cdOffset), ...le16(0)];
  return new Uint8Array([...parts, ...central, ...eocd]);
}

describe("sniffDocumentType reads the leading bytes, never the name (spec 5.2)", () => {
  it.each([
    ["PDF", ascii("%PDF-1.7\n%..."), "application/pdf"],
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), "image/jpeg"],
    ["PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "image/png"],
    ["WebP", new Uint8Array([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")]), "image/webp"],
    ["DOCX", zipOf(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]), DOCX],
    ["XLSX", zipOf(["[Content_Types].xml", "xl/workbook.xml"]), XLSX],
  ])("%s (mutation: drop its branch -> FAILS)", (_l, b, want) => {
    expect(sniffDocumentType(b)).toBe(want);
  });

  it.each([
    ["an EXE renamed .pdf", new Uint8Array([...ascii("MZ"), 0x90, 0])],
    ["a WAV (RIFF without WEBP)", new Uint8Array([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVEfmt ")])],
    ["SVG", ascii("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>")],
    ["HTML", ascii("<!doctype html><script>alert(1)</script>")],
    ["a plain ZIP", zipOf(["a.txt"])],
    ["a ZIP with word/ but no [Content_Types].xml", zipOf(["word/document.xml"])],
    ["HEIC", new Uint8Array([0, 0, 0, 0x18, ...ascii("ftypheic")])],
    ["empty", new Uint8Array()],
    ["a truncated PDF magic", ascii("%PD")],
  ])("refuses %s (mutation: accept any ZIP as DOCX -> FAILS on the plain ZIP)", (_l, b) => {
    expect(sniffDocumentType(b)).toBeNull();
  });
});

describe("checkDocumentBytes compares with the DECLARED type (spec 5.2)", () => {
  it("a PNG declared as JPEG is a mismatch; a PNG declared PNG is ok (mutation: return ok when both are images -> FAILS)", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(checkDocumentBytes(png, "image/jpeg")).toBe("mismatch");
    expect(checkDocumentBytes(png, "image/png")).toBe("ok");
    expect(checkDocumentBytes(zipOf(["[Content_Types].xml", "xl/workbook.xml"]), DOCX)).toBe("mismatch");
  });
});
