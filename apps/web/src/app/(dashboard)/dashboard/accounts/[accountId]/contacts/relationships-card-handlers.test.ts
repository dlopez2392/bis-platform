import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RelationshipView } from "@/lib/contacts/relationship-view";
import type { CardState } from "./relationships-card-handlers";

const actions = {
  setRelationshipAction: vi.fn(), undoSetRelationshipAction: vi.fn(), removeRelationshipAction: vi.fn(), undoRemoveRelationshipAction: vi.fn(),
};
vi.mock("./relationship-actions", () => actions);
const toast = { error: vi.fn(), success: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { relationshipHandlers } = await import("./relationships-card-handlers");

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "99999999-9999-4999-8999-999999999999";
const view = (over: Partial<RelationshipView> = {}): RelationshipView => ({
  id: "r1", labelKey: "parent", customLabel: null, namedSide: "a", person: { id: "p1", firstName: "Ana", lastName: "Ramírez" },
  namedForm: "f", subjectForm: null, canPickUp: false, isEmergency: false, lockedFlag: null, ...over,
});
const ready = (contactId: string, views: RelationshipView[]): CardState =>
  ({ contactId, rel: { status: "ready", subject: { firstName: "Sofía", lastName: null }, views } });

/** A setState that applies updaters to one held value, as React would. */
function holder(initial: CardState) {
  let state = initial;
  const setState = (u: CardState | ((s: CardState) => CardState)) => { state = typeof u === "function" ? u(state) : u; };
  return { setState, get: () => state };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// reset, not clear: a queued mockResolvedValueOnce one test left unconsumed must not answer the next.
beforeEach(() => vi.resetAllMocks());

describe("relationshipHandlers: one write in flight per relationship (final review item 9)", () => {
  it("a second toggle on the same relationship while the first is in flight does not write (mutation: drop the in-flight check -> FAILS)", async () => {
    const h = holder(ready(C1, [view()]));
    const handlers = relationshipHandlers({ accountId: "a1", contactId: C1, locale: "en", setState: h.setState, inFlight: new Set() });
    const first = deferred<unknown>();
    actions.setRelationshipAction.mockReturnValueOnce(first.promise);
    const a = handlers.change(view(), { canPickUp: true });
    const b = handlers.change(view(), { canPickUp: true });
    expect(actions.setRelationshipAction).toHaveBeenCalledTimes(1);
    first.resolve({ ok: true, view: view({ canPickUp: true }), undo: { contact_can_pick_up: false } });
    await Promise.all([a, b]);
    // Released once it settles: the next change on the same row writes.
    actions.setRelationshipAction.mockResolvedValueOnce({ ok: true, view: view(), undo: { contact_can_pick_up: true } });
    await handlers.change(view({ canPickUp: true }), { canPickUp: false });
    expect(actions.setRelationshipAction).toHaveBeenCalledTimes(2);
  });

  it("the lock is per relationship: another row is free while one is in flight", async () => {
    const handlers = relationshipHandlers({ accountId: "a1", contactId: C1, locale: "en", setState: holder(ready(C1, [view()])).setState, inFlight: new Set() });
    const first = deferred<unknown>();
    actions.setRelationshipAction.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: false, error: "relationships.error.failed" });
    const a = handlers.change(view(), { canPickUp: true });
    await handlers.change(view({ id: "r2" }), { namedForm: "m" });
    expect(actions.setRelationshipAction).toHaveBeenCalledTimes(2);
    first.resolve({ ok: false, error: "relationships.error.failed" });
    await a;
  });

  it("a write that throws still releases the lock", async () => {
    const handlers = relationshipHandlers({ accountId: "a1", contactId: C1, locale: "en", setState: holder(ready(C1, [view()])).setState, inFlight: new Set() });
    actions.setRelationshipAction.mockRejectedValueOnce(new Error("stale tab")).mockResolvedValueOnce({ ok: false, error: "relationships.error.failed" });
    await handlers.change(view(), { canPickUp: true });
    await handlers.change(view(), { canPickUp: true });
    expect(actions.setRelationshipAction).toHaveBeenCalledTimes(2);
  });
});

describe("relationshipHandlers: an answer lands only on the contact it was asked for (final review item 9)", () => {
  it("replace leaves a card that has moved on to another contact alone (mutation: drop the contactId check in replace -> FAILS)", () => {
    const h = holder(ready(C2, [view({ id: "r9" })]));
    const handlers = relationshipHandlers({ accountId: "a1", contactId: C1, locale: "en", setState: h.setState, inFlight: new Set() });
    const before = h.get();
    handlers.replace(view({ id: "r1" }));
    expect(h.get()).toBe(before);
  });
  it("control: replace on the same contact adds or swaps the view", () => {
    const h = holder(ready(C1, [view()]));
    const handlers = relationshipHandlers({ accountId: "a1", contactId: C1, locale: "en", setState: h.setState, inFlight: new Set() });
    handlers.replace(view({ canPickUp: true }));
    handlers.replace(view({ id: "r2" }));
    const rel = h.get().rel;
    expect(rel.status === "ready" && rel.views.map((v) => [v.id, v.canPickUp])).toEqual([["r1", true], ["r2", false]]);
  });
  it("drop leaves a card that has moved on to another contact alone (mutation: drop the contactId check in drop -> FAILS)", () => {
    const h = holder(ready(C2, [view({ id: "r1" })]));
    const handlers = relationshipHandlers({ accountId: "a1", contactId: C1, locale: "en", setState: h.setState, inFlight: new Set() });
    const before = h.get();
    handlers.drop("r1");
    expect(h.get()).toBe(before);
  });
});
