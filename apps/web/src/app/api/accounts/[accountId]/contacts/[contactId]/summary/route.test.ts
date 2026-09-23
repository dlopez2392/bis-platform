import { describe, it, expect, vi } from "vitest";

const access = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (...a: unknown[]) => access(...a) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const dbMocks = {
  getContact: vi.fn(), listContactTags: vi.fn(), listNotes: vi.fn(),
  listContactSubmissions: vi.fn(), listContactMessages: vi.fn(),
  listContactOpportunities: vi.fn(), listContactCalls: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const { GET } = await import("./route");

function req() { return new Request("http://x/api/accounts/a1/contacts/c1/summary"); }
function ctx() { return { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) }; }

describe("contact summary route", () => {
  it("404s without access, and for a missing contact", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.getContact.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it("merges sources newest-first by EPOCH not string, caps at 5", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    dbMocks.listContactTags.mockResolvedValue([{ id: "t1", name: "vip" }]);
    // The note and the call fire at the EXACT SAME instant, each in a
    // different lexical ISO form: ".000Z" sorts lexicographically AFTER
    // "+00:00" (the '.' byte is greater than '+'), even though the instants
    // are equal. A route that compares `.at` as strings would see two
    // unequal values and rank the note first; a route that compares by
    // epoch (`Date.parse`) sees a tie and Array.sort's stability then keeps
    // the two in the order they were pushed into `items` — calls before
    // notes (see route.ts) — so a correct implementation ranks the call
    // first. That's what this asserts: call, then note.
    dbMocks.listNotes.mockResolvedValue([
      { id: "n1", body: "hello", created_at: "2026-09-01T10:00:00.000Z" },
    ]);
    dbMocks.listContactCalls.mockResolvedValue([
      { id: "k1", started_at: "2026-09-01T10:00:00+00:00", outcome: "booked" },
    ]);
    dbMocks.listContactSubmissions.mockResolvedValue([]);
    dbMocks.listContactMessages.mockResolvedValue([]);
    dbMocks.listContactOpportunities.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: `o${i}`, name: `Deal ${i}`, status: "open", monetary_value: 100,
        created_at: `2026-08-2${i}T00:00:00+00:00`,
      })),
    );
    const body = await (await GET(req(), ctx())).json();
    expect(body.tags).toEqual([{ id: "t1", name: "vip" }]);
    expect(body.recent).toHaveLength(5);
    expect(body.recent[0].kind).toBe("call");   // tie, stable sort keeps construction order
    expect(body.recent[1].kind).toBe("note");
  });

  /**
   * The drawer's "No marketing emails" switch reads its starting state from
   * HERE, not from the list row: a `?peek=` deep link to a contact on another
   * page of the list has only a stub row (contacts-table.tsx's missingRow,
   * every field null), which would show an opted-out contact as unticked.
   */
  describe("marketing_email_opted_out_at", () => {
    function emptySources() {
      access.mockResolvedValue({ userId: "u1", isAgency: true });
      for (const k of ["listContactTags", "listNotes", "listContactSubmissions",
        "listContactMessages", "listContactOpportunities", "listContactCalls"] as const) {
        dbMocks[k].mockResolvedValue([]);
      }
    }

    it("carries the contact's opt-out stamp", async () => {
      emptySources();
      dbMocks.getContact.mockResolvedValue({
        id: "c1", marketing_email_opted_out_at: "2026-09-23T12:00:00+00:00",
      });
      const body = await (await GET(req(), ctx())).json();
      expect(body.marketing_email_opted_out_at).toBe("2026-09-23T12:00:00+00:00");
    });

    it("is null (not absent) for a contact who may be emailed", async () => {
      emptySources();
      dbMocks.getContact.mockResolvedValue({ id: "c1", marketing_email_opted_out_at: null });
      const body = await (await GET(req(), ctx())).json();
      expect(body).toHaveProperty("marketing_email_opted_out_at", null);
    });
  });
});
