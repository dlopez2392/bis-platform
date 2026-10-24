import { describe, it, expect } from "vitest";
import { cardFocusFrom, workRowHref } from "./card-focus";

/** S-07 3a (spec 3.2; plan deviations 5, 6): the To-do's link and the card's reading of it, one contract. */
const DOC = "0f8fad5b-d9cb-469f-a165-70867728950e";
const A = "acct1";

describe("workRowHref", () => {
  it("an expiry To-do on a customer links to the customer with the file and its category (mutation: drop ask -> FAILS)", () => {
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "insurance", groupId: null } }))
      .toBe(`/dashboard/accounts/acct1/contacts/c1?document=${DOC}&ask=insurance`);
  });
  it("a household's file links to the household, whether the To-do landed on its primary contact or on nobody (mutation: prefer the contact -> FAILS)", () => {
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "permit", groupId: "g1" } }))
      .toBe(`/dashboard/accounts/acct1/groups/g1?document=${DOC}&ask=permit`);
    expect(workRowHref(A, { contactId: null, documentFocus: { documentId: DOC, category: "permit", groupId: "g1" } }))
      .toBe(`/dashboard/accounts/acct1/groups/g1?document=${DOC}&ask=permit`);
  });
  it("Other and an unreadable category carry no ask (2c D8); a plain To-do keeps its plain link; nothing to link is null", () => {
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "other", groupId: null } })).toBe(`/dashboard/accounts/acct1/contacts/c1?document=${DOC}`);
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: null, groupId: null } })).toBe(`/dashboard/accounts/acct1/contacts/c1?document=${DOC}`);
    expect(workRowHref(A, { contactId: "c1" })).toBe("/dashboard/accounts/acct1/contacts/c1");
    expect(workRowHref(A, { contactId: null })).toBeNull();
  });
});

describe("workRowHref: the closure To-do's link (S-47d Task 7)", () => {
  it("status links to the dashboard's status card; closed_day links to the calendar's closed days, by its own date, as literals (mutation: swap the two anchors -> FAILS)", () => {
    expect(workRowHref(A, { contactId: null, closureFocus: { kind: "status", on: "2026-12-24" } }))
      .toBe("/dashboard/accounts/acct1/dashboard#business-status");
    expect(workRowHref(A, { contactId: null, closureFocus: { kind: "closed_day", on: "2026-12-24" } }))
      .toBe("/dashboard/accounts/acct1/calendar?closedDay=2026-12-24#closed-days");
  });
  it("a closure row with a contactId still links to the closure, not the customer (mutation: check closureFocus after contactId -> FAILS)", () => {
    expect(workRowHref(A, { contactId: "c1", closureFocus: { kind: "status", on: "2026-12-24" } }))
      .toBe("/dashboard/accounts/acct1/dashboard#business-status");
  });
});

describe("cardFocusFrom", () => {
  it("reads back exactly what workRowHref wrote (mutation: rename either parameter on one side -> FAILS)", () => {
    const href = workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "warranty", groupId: null } })!;
    expect(cardFocusFrom(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual({ documentId: DOC, ask: "warranty" });
  });
  it("drops anything that is not a file id or a requirable category; nothing valid is undefined, so a page passes no prop (mutation: answer {null, null} -> FAILS)", () => {
    expect(cardFocusFrom({ document: DOC.toUpperCase(), ask: "other" })).toEqual({ documentId: DOC, ask: null });
    expect(cardFocusFrom({ document: "x\"]", ask: "insurance" })).toEqual({ documentId: null, ask: "insurance" });
    expect(cardFocusFrom({ document: [DOC], ask: ["id"] })).toBeUndefined();
    expect(cardFocusFrom({})).toBeUndefined();
    expect(cardFocusFrom(undefined)).toBeUndefined();
  });
});
