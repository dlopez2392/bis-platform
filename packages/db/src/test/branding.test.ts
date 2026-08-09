import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { setBranding, getBranding } from "../branding";

describe("branding service", () => {
  it("sets both fields, reads them back, and emits account.branding_updated", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId,
        { brandName: "Rio Roofing", brandLogoPath: `${accountId}/logo.png` }, "user_test");

      expect(await getBranding(db, accountId)).toEqual({
        brandName: "Rio Roofing",
        brandLogoPath: `${accountId}/logo.png`,
        brandColor: null,
      });

      const { data: ev } = await db.from("events").select("type, actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "account.branding_updated").single();
      expect(ev).toMatchObject({
        type: "account.branding_updated", actor_type: "user", actor_id: "user_test",
      });
    });
  });

  // The Settings action omits brandLogoPath whenever the form carried no new
  // file. If an omitted field were written as null, editing the display name
  // would silently delete the logo -- the whole reason setBranding tests for
  // `undefined` rather than key presence.
  it("leaves an omitted field alone instead of clearing it", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId,
        { brandName: "Rio Roofing", brandLogoPath: `${accountId}/logo.png` }, "user_test");

      await setBranding(db, accountId, { brandName: "Rio Roofing Co" }, "user_test");
      expect(await getBranding(db, accountId)).toEqual({
        brandName: "Rio Roofing Co",
        brandLogoPath: `${accountId}/logo.png`,
        brandColor: null,
      });

      // Spreading an optional variable that happens to be undefined is the
      // same statement to the caller, and must behave the same way.
      const brandLogoPath: string | undefined = undefined;
      await setBranding(db, accountId, { brandName: "Rio Roofing Co", brandLogoPath }, "user_test");
      expect((await getBranding(db, accountId)).brandLogoPath).toBe(`${accountId}/logo.png`);
    });
  });

  it("clears a field when passed an explicit null", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId,
        { brandName: "Rio Roofing", brandLogoPath: `${accountId}/logo.png` }, "user_test");

      await setBranding(db, accountId, { brandLogoPath: null }, "user_test");
      expect(await getBranding(db, accountId)).toEqual({
        brandName: "Rio Roofing",
        brandLogoPath: null,
        brandColor: null,
      });
    });
  });

  it("writes nothing and emits nothing when given no fields", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, {}, "user_test");

      expect(await getBranding(db, accountId)).toEqual({
        brandName: null, brandLogoPath: null, brandColor: null,
      });
      const { count } = await db.from("events").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("type", "account.branding_updated");
      expect(count).toBe(0);
    });
  });

  it("reads an account that does not exist as unbranded", async () => {
    const db = serviceDb();
    expect(await getBranding(db, "00000000-0000-0000-0000-000000000000"))
      .toEqual({ brandName: null, brandLogoPath: null, brandColor: null });
  });

  // The write is deliberately the opposite of the read above. PostgREST
  // returns no error and no rows when an update matches nothing, so without
  // an explicit check this reported success while changing nothing. The
  // events foreign key happens to catch it today, but events are audit data
  // and that protection is incidental -- this pins the intended behaviour.
  it("refuses to report success when the account does not exist", async () => {
    const db = serviceDb();
    await expect(
      setBranding(db, "00000000-0000-0000-0000-000000000000", { brandName: "Ghost Co" }, "user_test"),
    ).rejects.toThrow(/no account/);
  });

  it("writes and reads brand_color", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandColor: "#1e3a8a" }, "user_test");
      expect((await getBranding(db, accountId)).brandColor).toBe("#1e3a8a");
    });
  });

  it("leaves brandColor alone when omitted, and clears it on explicit null", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandColor: "#1e3a8a" }, "user_test");

      // Same load-bearing distinction as brandLogoPath: the Settings action
      // omits fields it is not editing, and omission must not wipe them.
      await setBranding(db, accountId, { brandName: "Rio Roofing" }, "user_test");
      expect((await getBranding(db, accountId)).brandColor).toBe("#1e3a8a");

      await setBranding(db, accountId, { brandColor: null }, "user_test");
      expect((await getBranding(db, accountId)).brandColor).toBeNull();
    });
  });
});
