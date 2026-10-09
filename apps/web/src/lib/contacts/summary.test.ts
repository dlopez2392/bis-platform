import { describe, it, expect, vi } from "vitest";
import type { ContactSummary } from "@/app/api/accounts/[accountId]/contacts/[contactId]/summary/route";
import { parseContactSummary, summaryLoadFrom } from "./summary";

/**
 * The drawer used to CAST the summary body (`as ContactSummary`) and render
 * whatever came back. A tab on a newer bundle talking to a rolled-back server
 * gets a body missing a field the bundle expects, and the drawer then threw
 * during render — and the one error boundary replaced the whole dashboard.
 * The parser answers null for a body the drawer cannot render honestly, and
 * the drawer shows its existing "couldn't load" state instead.
 */

// Typed as the route's own contract, so a field added to the route without
// being added here fails typecheck rather than silently thinning this test.
function real(): ContactSummary {
  return {
    tags: [{ id: "t1", name: "vip" }],
    recent: [
      { kind: "call", label: "Call: Booked", at: "2026-09-01T10:00:00+00:00" },
      { kind: "note", label: "Note", at: "2026-09-01T10:00:00.000Z" },
      { kind: "submission", label: "Form submitted", at: "2026-08-30T00:00:00+00:00" },
      { kind: "message", label: "Message", at: "2026-08-29T00:00:00+00:00" },
      { kind: "opportunity", label: "Deal: Deck build ($100)", at: "2026-08-28T00:00:00+00:00" },
    ],
    phone_country_unconfirmed: true,
    phone: "+15512345678",
    zone: { zone: "America/Chicago", guessed: false, label: "America/Chicago" },
    source: "form: Contact us",
    sourceHint: "Found through ChatGPT",
  };
}

/** `real()` as it arrives over the wire: JSON, then parsed back to `unknown`. */
function wire(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body));
}

function without(key: keyof ContactSummary): unknown {
  const body: Record<string, unknown> = { ...real() };
  delete body[key];
  return wire(body);
}

describe("parseContactSummary: the route's own shape", () => {
  it("parses the route's current body, every one of the five kinds included", () => {
    expect(parseContactSummary(wire(real()))).toEqual(real());
  });

  it("parses a contact with no tags and nothing recent", () => {
    const body = { ...real(), tags: [], recent: [] };
    expect(parseContactSummary(wire(body))).toEqual(body);
  });

  it("ignores keys it does not know, and does not carry them through", () => {
    const parsed = parseContactSummary(wire({
      ...real(),
      timezone: "America/Chicago",
      tags: [{ id: "t1", name: "vip", color: "red" }],
      recent: real().recent.map((r) => ({ ...r, extra: 1 })),
      zone: { ...real().zone, source: "account" },
    }));
    expect(parsed).toEqual(real());
  });
});

describe("parseContactSummary: a required field missing or wrong is null", () => {
  it("not an object at all", () => {
    for (const body of [null, undefined, "x", 3, [], true]) {
      expect(parseContactSummary(body)).toBeNull();
    }
  });

  it("tags missing", () => {
    expect(parseContactSummary(without("tags"))).toBeNull();
  });

  it("tags not an array", () => {
    expect(parseContactSummary(wire({ ...real(), tags: { id: "t1", name: "vip" } }))).toBeNull();
  });

  it("a tag without a string id or name", () => {
    expect(parseContactSummary(wire({ ...real(), tags: [{ id: "t1" }] }))).toBeNull();
    expect(parseContactSummary(wire({ ...real(), tags: [{ id: 1, name: "vip" }] }))).toBeNull();
    expect(parseContactSummary(wire({ ...real(), tags: [null] }))).toBeNull();
  });

  it("recent missing", () => {
    expect(parseContactSummary(without("recent"))).toBeNull();
  });

  it("recent not an array", () => {
    expect(parseContactSummary(wire({ ...real(), recent: "none" }))).toBeNull();
  });

  it("a recent item that is not an object", () => {
    for (const item of [null, "Note", 3, [], true]) {
      const recent = [real().recent[0], item];
      expect(parseContactSummary(wire({ ...real(), recent })), JSON.stringify(item)).toBeNull();
    }
  });

  it("a recent item without a string label or at", () => {
    expect(parseContactSummary(wire({ ...real(), recent: [{ kind: "note", at: "2026-09-01T10:00:00Z" }] }))).toBeNull();
    expect(parseContactSummary(wire({ ...real(), recent: [{ kind: "note", label: "Note", at: 5 }] }))).toBeNull();
  });

  it("a recent item of an unknown kind whose label or at is not a string — still malformed, not dropped", () => {
    // The drop below is for a well-formed item this bundle has no kind for;
    // a broken label or at is a broken body whatever the kind says.
    expect(parseContactSummary(wire({ ...real(), recent: [{ kind: "booking", label: 7, at: "2026-09-01T10:00:00Z" }] }))).toBeNull();
    expect(parseContactSummary(wire({ ...real(), recent: [{ kind: "booking", label: "Booked" }] }))).toBeNull();
  });

  it("the summary no longer carries 0049's column, and a body that still has it loads (an old server during the deploy; consent PR-3; mutation: keep it required → FAILS)", () => {
    const parsed = parseContactSummary({ tags: [], recent: [], marketing_email_opted_out_at: "2026-09-01T00:00:00Z" });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("marketing_email_opted_out_at");
  });
});

describe("parseContactSummary: a recent item of a kind this bundle does not know is dropped", () => {
  // The drawer renders only an item's label and time, never its kind. A
  // server deployed with a new kind must not turn every open tab's drawer
  // into "couldn't load" for the contacts that have one.
  const booking = { kind: "booking", label: "Booked", at: "2026-09-02T10:00:00+00:00" };

  it("drops that item and keeps the rest of the summary, in order", () => {
    const [call, note, ...rest] = real().recent;
    const parsed = parseContactSummary(wire({ ...real(), recent: [call, booking, note, ...rest] }));
    expect(parsed).toEqual(real());
  });

  it("drops a kind that is an inherited property name, not a kind", () => {
    // `=== true`, not `in`: "constructor" is a property of any object.
    for (const kind of ["constructor", "toString", "__proto__"]) {
      const parsed = parseContactSummary(wire({ ...real(), recent: [{ ...booking, kind }, real().recent[1]] }));
      expect(parsed, kind).not.toBeNull();
      expect(parsed!.recent, kind).toEqual([real().recent[1]]);
    }
  });

  it("drops a missing or non-string kind", () => {
    const kindless = { label: booking.label, at: booking.at };
    for (const item of [kindless,{ ...booking, kind: 3 }, { ...booking, kind: null }]) {
      const parsed = parseContactSummary(wire({ ...real(), recent: [item] }));
      expect(parsed, JSON.stringify(item)).not.toBeNull();
      expect(parsed!.recent, JSON.stringify(item)).toEqual([]);
    }
  });

  it("a body whose every recent item is unknown still loads, tags and stamp intact", () => {
    const parsed = parseContactSummary(wire({ ...real(), recent: [booking, booking] }));
    expect(parsed).toEqual({ ...real(), recent: [] });
  });
});

describe("parseContactSummary: zone is tolerated, never required", () => {
  it("missing (a server from before #124) parses, with zone undefined", () => {
    const parsed = parseContactSummary(without("zone"));
    expect(parsed).not.toBeNull();
    expect(parsed!.zone).toBeUndefined();
    expect(parsed!.tags).toEqual(real().tags);
  });

  it("malformed parses, with zone undefined", () => {
    for (const zone of [
      "America/Chicago",
      null,
      { zone: "America/Chicago", guessed: "no", label: "America/Chicago" },
      { zone: "America/Chicago", guessed: false },
      { guessed: false, label: "UTC" },
    ]) {
      const parsed = parseContactSummary(wire({ ...real(), zone }));
      expect(parsed, JSON.stringify(zone)).not.toBeNull();
      expect(parsed!.zone, JSON.stringify(zone)).toBeUndefined();
    }
  });

  it("a zone name this browser's Intl cannot use parses, with zone undefined", () => {
    // The "Off since" line formats in this zone, and Intl THROWS on one it
    // does not know — inside the drawer's render.
    const parsed = parseContactSummary(wire({
      ...real(), zone: { zone: "Not/A_Zone", guessed: false, label: "Not/A_Zone" },
    }));
    expect(parsed).not.toBeNull();
    expect(parsed!.zone).toBeUndefined();
  });
});

describe("parseContactSummary: phone_country_unconfirmed is tolerated, never required (consent chain PR-1)", () => {
  it("carries true through, so the drawer's Check number row shows (mutation: drop the field from the return → FAILS)", () => {
    expect(parseContactSummary(wire(real()))?.phone_country_unconfirmed).toBe(true);
  });

  it("carries false through", () => {
    expect(parseContactSummary(wire({ ...real(), phone_country_unconfirmed: false }))?.phone_country_unconfirmed).toBe(false);
  });

  it("missing (a server from before PR-1) is false and the rest still loads (mutation: make it required → null, FAILS)", () => {
    const parsed = parseContactSummary(without("phone_country_unconfirmed"));
    expect(parsed).not.toBeNull();
    expect(parsed?.phone_country_unconfirmed).toBe(false);
  });

  it("anything but the boolean true is false — never a truthy string (mutation: Boolean(v) → \"false\" shows the row, FAILS)", () => {
    for (const v of ["true", "false", 1, {}, null]) {
      expect(parseContactSummary(wire({ ...real(), phone_country_unconfirmed: v }))?.phone_country_unconfirmed).toBe(false);
    }
  });
});

/**
 * Round 3, review I3: the drawer's Check number row passes THIS field as
 * the phone the operator SAW — never the list row's `?peek=` stub. TOLERATED
 * like the flag: missing, or anything but a string, is null (a server from
 * before round 3 sends none), and the row's pick then fails closed on it
 * rather than trusting a stub.
 */
describe("parseContactSummary: phone (round 3, review I3)", () => {
  it("carries the stored phone through (mutation: drop the field from the return → FAILS)", () => {
    expect(parseContactSummary(wire(real()))?.phone).toBe("+15512345678");
  });

  it("missing (a server from before round 3) is null and the rest still loads (mutation: make it required → null, FAILS)", () => {
    const parsed = parseContactSummary(without("phone"));
    expect(parsed).not.toBeNull();
    expect(parsed?.phone).toBeNull();
  });

  it("anything but a real string is null — never coerced (mutation: String(v) → FAILS)", () => {
    for (const v of [1, {}, true]) {
      expect(parseContactSummary(wire({ ...real(), phone: v }))?.phone).toBeNull();
    }
  });

  it("a contact with no phone at all parses to null, not dropped", () => {
    expect(parseContactSummary(wire({ ...real(), phone: null }))?.phone).toBeNull();
  });
});

/**
 * F-157: the Source line's two parts, both TOLERATED like phone above — a
 * server from before this rider sends neither, and the drawer must still
 * load (no InlineField to edit, no hint caption; never "couldn't load").
 */
describe("parseContactSummary: source and sourceHint (F-157)", () => {
  it("carries both through (mutation: drop either field from the return → FAILS)", () => {
    const parsed = parseContactSummary(wire(real()));
    expect(parsed?.source).toBe("form: Contact us");
    expect(parsed?.sourceHint).toBe("Found through ChatGPT");
  });

  it("source missing (a server from before this rider) is null and the rest still loads (mutation: make it required → null, FAILS)", () => {
    const parsed = parseContactSummary(without("source"));
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBeNull();
  });

  it("sourceHint missing is null and the rest still loads", () => {
    const parsed = parseContactSummary(without("sourceHint"));
    expect(parsed).not.toBeNull();
    expect(parsed?.sourceHint).toBeNull();
  });

  it("sourceHint can genuinely be null (nothing extra to add) and parses as null, not dropped", () => {
    const parsed = parseContactSummary(wire({ ...real(), sourceHint: null }));
    expect(parsed).not.toBeNull();
    expect(parsed?.sourceHint).toBeNull();
  });

  it("anything but a real string is null — never coerced (mutation: String(v) → FAILS)", () => {
    for (const v of [1, {}, true]) {
      const parsed = parseContactSummary(wire({ ...real(), source: v, sourceHint: v }));
      expect(parsed?.source).toBeNull();
      expect(parsed?.sourceHint).toBeNull();
    }
  });
});

describe("summaryLoadFrom: the drawer's response handling", () => {
  function res(ok: boolean, body: unknown) {
    return { ok, json: vi.fn(async () => body) };
  }

  it("a good body is ready, with the parsed summary and the caller's clock", async () => {
    expect(await summaryLoadFrom(res(true, wire(real())), 1_700_000_000_000)).toEqual({
      status: "ready", summary: real(), nowMs: 1_700_000_000_000,
    });
  });

  it("a body the parser refuses is the error state, not a cast", async () => {
    expect(await summaryLoadFrom(res(true, without("tags")), 1)).toEqual({ status: "error" });
  });

  it("a body missing only the zone is still ready", async () => {
    const load = await summaryLoadFrom(res(true, without("zone")), 1);
    expect(load.status).toBe("ready");
    expect(load.status === "ready" && load.summary.zone).toBeUndefined();
  });

  it("a non-OK response is the error state, and its body is never read", async () => {
    // A body that WOULD parse, so only the status check can make this an error.
    const r = res(false, wire(real()));
    expect(await summaryLoadFrom(r, 1)).toEqual({ status: "error" });
    expect(r.json).not.toHaveBeenCalled();
  });
});
