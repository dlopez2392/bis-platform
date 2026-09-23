import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({
  setBranding: vi.fn(),
  getBranding: vi.fn(),
  uploadBrandLogo: vi.fn(),
  removeBrandLogo: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));
// setBrandingAction writes through the RLS-enforced client, not serviceDb() —
// see the action's own doc comment. A real client is unnecessary here since
// dbForRequest's result only ever flows straight into the (mocked)
// setBranding call.
const dbForRequestInstance = { tag: "dbForRequest" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => dbForRequestInstance }));

import { m } from "@/lib/messages";
import { setBrandingAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  dbMocks.setBranding.mockReset().mockResolvedValue(undefined);
  dbMocks.getBranding.mockReset();
  dbMocks.uploadBrandLogo.mockReset();
  dbMocks.removeBrandLogo.mockReset();
});

describe("setBrandingAction — brand name is required", () => {
  it("refuses a blank brandName without writing", async () => {
    expect(await setBrandingAction("acct_1", fd({ brandName: "" })))
      .toEqual({ ok: false, error: m["branding.nameRequired"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only brandName without writing", async () => {
    // Mutation: delete the `if (!brandName) return …` guard in the action —
    // a whitespace name then saves as "" instead of being refused. (Restoring
    // the old `|| null` alone is NOT a mutation that bites: null is falsy, so
    // the guard still refuses it.)
    expect(await setBrandingAction("acct_1", fd({ brandName: "   " })))
      .toEqual({ ok: false, error: m["branding.nameRequired"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("saves a normal, trimmed name", async () => {
    expect(await setBrandingAction("acct_1", fd({ brandName: "  Acme Dental  " })))
      .toEqual({ ok: true });
    expect(dbMocks.setBranding).toHaveBeenCalledWith(
      dbForRequestInstance, "acct_1",
      {
        brandName: "Acme Dental", brandColor: null, brandNeutral: null,
        brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
        mailingAddress: null,
      },
      "user_1",
    );
  });
});

/**
 * The postal address the reactivation email prints (migration 0048). The
 * database CHECK refuses a value that is blank once EXACTLY `.trim()`'s set is
 * stripped, and caps it at 300 code points; the action has to be at least that
 * strict, never looser, or a save reaches Postgres and comes back as the
 * generic "Could not update branding" instead of a message anyone can act on.
 */
describe("setBrandingAction — mailing address", () => {
  /** What setBranding received as its input object, for the one call made. */
  const sent = () => dbMocks.setBranding.mock.calls[0]![2] as Record<string, unknown>;

  it("saves the address trimmed, keeping the line breaks inside it", async () => {
    // Mutation: drop the `.trim()` on the raw address → FAILS (the padding and
    // the trailing newline reach setBranding).
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: "  \n123 Main St\nMcAllen, TX 78501 \n ",
    }))).toEqual({ ok: true });
    expect(sent().mailingAddress).toBe("123 Main St\nMcAllen, TX 78501");
  });

  it("clears it (null, never \"\") when the box is emptied", async () => {
    // Mutation: pass the trimmed string through instead of `=== "" ? null` →
    // FAILS with "" (a second spelling of "not set", which the column refuses).
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: "" })))
      .toEqual({ ok: true });
    expect(sent().mailingAddress).toBeNull();
  });

  it("clears it when the box holds only whitespace — every kind .trim() strips", async () => {
    // Tab, line breaks, a no-break space, a byte-order mark and an
    // ideographic space — written as `\u` escapes so the line is reviewable:
    // blank to the send path's `.trim()` and to the column's CHECK, so this
    // must arrive as null and never be sent to the database as text.
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: " \t\r\n\u00A0\uFEFF\u3000 ",
    }))).toEqual({ ok: true });
    expect(sent().mailingAddress).toBeNull();
  });

  it("refuses 301 characters with its own message, without writing", async () => {
    // Mutation: delete the length check → FAILS (the action writes it).
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: "a".repeat(301) })))
      .toEqual({ ok: false, error: m["branding.mailingAddressTooLong"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("accepts exactly 300, and counts the length AFTER trimming", async () => {
    // Mutation: `>= 300` → FAILS on the first call; checking the raw length
    // before trimming → FAILS on the second (302 raw, 300 once trimmed).
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: "a".repeat(300) })))
      .toEqual({ ok: true });
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: ` ${"a".repeat(300)}\n` })))
      .toEqual({ ok: true });
    expect(dbMocks.setBranding).toHaveBeenCalledTimes(2);
    expect(dbMocks.setBranding.mock.calls[1]![2]).toMatchObject({ mailingAddress: "a".repeat(300) });
  });

  it("normalizes CRLF (and lone CR) line breaks to LF before storing", async () => {
    // An HTML form submission normalizes a textarea's line breaks to CRLF
    // regardless of what the user actually typed (browsers do this on
    // submit, not on keystroke) — CI's e2e run caught this: the browser sent
    // "PO Box 12\r\nEdinburg, TX 78539" and the column held the \r\n verbatim.
    // Mutation: delete the normalization → FAILS (the \r survives to
    // setBranding untouched).
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: "PO Box 12\r\nEdinburg, TX 78539",
    }))).toEqual({ ok: true });
    expect(sent().mailingAddress).toBe("PO Box 12\nEdinburg, TX 78539");

    // A lone \r (old Mac-style) is normalized too, not just \r\n pairs.
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: "PO Box 12\rEdinburg, TX 78539",
    }))).toEqual({ ok: true });
    expect(dbMocks.setBranding.mock.calls[1]![2]).toMatchObject({
      mailingAddress: "PO Box 12\nEdinburg, TX 78539",
    });
  });

  it("rides the write that also carries a new logo", async () => {
    // The action has TWO setBranding call sites (with and without a new logo
    // path). Mutation: drop mailingAddress from the logo branch's object →
    // FAILS here and nowhere else.
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: null });
    dbMocks.uploadBrandLogo.mockResolvedValue("acct_1/logo.png");
    const f = fd({ brandName: "Acme Dental", mailingAddress: "PO Box 12, Edinburg, TX 78539" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    f.set("logo", new File([png], "logo.png", { type: "image/png" }));
    expect(await setBrandingAction("acct_1", f)).toEqual({ ok: true });
    expect(sent()).toMatchObject({
      brandLogoPath: "acct_1/logo.png", mailingAddress: "PO Box 12, Edinburg, TX 78539",
    });
  });
});
