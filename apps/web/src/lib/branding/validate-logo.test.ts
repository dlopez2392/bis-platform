import { describe, it, expect } from "vitest";
import { sniffImageType } from "./validate-logo";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("sniffImageType", () => {
  it("recognizes the three accepted raster formats", () => {
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  // The whole reason this module exists. An SVG can carry <script>, and the
  // logo is served to the client's CUSTOMERS on a public page — accepting one
  // would make this upload a stored-XSS vector on the least-trusted surface.
  it("rejects SVG, including one that claims to be a PNG", () => {
    expect(sniffImageType(svg)).toBeNull();
  });

  // An SVG does not have to start with "<svg". A BOM, a leading newline, or an
  // XML declaration are all things a browser still renders as SVG, and all
  // things a naive "does it start with <svg" check would wave through.
  it("rejects SVG dressed up to defeat a prefix check", () => {
    const variants = [
      '﻿<svg xmlns="http://www.w3.org/2000/svg"/>',
      '\n\t <svg xmlns="http://www.w3.org/2000/svg"/>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ""><svg/>',
    ];
    for (const v of variants) {
      expect(sniffImageType(new TextEncoder().encode(v))).toBeNull();
    }
  });

  it("rejects HTML, which is the same stored-XSS problem in another wrapper", () => {
    expect(sniffImageType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("rejects a file whose bytes do not match any accepted format", () => {
    expect(sniffImageType(new TextEncoder().encode("not an image at all"))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    // Truncated PNG signature: a prefix must not be treated as a match.
    expect(sniffImageType(Uint8Array.from([0x89, 0x50]))).toBeNull();
  });

  // RIFF is a generic container. Matching on "RIFF" alone would accept a WAV,
  // an AVI, or anything else that borrows the wrapper.
  it("rejects a RIFF container that is not WebP", () => {
    const wav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageType(wav)).toBeNull();
    // "RIFF" present but the file ends before the format tag can be read.
    expect(sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull();
  });
});
