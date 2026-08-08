/**
 * Identifies an image by its actual leading bytes.
 *
 * Deliberately does NOT consult the filename or the browser-supplied MIME
 * type — the client controls both, so a .png extension on an SVG would sail
 * straight through a check based on either. SVG is absent from this list on
 * purpose: it is an XML document that can carry <script>, and this file is
 * served to the client's customers on a public page.
 *
 * This is an allowlist, not a blocklist, and that is the point. It does not
 * try to recognise SVG in order to reject it — anything that is not provably
 * one of three raster formats is rejected, so the XML tricks that defeat
 * "does it start with <svg" checks (a BOM, leading whitespace, an XML
 * declaration, a DOCTYPE) have nothing to defeat here.
 */
export function sniffImageType(
  bytes: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | null {
  const starts = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length &&
    sig.every((b, i) => bytes[offset + i] === b);

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  // WebP is a RIFF container: "RIFF" then 4 size bytes then "WEBP". Both halves
  // are required — RIFF alone is also a WAV, an AVI, and several other things.
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

/** Bytes. A logo far above this is a mistake or an attack, not a logo. */
export const MAX_LOGO_BYTES = 512 * 1024;
