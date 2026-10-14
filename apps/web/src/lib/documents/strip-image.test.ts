import { describe, it, expect, vi, afterEach } from "vitest";
import { fitWithin, encodeArgs, stripImage, MAX_IMAGE_EDGE } from "./strip-image";

describe("the browser re-encode's pure parts (spec 5.3)", () => {
  it("over 4096 px on the long side scales down to 4096, keeping the ratio; smaller images keep their size (mutation: scale by the short side -> FAILS)", () => {
    expect(fitWithin(8192, 6144)).toEqual({ width: 4096, height: 3072 });
    expect(fitWithin(3000, 9000)).toEqual({ width: 1365, height: 4096 });
    expect(fitWithin(4000, 3000)).toEqual({ width: 4000, height: 3000 });
    expect(MAX_IMAGE_EDGE).toBe(4096);
  });
  it("JPEG at 0.9; PNG stays PNG with no quality; WebP stays WebP (mutation: encode every image as JPEG -> FAILS)", () => {
    expect(encodeArgs("image/jpeg")).toEqual({ type: "image/jpeg", quality: 0.9 });
    expect(encodeArgs("image/png")).toEqual({ type: "image/png", quality: undefined });
    expect(encodeArgs("image/webp")).toEqual({ type: "image/webp", quality: 0.9 });
  });
});

/**
 * stripImage is browser-only (createImageBitmap, canvas). Vitest runs in node, so the browser's two
 * entry points are stubbed and the test pins what stripImage ASKS of them: the orientation flag, the
 * capped canvas size, the encode arguments, the bitmap released. What the stubs hand back is never the
 * thing asserted, except the blob's identity, which proves the canvas's own output is what is returned.
 */
describe("stripImage's wiring to the browser (spec 5.3)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubBrowser(bitmapSize: { width: number; height: number }, produced: Blob | null) {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ ...bitmapSize, close }));
    const drawImage = vi.fn();
    const canvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((...args: [cb: (b: Blob | null) => void, type?: string, quality?: number]) => args[0](produced)),
    };
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    return { close, createImageBitmap, drawImage, canvas };
  }

  it("decodes with the photo's own orientation, draws onto a canvas capped at 4096, encodes with encodeArgs, and frees the bitmap (mutation: drop imageOrientation -> FAILS)", async () => {
    const out = new Blob([new Uint8Array(3)], { type: "image/jpeg" });
    const s = stubBrowser({ width: 8192, height: 6144 }, out);
    const input = new Blob([new Uint8Array(9)], { type: "image/jpeg" });
    const got = await stripImage(input, "image/jpeg");
    expect(got).toBe(out);
    expect(s.createImageBitmap).toHaveBeenCalledWith(input, { imageOrientation: "from-image" });
    expect([s.canvas.width, s.canvas.height]).toEqual([4096, 3072]);
    expect(s.drawImage.mock.calls[0]!.slice(1)).toEqual([0, 0, 4096, 3072]);
    expect(s.canvas.toBlob.mock.calls[0]!.slice(1)).toEqual(["image/jpeg", 0.9]);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it("a canvas that cannot encode rejects, and the bitmap is still freed (mutation: drop the finally's close -> FAILS)", async () => {
    const s = stubBrowser({ width: 10, height: 10 }, null);
    await expect(stripImage(new Blob([new Uint8Array(4)], { type: "image/png" }), "image/png")).rejects.toThrow(/encode failed/);
    expect(s.close).toHaveBeenCalledTimes(1);
  });
});
