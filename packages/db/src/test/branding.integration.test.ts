import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { uploadBrandLogo, removeBrandLogo, sweepOrphanedLogos, restoreBrandLogoIfCleared,
         brandLogoUrl, setBranding, getBranding } from "../branding";
import { withTestAccount } from "./fixtures";

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

  // sweepOrphanedLogos: "Remove logo" (web's removeBrandLogoAction) clears
  // brand_logo_path WITHOUT deleting the object, so an un-undone Remove
  // leaves exactly this shape behind — an object no account row points at.
  describe("sweepOrphanedLogos", () => {
    it("deletes every object under the prefix except keepPath (mutation: sweep unconditionally, ignoring keepPath, → FAILS: `second` would be gone too)", async () => {
      const db = serviceDb();
      const accountId = "00000000-0000-0000-0000-0000000000ad";
      const first = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
      const second = await uploadBrandLogo(db, accountId, PNG_1PX_ALT, "image/png");
      try {
        await sweepOrphanedLogos(db, accountId, second);
        const { data: listed, error } = await db.storage.from("brand-logos").list(accountId);
        if (error) throw new Error(`list failed: ${error.message}`);
        const names = (listed ?? []).map((o) => `${accountId}/${o.name}`);
        expect(names).not.toContain(first);
        expect(names).toContain(second);
      } finally {
        await db.storage.from("brand-logos").remove([first, second]);
      }
    });

    it("sweeps the WHOLE prefix when keepPath is null — there is nothing to keep (mutation: no-op on a null keepPath → FAILS: `only` would survive)", async () => {
      const db = serviceDb();
      const accountId = "00000000-0000-0000-0000-0000000000ae";
      const only = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
      await sweepOrphanedLogos(db, accountId, null);
      const { data: listed, error } = await db.storage.from("brand-logos").list(accountId);
      if (error) throw new Error(`list failed: ${error.message}`);
      expect(listed ?? []).toHaveLength(0);
      void only; // uploaded only to be proven gone, above
    });

    it("is a no-op (no error, no deletion) on a prefix with nothing in it", async () => {
      const db = serviceDb();
      const accountId = "00000000-0000-0000-0000-0000000000af";
      await expect(sweepOrphanedLogos(db, accountId, null)).resolves.toBeUndefined();
    });

    // M7 (review, 2026-10-04): sweeping ONE account's folder must never
    // reach another's — the doc comment's "fixed-length UUID folders,
    // per-folder `list`" claim, proven rather than merely asserted. Two
    // DIFFERENT accounts, each with their own stale object to sweep.
    it("never touches a different account's folder (mutation: list the bucket root instead of accountId's own prefix → FAILS, `otherStale` would be gone)", async () => {
      const db = serviceDb();
      const accountA = "00000000-0000-0000-0000-0000000000b0";
      const accountB = "00000000-0000-0000-0000-0000000000b1";
      const aStale = await uploadBrandLogo(db, accountA, PNG_1PX, "image/png");
      const aKeep = await uploadBrandLogo(db, accountA, PNG_1PX_ALT, "image/png");
      const otherStale = await uploadBrandLogo(db, accountB, PNG_1PX, "image/png");
      try {
        await sweepOrphanedLogos(db, accountA, aKeep);

        const { data: listedA, error: errA } = await db.storage.from("brand-logos").list(accountA);
        if (errA) throw new Error(`list A failed: ${errA.message}`);
        const namesA = (listedA ?? []).map((o) => `${accountA}/${o.name}`);
        expect(namesA).not.toContain(aStale);
        expect(namesA).toContain(aKeep);

        // Account B's object was never a candidate — it wasn't even listed —
        // and it is still exactly where it was.
        const { data: listedB, error: errB } = await db.storage.from("brand-logos").list(accountB);
        if (errB) throw new Error(`list B failed: ${errB.message}`);
        const namesB = (listedB ?? []).map((o) => `${accountB}/${o.name}`);
        expect(namesB).toContain(otherStale);
      } finally {
        await db.storage.from("brand-logos").remove([aStale, aKeep, otherStale]);
      }
    });

    // I3 (near-Critical review fix, 2026-10-04): the sweep re-reads the
    // account's LIVE brand_logo_path before deleting, not just the caller's
    // `keepPath` snapshot — so a concurrent save that changed the column
    // since the caller computed `keepPath` still has its object survive.
    it("also keeps the account's LIVE brand_logo_path, not only the caller's keepPath snapshot", async () => {
      await withTestAccount(async (db, accountId) => {
        const stale = await uploadBrandLogo(db, accountId, PNG_1PX, "image/png");
        // Simulates a concurrent save that landed AFTER the caller computed
        // `keepPath` but BEFORE this sweep runs: the column now points at
        // `concurrent`, a path the caller's `keepPath` (still `stale`) does
        // not know about.
        const concurrent = await uploadBrandLogo(db, accountId, PNG_1PX_ALT, "image/png");
        await setBranding(db, accountId, { brandLogoPath: concurrent }, "user_test");
        try {
          // Mutation: read keepPath alone, skip the live re-read → FAILS
          // (`concurrent` would be deleted here, even though it is the
          // account's CURRENT logo).
          await sweepOrphanedLogos(db, accountId, stale);
          const { data: listed, error } = await db.storage.from("brand-logos").list(accountId);
          if (error) throw new Error(`list failed: ${error.message}`);
          const names = (listed ?? []).map((o) => `${accountId}/${o.name}`);
          expect(names).toContain(concurrent);
        } finally {
          await db.storage.from("brand-logos").remove([stale, concurrent]);
        }
      });
    });
  });

  // I1 (near-Critical review fix, 2026-10-04): restoreBrandLogoAction's
  // database-side compare-and-set. Proven against REAL Postgres rather than
  // a mock, because the whole point is that the check and the write are one
  // atomic statement.
  describe("restoreBrandLogoIfCleared", () => {
    it("writes the path and returns true when the column is NULL (mutation: drop the .is(null) filter → still true, but see the next test)", async () => {
      await withTestAccount(async (db, accountId) => {
        await setBranding(db, accountId, { brandLogoPath: null }, "user_test");
        const path = `${accountId}/logo-0123456789abcdef.png`;
        expect(await restoreBrandLogoIfCleared(db, accountId, path, "user_test")).toBe(true);
        expect((await getBranding(db, accountId)).brandLogoPath).toBe(path);
      });
    });

    it("refuses and writes NOTHING when the column already holds a different path — the exact Remove-then-upload-then-stale-Undo case (mutation: drop the .is(null) filter → FAILS, returns true and overwrites)", async () => {
      await withTestAccount(async (db, accountId) => {
        const newer = `${accountId}/logo-fedcba9876543210.png`;
        await setBranding(db, accountId, { brandLogoPath: newer }, "user_test");
        const older = `${accountId}/logo-0123456789abcdef.png`;
        expect(await restoreBrandLogoIfCleared(db, accountId, older, "user_test")).toBe(false);
        // The newer upload survives untouched — this IS the near-Critical
        // defect (writes=[null,"...-new.png","...-old.png"]) with its fix.
        expect((await getBranding(db, accountId)).brandLogoPath).toBe(newer);
      });
    });

    it("emits account.branding_updated only on an actual restore, not on a refused one", async () => {
      await withTestAccount(async (db, accountId) => {
        const path = `${accountId}/logo-0123456789abcdef.png`;

        await setBranding(db, accountId, { brandLogoPath: "acct/logo-aaaaaaaaaaaaaaaa.png" }, "user_test");
        await restoreBrandLogoIfCleared(db, accountId, path, "user_test");
        const { count: refusedCount } = await db.from("events").select("id", { count: "exact", head: true })
          .eq("account_id", accountId).eq("type", "account.branding_updated");
        expect(refusedCount).toBe(0);

        await setBranding(db, accountId, { brandLogoPath: null }, "user_test");
        await restoreBrandLogoIfCleared(db, accountId, path, "user_test");
        const { count: restoredCount } = await db.from("events").select("id", { count: "exact", head: true })
          .eq("account_id", accountId).eq("type", "account.branding_updated");
        expect(restoredCount).toBe(1);
      });
    });
  });
});
