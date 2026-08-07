import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { uploadBrandLogo, brandLogoUrl } from "../branding";

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
});
