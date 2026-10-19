import { describe, it, expect } from "vitest";
import type { Proposal } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { buildSuggestionView, type SuggestionView } from "./view";
import { groupByAccount, groupSuggestions } from "./group";
import { NAMES, NOW, PIPELINE_STAGES, STAGES, ZONE, rows } from "@/components/proposals/suggestion-specimens";

/** Intl's own spaces (U+00A0, U+202F) read as plain spaces, so the typed-out literals stay readable. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

// Three calls on three days (9:42 AM, 10:15 AM, 4:05 PM in Chicago) and the rows they produced. The read
// answers newest first, as listPendingProposals does.
const CALLS = new Map<string, { startedAt: string | null; contactId: string | null }>([
  ["call_ana", { startedAt: "2026-10-14T14:42:00.000Z", contactId: "con_ana" }],
  ["call_ana2", { startedAt: "2026-10-12T15:15:00.000Z", contactId: "con_ana" }],
  ["call_luis", { startedAt: "2026-10-13T21:05:00.000Z", contactId: "con_luis" }],
  ["call_unknown", { startedAt: "2026-10-14T20:00:00.000Z", contactId: null }],
]);
const NAMES_OF: Record<string, string> = { con_ana: "Ana Lopez", con_luis: "Luis Garza" };

const row = (id: string, callId: string, contactId: string | null, createdAt: string): Proposal =>
  ({ ...rows.pending, id, callId, contactId, createdAt });

function viewsOf(list: Proposal[], locale: Locale = "en"): Map<string, SuggestionView> {
  const tr = makeTr(locale);
  return new Map(list.map((p) => [p.id, buildSuggestionView(p, {
    tr, zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES, callerName: null,
    callStartedAt: CALLS.get(p.callId!)?.startedAt ?? null, personaName: "Sofia", names: NAMES, viewerId: null,
  })]));
}
const group = (list: Proposal[], locale: Locale = "en") =>
  groupSuggestions(list, viewsOf(list, locale), { tr: makeTr(locale), zone: ZONE, contactNames: NAMES_OF, callsById: CALLS })
    .map((g) => ({ heading: plain(g.heading), ids: g.views.map((v) => v.id) }));

describe("groupSuggestions: by customer, then by the call", () => {
  // The read's order: newest first. Ana's call has a newer AND an older card; the no-customer row is the newest.
  const read = [
    row("sg_none", "call_unknown", null, "2026-10-14T21:00:00.000Z"),
    row("sg_ana_new", "call_ana", "con_ana", "2026-10-14T15:00:00.000Z"),
    row("sg_luis", "call_luis", "con_luis", "2026-10-14T13:00:00.000Z"),
    row("sg_ana_old", "call_ana", "con_ana", "2026-10-14T12:00:00.000Z"),
  ];

  it("two customers and a no-customer row are three groups, ordered by their newest card (mutation: order groups by oldest -> FAILS)", () => {
    expect(group(read)).toEqual([
      { heading: "No customer yet · from the call on Wed, Oct 14", ids: ["sg_none"] },
      { heading: "Ana Lopez · from the call on Wed, Oct 14", ids: ["sg_ana_new", "sg_ana_old"] },
      { heading: "Luis Garza · from the call on Tue, Oct 13", ids: ["sg_luis"] },
    ]);
  });

  it("the headings read Spanish typed out", () => {
    expect(group(read, "es").map((g) => g.heading)).toEqual([
      "Sin cliente todavía · de la llamada del mié, 14 de oct",
      "Ana Lopez · de la llamada del mié, 14 de oct",
      "Luis Garza · de la llamada del mar, 13 de oct",
    ]);
  });

  it("two calls for one customer are two groups", () => {
    const two = [row("sg_a1", "call_ana", "con_ana", "2026-10-14T15:00:00.000Z"), row("sg_a2", "call_ana2", "con_ana", "2026-10-12T16:00:00.000Z")];
    expect(group(two)).toEqual([
      { heading: "Ana Lopez · from the call on Wed, Oct 14", ids: ["sg_a1"] },
      { heading: "Ana Lopez · from the call on Mon, Oct 12", ids: ["sg_a2"] },
    ]);
  });

  it("the customer is the row's own contact_id even when the call's contact differs (P14; mutation: name the call's contact -> FAILS)", () => {
    // call_luis's caller is Luis; the suggestion is about Ana.
    expect(group([row("sg_x", "call_luis", "con_ana", "2026-10-14T13:00:00.000Z")])).toEqual([
      { heading: "Ana Lopez · from the call on Tue, Oct 13", ids: ["sg_x"] },
    ]);
  });

  it("a customer whose name did not resolve reads (no name), never No customer yet; a call with no start reads the row's day", () => {
    const list = [row("sg_n", "call_gone", "con_gone", "2026-10-11T15:00:00.000Z")];
    expect(group(list)).toEqual([{ heading: "(no name) · from the call on Sun, Oct 11", ids: ["sg_n"] }]);
    expect(group(list, "es")).toEqual([{ heading: "(sin nombre) · de la llamada del dom, 11 de oct", ids: ["sg_n"] }]);
  });

  it("a row with no view is left out, and a group left empty is not drawn", () => {
    const list = [row("sg_a", "call_ana", "con_ana", "2026-10-14T15:00:00.000Z"), row("sg_l", "call_luis", "con_luis", "2026-10-14T13:00:00.000Z")];
    const views = viewsOf(list);
    views.delete("sg_l");
    expect(groupSuggestions(list, views, { tr: makeTr("en"), zone: ZONE, contactNames: NAMES_OF, callsById: CALLS })
      .map((g) => g.views.map((v) => v.id))).toEqual([["sg_a"]]);
  });

  it("each group's key is the customer, the source and the call", () => {
    expect(groupSuggestions(read, viewsOf(read), { tr: makeTr("en"), zone: ZONE, contactNames: NAMES_OF, callsById: CALLS })
      .map((g) => g.key)).toEqual(["none:call:call_unknown", "con_ana:call:call_ana", "con_luis:call:call_luis"]);
  });
});

describe("groupByAccount: the agency's rows per account", () => {
  const agency = (id: string, accountId: string, createdAt: string, accountCapped = false) =>
    ({ ...row(id, "call_ana", "con_ana", createdAt), accountId, brandName: `Brand ${accountId}`, timezone: ZONE, accountCapped });

  it("accounts are ordered by their newest card, each keeps its rows in the read's order, its brand and its cap (mutation: order by oldest -> FAILS)", () => {
    // The agency read orders by account, not by time: acc_b's newest card is the newest of all.
    const read = [
      agency("a1", "acc_a", "2026-10-14T12:00:00.000Z", true),
      agency("a2", "acc_a", "2026-10-10T12:00:00.000Z", true),
      agency("b1", "acc_b", "2026-10-14T18:00:00.000Z"),
      agency("b2", "acc_b", "2026-10-14T09:00:00.000Z"),
      agency("c1", "acc_c", "2026-10-13T12:00:00.000Z"),
    ];
    expect(groupByAccount(read).map((a) => ({ id: a.accountId, brand: a.brandName, capped: a.accountCapped, zone: a.timezone, rows: a.rows.map((r) => r.id) })))
      .toEqual([
        { id: "acc_b", brand: "Brand acc_b", capped: false, zone: ZONE, rows: ["b1", "b2"] },
        { id: "acc_a", brand: "Brand acc_a", capped: true, zone: ZONE, rows: ["a1", "a2"] },
        { id: "acc_c", brand: "Brand acc_c", capped: false, zone: ZONE, rows: ["c1"] },
      ]);
  });

  it("no rows, no accounts", () => {
    expect(groupByAccount([])).toEqual([]);
  });
});
