import { crc32, deflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The EICAR antivirus test string, joined at run time from two halves so that no file in this repo
// carries it whole (an antivirus on a developer's machine quarantines such a file).
const HEAD = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
const TAIL = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
export const eicar = () => HEAD + TAIL;

/**
 * A ZIP of [name, bytes, method?] entries: STORED by default, so a member's bytes appear verbatim;
 * "deflate" compresses one (an Office file's own XML members are deflated, which is what makes a
 * small upload unpack to many times its size).
 */
export function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data, method] of entries) {
    const n = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const body = method === "deflate" ? deflateRawSync(data) : data;
    const how = method === "deflate" ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(how, 8); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(how, 10); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
export const storedZip = (entries) => zipOf(entries);

const CONTENT_TYPES = Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');

/**
 * A DOCX-shaped ZIP (the app's type check, apps/web/src/lib/documents/content-check.ts:47-51, wants
 * [Content_Types].xml and an entry under word/) with the EICAR string as a stored member: the file
 * the Preview check uploads, since a raw EICAR file is refused as the wrong type before any scan.
 */
export const eicarDocx = () => zipOf([
  ["[Content_Types].xml", CONTENT_TYPES],
  ["word/document.xml", Buffer.from("<w:document/>")],
  ["eicar.com", Buffer.from(eicar())],
]);

/**
 * An XLSX-shaped ZIP whose one sheet is `unpackedBytes` of repetitive XML, DEFLATED (plan re-review
 * N1): a legitimate export far smaller than 25 MiB that unpacks to hundreds of MB. It must scan CLEAN
 * under the image's limits; the CI job also reports its scan time and the machine's peak memory (A1).
 */
export function xlsxExpanding(unpackedBytes) {
  const sheet = Buffer.alloc(unpackedBytes, '<row r="1"><c r="A1" t="n"><v>12345</v></c><c r="B1" t="s"><v>7</v></c></row>');
  return zipOf([["[Content_Types].xml", CONTENT_TYPES], ["xl/worksheets/sheet1.xml", sheet, "deflate"]]);
}

/** A clean PDF-shaped file of exactly `bytes` bytes (at least 32). */
export function cleanPdf(bytes) {
  const head = "%PDF-1.4\n%";
  const tail = "\n%%EOF\n";
  return Buffer.concat([Buffer.from(head), Buffer.alloc(bytes - head.length - tail.length, 0x30), Buffer.from(tail)]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node services/scanner/test/eicar.mjs <out.docx>"); process.exit(2); }
  writeFileSync(out, eicarDocx());
  console.log(`wrote ${out}`);
}
