import { describe, it, expect } from "vitest";
import { typeForFile, extensionAllowed, titleFromFileName, defaultCategory, formatMb, isDay } from "./rules";

describe("file rules (spec 4.2, 5.1)", () => {
  it("the extension and the browser's type must agree; an unknown or empty browser type defers to the extension (mutation: ignore the browser type -> FAILS)", () => {
    expect(typeForFile("Contract.PDF", "application/pdf")).toBe("application/pdf");
    expect(typeForFile("lease.docx", "")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(typeForFile("photo.jpg", "image/png")).toBeNull();
    expect(typeForFile("photo.heic", "image/heic")).toBeNull();
    expect(typeForFile("page.html", "text/html")).toBeNull();
    expect(typeForFile("logo.svg", "image/svg+xml")).toBeNull();
    expect(extensionAllowed("x.webp")).toBe(true);
    expect(extensionAllowed("x.exe")).toBe(false);
  });
  it("a title is the name without its extension, cleaned, at most 200 characters (mutation: keep the extension -> FAILS)", () => {
    expect(titleFromFileName("  Signed lease.pdf ")).toBe("Signed lease");
    expect(titleFromFileName("archive.tar.pdf")).toBe("archive.tar");
    expect(titleFromFileName(".pdf")).toBeNull();
    expect([...titleFromFileName(`${"é".repeat(250)}.pdf`)!].length).toBe(200);
  });
  it("images default to Photo, everything else to Other; sizes read in MB (mutation: default every file to other -> FAILS)", () => {
    expect(defaultCategory("image/webp")).toBe("photo");
    expect(defaultCategory("application/pdf")).toBe("other");
    expect(formatMb(31 * 1048576, "en")).toBe("31 MB");
    expect(formatMb(Math.round(25.5 * 1048576), "en")).toBe("25.5 MB");
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-02-28")).toBe(true);
  });
});
