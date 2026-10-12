import { describe, it, expect } from "vitest";
import { timelinePagerHrefs, TIMELINE_ANCHOR } from "./timeline-pager";
import { parseTimelineCursor } from "@/lib/cursor";

const BASE = "/dashboard/accounts/a1/contacts/c1";
const OLDER = { v: "2026-10-09T16:12:00.123456+00:00", id: "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c" };

describe("timelinePagerHrefs: one pager, Older carries ?before=, Newer goes back to the head (spec C3)", () => {
  it("Older's cursor round-trips exactly; Newer appears only on a paged view (mutation: always offer Newer -> FAILS)", () => {
    const head = timelinePagerHrefs({ basePath: BASE, older: OLDER, paged: false, failed: [] });
    const url = new URL(head.olderHref!, "https://x.test");
    expect(url.pathname).toBe(BASE);
    expect(url.hash).toBe(`#${TIMELINE_ANCHOR}`);
    expect(parseTimelineCursor(url.searchParams.get("before") ?? undefined)).toEqual(OLDER);
    expect(head.newerHref).toBeNull();
    const paged = timelinePagerHrefs({ basePath: BASE, older: null, paged: true, failed: [] });
    expect(paged).toEqual({ olderHref: null, newerHref: `${BASE}#${TIMELINE_ANCHOR}` });
  });
  it("keeps the QA locale override and nothing else (mutation: forward any locale string -> FAILS)", () => {
    expect(timelinePagerHrefs({ basePath: BASE, older: null, paged: true, failed: [], locale: "es" }).newerHref).toBe(`${BASE}?locale=es#${TIMELINE_ANCHOR}`);
    expect(timelinePagerHrefs({ basePath: BASE, older: null, paged: true, failed: [], locale: "\"><script>" }).newerHref).toBe(`${BASE}#${TIMELINE_ANCHOR}`);
    expect(timelinePagerHrefs({ basePath: BASE, older: null, paged: true, failed: [], locale: ["es", "es"] }).newerHref).toBe(`${BASE}#${TIMELINE_ANCHOR}`);
  });
});

describe("timelinePagerHrefs when a source failed (Task 7 review: `older` is computed from the sources that LOADED)", () => {
  it("offers no Older, since its cursor would skip the failed source's rows; Newer stays (mutation: offer Older despite failed -> FAILS)", () => {
    expect(timelinePagerHrefs({ basePath: BASE, older: OLDER, paged: true, failed: ["calls"] }))
      .toEqual({ olderHref: null, newerHref: `${BASE}#${TIMELINE_ANCHOR}` });
    expect(timelinePagerHrefs({ basePath: BASE, older: OLDER, paged: false, failed: ["notes", "bookings"] }))
      .toEqual({ olderHref: null, newerHref: null });
  });
});
