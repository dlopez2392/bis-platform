import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { uploadBrandLogo, removeBrandLogo, brandLogoUrl } from "../branding";

// This suite hits the real hosted Supabase project's Storage -- it has no
// local/hermetic mode. Skip loudly rather than fail hard when the
// credentials it needs aren't present, so a missing .env doesn't masquerade
// as a broken build for anyone (or any CI job) that isn't set up for it.
const hasCredentials =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!hasCredentials) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[branding.integration.test.ts] SKIPPED: missing NEXT_PUBLIC_SUPABASE_URL " +
      "and/or SUPABASE_SERVICE_ROLE_KEY. This suite proves real Supabase Storage " +
      "end to end and cannot run hermetically -- a skip here is NOT a pass. Set " +
      "those env vars and run `pnpm --filter @bis/db test:integration` to " +
      "actually exercise it.\n"
  );
}

// A 1x1 PNG, byte-for-byte. Magic bytes 89 50 4E 47 make this a genuine PNG,
// not a renamed file — the point is to prove a real image round-trips.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// A second, genuinely different 1x1 PNG — 8-bit grayscale rather than the RGBA
// above, built chunk by chunk with real CRCs. Used to prove that changing the
// image changes the URL, so it has to differ in its bytes, not just its name.
const PNG_1PX_ALT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!hasCredentials)("brand logo storage", () => {
  it("uploads server-side and serves the bytes back anonymously", async () => {
    const db = serviceDb();
    const accountId = "00000000-0000-0000-0000-0000000000aa";
    const path = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
    try {
      const res = await fetch(brandLogoUrl(path));
      expect(res.status).toBe(200);
      const back = Buffer.from(await res.arrayBuffer());
      expect(back.equals(PNG_1PX)).toBe(true);
    } finally {
      await db.storage.from("brand-logos").remove([path]);
    }
  });

  // The reason the path carries a content digest. A fixed `logo.png` per
  // account would be overwritten in place, leaving the URL identical -- and
  // this bucket is public, so the CDN would go on serving the OLD image to the
  // agency admin who just uploaded and to the client's customers on the public
  // form. That edge cache already produced one false positive on this
  // milestone; it is not a hypothetical.
  it("gives replaced bytes a different URL, and the old object can be swept up", async () => {
    const db = serviceDb();
    const accountId = "00000000-0000-0000-0000-0000000000ab";

    const first = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
    const second = await uploadBrandLogo(db, accountId, PNG_1PX_ALT, "image/png");
    try {
      expect(second).not.toBe(first);

      // Both are live at this instant -- proving the second upload did not
      // clobber the first, which is what makes the sweep necessary.
      expect((await fetch(brandLogoUrl(first))).status).toBe(200);
      const res = await fetch(brandLogoUrl(second));
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(PNG_1PX_ALT)).toBe(true);

      await removeBrandLogo(db, first);
      // Deliberately checked via the storage API, not a second fetch of a URL
      // the CDN has already cached: an edge hit would report 200 for an object
      // that no longer exists and quietly turn this assertion into a lie.
      const { data: listed, error } = await db.storage.from("brand-logos").list(accountId);
      if (error) throw new Error(`list failed: ${error.message}`);
      const names = (listed ?? []).map((o) => `${accountId}/${o.name}`);
      expect(names).not.toContain(first);
      expect(names).toContain(second);
    } finally {
      await db.storage.from("brand-logos").remove([first, second]);
    }
  });

  // Re-uploading an unchanged image must not orphan anything or change the URL.
  it("is idempotent for identical bytes", async () => {
    const db = serviceDb();
    const accountId = "00000000-0000-0000-0000-0000000000ac";
    const a = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
    const b = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
    try {
      expect(b).toBe(a);
    } finally {
      await db.storage.from("brand-logos").remove([a]);
    }
  });
});
