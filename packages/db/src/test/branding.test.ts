import { describe, it, expect, vi } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  setBranding, getBranding, getMailingAddress, brandDisplayName, brandingChangePayload,
} from "../branding";

describe("brandDisplayName — the db copy of the ONE customer-facing name rule", () => {
  const base = {
    brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  } as const;

  it("is the brand name, trimmed", () => {
    expect(brandDisplayName({ ...base, brandName: "Rio Roofing" })).toBe("Rio Roofing");
  });

  it("is the EMPTY string when brand_name is null — never the agency's accounts.name label", () => {
    expect(brandDisplayName({ ...base, brandName: null })).toBe("");
  });

  it("is the EMPTY string for a blank brand_name, whitespace included (identical to the web copy)", () => {
    expect(brandDisplayName({ ...base, brandName: "" })).toBe("");
    expect(brandDisplayName({ ...base, brandName: "  " })).toBe("");
  });
});

describe("brandingChangePayload — the account.branding_updated audit payload (D-069)", () => {
  it("lists every changed field, and names an untouched one as absent", () => {
    const payload = brandingChangePayload(
      { brand_name: "Rio Roofing" },
      { brand_name: "Fixture Co", brand_color: "#1e3a8a" },
    );
    expect(payload.fields).toEqual(["brand_name"]);
    expect(payload.changes).toEqual({ brand_name: { from: "Fixture Co", to: "Rio Roofing" } });
  });

  it("carries old -> new for every short scalar field in the patch", () => {
    const payload = brandingChangePayload(
      {
        brand_name: "Rio Roofing", brand_color: "#1e3a8a", brand_neutral: "warm",
        brand_corners: "round", brand_type: "serif", brand_mode: "dark",
        reply_to_email: "hello@rioroofing.com",
      },
      {
        brand_name: "Fixture Co", brand_color: null, brand_neutral: null,
        brand_corners: null, brand_type: null, brand_mode: null, reply_to_email: null,
      },
    );
    expect(payload.changes).toEqual({
      brand_name: { from: "Fixture Co", to: "Rio Roofing" },
      brand_color: { from: null, to: "#1e3a8a" },
      brand_neutral: { from: null, to: "warm" },
      brand_corners: { from: null, to: "round" },
      brand_type: { from: null, to: "serif" },
      brand_mode: { from: null, to: "dark" },
      reply_to_email: { from: null, to: "hello@rioroofing.com" },
    });
  });

  // Never the file's contents, and never the mailing address's free text —
  // both can be long and one is a filesystem path, not a short scalar like a
  // name or a colour. The field still appears in `fields`, so the record
  // still shows WHAT was touched; it just does not carry the value.
  it("names the logo path and mailing address as changed fields, with no old/new values logged", () => {
    const payload = brandingChangePayload(
      { brand_logo_path: "acct_1/logo-abc123.png", mailing_address: "123 Main St\nMcAllen, TX" },
      { brand_logo_path: null, mailing_address: null },
    );
    expect(payload.fields.sort()).toEqual(["brand_logo_path", "mailing_address"]);
    expect(payload.changes).toEqual({});
  });

  // D-069, review round: branding/actions.ts resends all 7-8 columns on
  // EVERY save (the real caller's own shape), so `fields` must be the
  // columns that actually CHANGED, not simply every key the patch happens
  // to carry — otherwise a colour-only edit logs 8 "changed" fields with
  // 6 no-ops (from === to).
  it("excludes a no-op field from BOTH fields and changes, even though the caller resent it (mutation: drop the from===to skip → the 6 unchanged fields below reappear)", () => {
    const payload = brandingChangePayload(
      {
        brand_name: "Rio Roofing", brand_logo_path: "acct_1/logo.png", brand_color: "#1e3a8a",
        brand_neutral: "warm", brand_corners: "round", brand_type: "serif", brand_mode: "dark",
        reply_to_email: "hello@rioroofing.com",
      },
      {
        // Every field identical to the patch EXCEPT brand_color — the real
        // shape of a colour-only Settings save, since branding/actions.ts
        // sends the other seven back unchanged every time.
        brand_name: "Rio Roofing", brand_logo_path: "acct_1/logo.png", brand_color: "#0f766e",
        brand_neutral: "warm", brand_corners: "round", brand_type: "serif", brand_mode: "dark",
        reply_to_email: "hello@rioroofing.com",
      },
    );
    expect(payload.fields).toEqual(["brand_color"]);
    expect(payload.changes).toEqual({ brand_color: { from: "#0f766e", to: "#1e3a8a" } });
  });

  it("reports no fields at all when every patched column is a no-op", () => {
    const row = { brand_name: "Rio Roofing", brand_color: "#1e3a8a" };
    const payload = brandingChangePayload(row, row);
    expect(payload.fields).toEqual([]);
    expect(payload.changes).toEqual({});
  });

  // D-069, review round: `.error` was dropped at the before-read in
  // setBranding, so a read FAULT fell back to `before = null` — identical
  // to a genuinely absent row — which made every patched field look
  // "changed" (from: null) even when nothing could actually be verified.
  // `snapshotFailed` is the caller's explicit admission it does not know,
  // never inferred from `before` itself (null legitimately means "no row",
  // not "unknown").
  it("on a failed snapshot read, lists every patched column as touched but logs no fabricated old/new values", () => {
    const payload = brandingChangePayload(
      { brand_name: "Rio Roofing", brand_color: "#1e3a8a" },
      null,
      true,
    );
    expect(payload.fields.sort()).toEqual(["brand_color", "brand_name"]);
    expect(payload.changes).toEqual({});
    expect(payload.snapshot).toBe(false);
  });

  // The genuinely-absent-row case (read SUCCEEDED, found nothing) must not
  // collapse into the read-FAILED case above just because both happen to
  // pass `before = null` — snapshotFailed is explicit and defaults false.
  it("a genuinely absent row (read succeeded, found nothing) still reads every short scalar's \"from\" as null — never confused with a read that merely FAILED", () => {
    const payload = brandingChangePayload({ brand_name: "Rio Roofing" }, null, false);
    expect(payload.changes).toEqual({ brand_name: { from: null, to: "Rio Roofing" } });
    expect(payload).not.toHaveProperty("snapshot");
  });
});

describe("branding service", () => {
  it("sets both fields, reads them back, and emits account.branding_updated", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId,
        { brandName: "Rio Roofing", brandLogoPath: `${accountId}/logo.png` }, "user_test");

      expect(await getBranding(db, accountId)).toEqual({
        brandName: "Rio Roofing",
        brandLogoPath: `${accountId}/logo.png`,
        brandColor: null,
        brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
        replyToEmail: null,
      });

      const { data: ev } = await db.from("events").select("type, actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "account.branding_updated").single();
      expect(ev).toMatchObject({
        type: "account.branding_updated", actor_type: "user", actor_id: "user_test",
      });
    });
  });

  // D-069: the record showed WHO changed branding but never WHAT — every
  // row's payload was `{}`. createAccount seeds brand_name from the
  // account's own name ("Fixture Co" for this fixture), so the FIRST
  // branding save already has a real "from" to show, not just a null.
  it("logs which fields changed, with old -> new for the short scalar fields (D-069)", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId,
        { brandName: "Rio Roofing", brandColor: "#1e3a8a", brandLogoPath: `${accountId}/logo.png` },
        "user_test");

      const { data: ev } = await db.from("events").select("payload")
        .eq("account_id", accountId).eq("type", "account.branding_updated").single();
      const payload = ev!.payload as { fields: string[]; changes: Record<string, { from: unknown; to: unknown }> };

      expect(payload.fields.sort()).toEqual(["brand_color", "brand_logo_path", "brand_name"].sort());
      // The logo path is not logged as an old/new value here — it is not the
      // "short scalar" this row exists to pin, and the brief is explicit:
      // never the file's contents. The field NAME still appears above.
      expect(payload.changes).toEqual({
        brand_name: { from: "Fixture Co", to: "Rio Roofing" },
        brand_color: { from: null, to: "#1e3a8a" },
      });

      // A second save shows the PREVIOUS save's value as "from", not the
      // account's original seed — proof the snapshot is read fresh each time.
      await setBranding(db, accountId, { brandName: "Rio Roofing Co" }, "user_test");
      const { data: rows } = await db.from("events").select("payload")
        .eq("account_id", accountId).eq("type", "account.branding_updated")
        .order("created_at", { ascending: true });
      const second = rows![1]!.payload as { changes: Record<string, { from: unknown; to: unknown }> };
      expect(second.changes.brand_name).toEqual({ from: "Rio Roofing", to: "Rio Roofing Co" });
    });
  });

  // D-069, review round: branding/actions.ts (the real and only web caller)
  // sends ALL eight columns on every save (lines 148-152) — never a sparse
  // patch — so this is the shape setBranding actually sees in production,
  // not the hand-picked single-field patches the unit tests above use.
  it("logs only the field that actually changed, even though the real caller resends every column every save (D-069, review round)", async () => {
    await withTestAccount(async (db, accountId) => {
      const fullPatch = {
        brandName: "Rio Roofing", brandColor: "#0f766e", brandNeutral: "warm" as const,
        brandCorners: "round" as const, brandType: "serif" as const, brandMode: "dark" as const,
        replyToEmail: "hello@rioroofing.com", mailingAddress: "123 Main St\nMcAllen, TX",
      };
      await setBranding(db, accountId, fullPatch, "user_test");

      // The SAME eight-column patch again, colour changed only — exactly
      // the shape a real Settings save sends when an operator edits one
      // field: branding/actions.ts always resends the other seven.
      await setBranding(db, accountId, { ...fullPatch, brandColor: "#1e3a8a" }, "user_test");

      const { data: rows } = await db.from("events").select("payload")
        .eq("account_id", accountId).eq("type", "account.branding_updated")
        .order("created_at", { ascending: true });
      const payload = rows![1]!.payload as { fields: string[]; changes: Record<string, { from: unknown; to: unknown }> };
      expect(payload.fields).toEqual(["brand_color"]);
      expect(payload.changes).toEqual({ brand_color: { from: "#0f766e", to: "#1e3a8a" } });
    });
  });

  // D-069, review round: `.error` was silently dropped at the before-read —
  // a read FAULT fell back to `before = null`, logging every patched field
  // as "changed" with a fabricated `from: null`. A fake client stands in for
  // Supabase (same idiom as "throws on a query fault instead of answering
  // null" below), so `setBranding`'s SECOND call (the real update) still
  // succeeds and this proves the write is not abandoned over an audit-only
  // read failing.
  it("logs the read failure and still writes, with no fabricated old/new values, when the before-snapshot read errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let insertedPayload: unknown;
    try {
      const faulty = {
        from: (table: string) => {
          if (table === "accounts") {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
              }),
              update: () => ({
                eq: () => ({ select: async () => ({ data: [{ id: "acct_1" }], error: null }) }),
              }),
            };
          }
          if (table === "events") {
            return {
              insert: async (row: { payload: unknown }) => { insertedPayload = row.payload; return { error: null }; },
            };
          }
          throw new Error(`unexpected table in fake client: ${table}`);
        },
      } as unknown as SupabaseClient;

      await setBranding(faulty, "acct_1", { brandName: "Rio Roofing", brandColor: "#1e3a8a" }, "user_test");

      const messages = consoleError.mock.calls.map((args) => String(args[0]));
      expect(messages.some((m) => m.includes("boom"))).toBe(true);
      expect(insertedPayload).toEqual({
        fields: ["brand_name", "brand_color"], changes: {}, snapshot: false,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("writes, reads back and clears the reply-to address", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { replyToEmail: "hello@rioroofing.com" }, "user_test");
      expect((await getBranding(db, accountId)).replyToEmail).toBe("hello@rioroofing.com");

      // `undefined` means leave alone: the panel omits fields it did not edit,
      // and a company editing its display name must not lose the address its
      // customers reply to.
      await setBranding(db, accountId, { brandName: "Rio Roofing" }, "user_test");
      expect((await getBranding(db, accountId)).replyToEmail).toBe("hello@rioroofing.com");

      // An explicit null clears it, which is how the form's empty field reads.
      await setBranding(db, accountId, { replyToEmail: null }, "user_test");
      expect((await getBranding(db, accountId)).replyToEmail).toBeNull();
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
        brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
        replyToEmail: null,
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
        brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
        replyToEmail: null,
      });
    });
  });

  it("writes nothing and emits nothing when given no fields", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, {}, "user_test");

      // createAccount seeds brand_name from the account's own name
      // ("Fixture Co" for this fixture) -- it must never be null. An empty
      // `setBranding` call is a no-op, so that seeded value is exactly what
      // should still be here.
      expect(await getBranding(db, accountId)).toEqual({
        brandName: "Fixture Co", brandLogoPath: null, brandColor: null,
        brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
        replyToEmail: null,
      });
      const { count } = await db.from("events").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("type", "account.branding_updated");
      expect(count).toBe(0);
    });
  });

  it("reads an account that does not exist as unbranded", async () => {
    const db = serviceDb();
    expect(await getBranding(db, "00000000-0000-0000-0000-000000000000"))
      .toEqual({
        brandName: null, brandLogoPath: null, brandColor: null,
        brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
        replyToEmail: null,
      });
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

  it("round-trips all four theme inputs", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, {
        brandNeutral: "warm", brandCorners: "round",
        brandType: "serif", brandMode: "dark",
      }, "user_test");

      // The seeded brand_name ("Fixture Co", from createAccount's new
      // never-null invariant) is untouched: only the four theme fields
      // above were set.
      expect(await getBranding(db, accountId)).toEqual({
        brandName: "Fixture Co", brandLogoPath: null, brandColor: null,
        brandNeutral: "warm", brandCorners: "round",
        brandType: "serif", brandMode: "dark",
        replyToEmail: null,
      });
    });
  });

  // The security claim in the spec is "dead at the source". That is a claim
  // about the DATABASE, so it has to be proven by a write that is refused --
  // reading the migration proves nothing.
  it("refuses a value outside the closed set", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(setBranding(db, accountId,
        // The shape a hostile value would take: a real enum member with a
        // smuggled declaration behind a semicolon.
        { brandCorners: "round;position:fixed;inset:0" as never }, "user_test",
      )).rejects.toThrow(/setBranding failed/);

      expect((await getBranding(db, accountId)).brandCorners).toBeNull();
    });
  });
});

// Migration 0048. The postal address the reactivation email prints. NOT on
// `Branding`: dozens of files construct one, and this column is read by exactly
// two surfaces (the Branding panel and the reactivation gate), so it gets its
// own read rather than a field every Branding literal in the repo must grow.
describe("mailing address", () => {
  const ADDRESS = "123 Main St\nMcAllen, TX 78501";

  it("is null on a fresh account: unset is the state every account starts in", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getMailingAddress(db, accountId)).toBeNull();
    });
  });

  it("writes, reads back and clears the address, and leaves it alone when omitted", async () => {
    await withTestAccount(async (db, accountId) => {
      // Mutation: drop `patch.mailing_address` from setBranding → this reads null.
      await setBranding(db, accountId, { mailingAddress: ADDRESS }, "user_test");
      // Stored and returned verbatim, interior newline included: the email
      // prints the lines as they were typed.
      expect(await getMailingAddress(db, accountId)).toBe(ADDRESS);

      // `undefined` means leave alone, the rule every other field in the patch
      // keeps: a company renaming itself must not lose its address.
      await setBranding(db, accountId, { brandName: "Rio Roofing" }, "user_test");
      expect(await getMailingAddress(db, accountId)).toBe(ADDRESS);

      // An explicit null clears it, which is how the form's empty field reads.
      await setBranding(db, accountId, { mailingAddress: null }, "user_test");
      expect(await getMailingAddress(db, accountId)).toBeNull();
    });
  });

  it("does not ride on getBranding: the Branding shape is unchanged", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { mailingAddress: ADDRESS }, "user_test");
      expect(await getBranding(db, accountId)).not.toHaveProperty("mailingAddress");
    });
  });

  // The write path meets the CHECK, not only the catalog test: a blank that
  // got past a caller is refused, loudly, and the stored value is untouched.
  it("refuses a whitespace-only address through setBranding, and keeps the old one", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { mailingAddress: ADDRESS }, "user_test");
      await expect(setBranding(db, accountId, { mailingAddress: " \t\n " }, "user_test"))
        .rejects.toThrow(/setBranding failed/);
      expect(await getMailingAddress(db, accountId)).toBe(ADDRESS);
    });
  });

  it("reads an account that does not exist as null", async () => {
    expect(await getMailingAddress(serviceDb(), "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  // getBranding's other half: a query FAULT is not "not set". A gate that read
  // a failed query as null would refuse to enable with the wrong reason; a
  // pass that did would skip real work and blame the client.
  it("throws on a query fault instead of answering null", async () => {
    const faulty = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
        }),
      }),
    } as unknown as SupabaseClient;
    await expect(getMailingAddress(faulty, "acct")).rejects.toThrow(/getMailingAddress failed: boom/);
  });
});
