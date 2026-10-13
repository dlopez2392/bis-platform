import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("./groups-actions", () => ({
  searchGroupsAction: vi.fn(), createGroupAction: vi.fn(), addToGroupAction: vi.fn(), setRoleAction: vi.fn(),
  setBillingAction: vi.fn(), makePrimaryAction: vi.fn(), removeMembershipAction: vi.fn(), restoreMembershipAction: vi.fn(),
  renameGroupAction: vi.fn(), setBillingAddressAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const { GroupsCardView, addExisting, createAndAdd, toggleBilling, makeMain, removeFrom, searchOutcome, groupsLoadFrom, nameSave, roleSave, inlineUndo } = await import("./groups-card");
const actions = await import("./groups-actions");
const { toast } = await import("sonner");

const group = (over: Partial<Record<string, unknown>> = {}) => ({
  memberId: "m1", groupId: "g1", kind: "household", name: "Garcia", billingAddress: null, role: "Madre",
  isPrimary: true, isBilling: true, others: [{ contactId: "c2", firstName: "Luis", lastName: null }], moreOthers: 0, ...over,
});
const view = (load: unknown, canManageGroups = true) => renderToStaticMarkup(createElement(GroupsCardView, {
  accountId: "a1", contactId: "c1", canManageGroups, load: load as never, onRetry: () => {}, onChanged: () => {},
}));

describe("GroupsCardView", () => {
  it("loading is skeleton rows, never a spinner", () => {
    const html = view({ status: "loading" });
    expect(html).toContain('data-testid="groups-skeleton"');
    expect(html).not.toMatch(/spinner|animate-spin/);
  });
  it("error offers Retry inside the card", () => {
    const html = view({ status: "error" });
    expect(renderedText(html)).toContain(m["groups.loadFailed"]);
    expect(html).toContain(m["groups.retry"]);
  });
  it("the error is plain words and a ghost Try again, announced, never a tinted box inside the glass card (design check 1a, M2; mutation: put back the crit Notice -> FAILS)", () => {
    const html = view({ status: "error" });
    expect(html).toMatch(/<div role="alert"[^>]*><p[^>]*>[^<]*<\/p><button[^>]*data-variant="ghost"[^>]*>Try again<\/button><\/div>/);
    expect(html).not.toContain('data-slot="notice"');
    expect(html).not.toContain("--crit-bg");
  });
  it("empty sells the feature with its action (rule 5)", () => {
    const html = view({ status: "ready", groups: [] });
    expect(html).toContain(m["groups.empty"]);
    expect(html).toContain(m["groups.add"]);
  });
  it("loaded: kind as a word, main and pays as dot + word, the other members (rule 3; mutation: render the main mark as a coloured dot alone -> FAILS)", () => {
    const html = view({ status: "ready", groups: [group(), group({ memberId: "m2", groupId: "g2", kind: "business", name: "Acme Roofing", isPrimary: false, isBilling: false, others: [] })] });
    expect(html).toContain(m["groups.kind.household"]);
    expect(html).toContain(m["groups.kind.business"]);
    expect(html).toMatch(new RegExp(`data-mark="primary"[^>]*>.*?${m["groups.primary"]}`));
    expect(html).toMatch(new RegExp(`data-mark="billing"[^>]*>.*?${m["groups.billing"]}`));
    expect(html).toContain(m["groups.makePrimary"]);
    expect(html).toContain("Luis");
    expect(html).toContain("/dashboard/accounts/a1/contacts?peek=c2");
    expect(html).not.toMatch(/\bCompany\b/);
  });
  it("a group with more co-members than the card names says how many more, in words (final review minor 10; mutation: drop the more line -> FAILS)", () => {
    const more = renderedText(view({ status: "ready", groups: [group({ moreOthers: 3 })] })).replace(/\s+/g, " ");
    expect(more).toContain(`Luis ${m["groups.othersMore"].replace("{count}", "3")}`);
    expect(m["groups.othersMore.es"].replace("{count}", "3")).toBe("y 3 más");
    const none = renderedText(view({ status: "ready", groups: [group()] }));
    expect(none).not.toContain(m["groups.othersMore"].replace("{count}", "0"));
  });
  it("a Technician gets no rename or billing address editor (A6)", () => {
    const html = view({ status: "ready", groups: [group()] }, false);
    expect(html).not.toContain(`${m["inline.edit"].replace("{label}", m["groups.name"])}`);
    expect(html).not.toContain(m["groups.billingAddress"]);
    expect(html).toContain("Garcia");
  });
  it("an empty role shows the spec's placeholder, not the generic one (spec §8; mutation: drop the placeholder prop -> FAILS)", () => {
    const html = view({ status: "ready", groups: [group({ role: null })] });
    expect(html).toContain(`>${m["groups.rolePlaceholder"]}</button>`);
  });
  it("an off 'Pays the bills' carries no billing mark, so on and off never read alike (rule 3; mutation: always render the mark -> FAILS)", () => {
    const html = view({ status: "ready", groups: [group({ isBilling: false })] });
    expect(html).not.toContain('data-mark="billing"');
    expect(html).toContain('aria-pressed="false"');
  });
  it("the remove action names its group, so two rows never share one accessible name", () => {
    const html = view({ status: "ready", groups: [group()] });
    expect(html).toContain(`aria-label="${m["groups.remove"]}: Garcia"`);
  });
  it("each row has its own Open link to its own group's page (S-03 part 2b; mutation: link the first group for every row -> FAILS)", () => {
    const html = view({ status: "ready", groups: [group(), group({ memberId: "m2", groupId: "g2", kind: "business", name: "Acme Roofing" })] });
    expect(html).toContain('data-group-open="g1" href="/dashboard/accounts/a1/groups/g1"');
    expect(html).toContain('data-group-open="g2" href="/dashboard/accounts/a1/groups/g2"');
    expect(html).toContain(`aria-label="${m["groups.openAria"].replace("{name}", "Garcia")}"`);
    expect(html).toContain(`aria-label="${m["groups.openAria"].replace("{name}", "Acme Roofing")}"`);
    expect(html).toContain(`>${m["groups.open"]}<`);
  });
  it("headingHidden keeps the heading for aria-labelledby but hides it, so RecordCard's title is the one seen (S-03 §8; mutation: ignore the prop -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(GroupsCardView, {
      accountId: "a1", contactId: "c1", canManageGroups: true, headingHidden: true, load: { status: "loading" } as never, onRetry: () => {}, onChanged: () => {},
    }));
    expect(html).toMatch(/<h3 id="([^"]+)" class="sr-only">/);
    const id = html.match(/<h3 id="([^"]+)"/)![1];
    expect(html).toContain(`aria-labelledby="${id}"`);
    expect(view({ status: "loading" })).not.toContain('class="sr-only"');
  });
  it("headingHidden: no empty row under RecordCard's title, and the Add control stays right; the drawer's row is unchanged (review round 1, minor 3; mutation: keep the justify-between row -> FAILS)", () => {
    const hidden = (load: unknown) => renderToStaticMarkup(createElement(GroupsCardView, {
      accountId: "a1", contactId: "c1", canManageGroups: true, headingHidden: true, load: load as never, onRetry: () => {}, onChanged: () => {},
    }));
    expect(hidden({ status: "loading" })).toMatch(/^<section[^>]*><h3 id="[^"]+" class="sr-only">/);
    expect(hidden({ status: "ready", groups: [group()] })).toMatch(/^<section[^>]*><div class="flex items-center justify-end gap-2"><h3 id="[^"]+" class="sr-only">/);
    expect(view({ status: "loading" })).toMatch(/^<section[^>]*><div class="flex items-center justify-between gap-2"><h3 /);
  });
});

const ok = <T,>(v: T) => ({ ok: true as const, ...v });
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);
/** The Undo the last success toast offered, or null when it offered none. */
const undoOffered = (): (() => void) | null => {
  const opts = toastSuccess.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  return opts?.action?.onClick ?? null;
};

beforeEach(() => { vi.clearAllMocks(); });

describe("the card's writes: feedback and Undo (rule 6)", () => {
  it("remove says so by name and offers Undo, which restores the SAME snapshot and refreshes (mutation: restore without the returned snapshot -> FAILS)", async () => {
    const snapshot = { id: "m1", account_id: "a1", client_group_id: "g1", contact_id: "c1", role: "Madre", is_primary: true, is_billing: true, is_primary_contact: false, created_at: "2026-10-01T00:00:00Z" };
    vi.mocked(actions.removeMembershipAction).mockResolvedValue(ok({ removed: snapshot }));
    vi.mocked(actions.restoreMembershipAction).mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    await removeFrom("a1", group() as never, onChanged);
    expect(toastSuccess.mock.calls.at(-1)?.[0]).toBe(m["groups.removed"].replace("{name}", "Garcia"));
    expect(onChanged).toHaveBeenCalledTimes(1);
    undoOffered()!();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(actions.restoreMembershipAction).toHaveBeenCalledWith("a1", snapshot);
  });

  it("an add to an existing group offers NO Undo (review correction 1; mutation: offer one -> FAILS)", async () => {
    vi.mocked(actions.addToGroupAction).mockResolvedValue(ok({ memberId: "m9" }));
    await addExisting("a1", "c1", { id: "g7", kind: "household", name: "Lopez" }, vi.fn());
    expect(actions.addToGroupAction).toHaveBeenCalledWith("a1", "c1", "g7");
    expect(toastSuccess.mock.calls.at(-1)?.[0]).toBe(m["groups.added"].replace("{name}", "Lopez"));
    expect(undoOffered()).toBeNull();
  });

  it("a create that found the business already there says so, with the stored name and NO Undo (spec §8; correction 1)", async () => {
    vi.mocked(actions.createGroupAction).mockResolvedValue(ok({ memberId: "m9", name: "Acme Roofing", existed: true }));
    await createAndAdd("a1", "c1", "business", "acme roofing", vi.fn());
    expect(actions.createGroupAction).toHaveBeenCalledWith("a1", "c1", "business", "acme roofing");
    expect(toastSuccess.mock.calls.at(-1)?.[0]).toBe(m["groups.addedExisting"].replace("{name}", "Acme Roofing"));
    expect(undoOffered()).toBeNull();
  });

  it("Pays the bills flips the flag, and its Undo writes back the server's own previous value (mutation: undo with !isBilling -> FAILS)", async () => {
    vi.mocked(actions.setBillingAction).mockResolvedValue(ok({ previous: false }));
    await toggleBilling("a1", group({ isBilling: false }) as never, vi.fn());
    expect(actions.setBillingAction).toHaveBeenLastCalledWith("a1", "m1", true);
    vi.mocked(actions.setBillingAction).mockResolvedValue(ok({ previous: true }));
    undoOffered()!();
    await vi.waitFor(() => expect(actions.setBillingAction).toHaveBeenCalledTimes(2));
    expect(actions.setBillingAction).toHaveBeenLastCalledWith("a1", "m1", false);
  });

  it("Make main offers Undo back to the previous main, and none when there was no previous main (mutation: always offer -> FAILS)", async () => {
    vi.mocked(actions.makePrimaryAction).mockResolvedValue(ok({ previous: "m0" }));
    await makeMain("a1", group({ isPrimary: false }) as never, vi.fn());
    undoOffered()!();
    await vi.waitFor(() => expect(actions.makePrimaryAction).toHaveBeenLastCalledWith("a1", "m0"));
    vi.mocked(actions.makePrimaryAction).mockResolvedValue(ok({ previous: null }));
    await makeMain("a1", group({ isPrimary: false }) as never, vi.fn());
    expect(undoOffered()).toBeNull();
  });

  it("a refusal is the catalogue's sentence, never the raw key, and nothing refreshes (mutation: toast r.error itself -> FAILS)", async () => {
    vi.mocked(actions.setBillingAction).mockResolvedValue({ ok: false, error: "groups.refused" });
    const onChanged = vi.fn();
    await toggleBilling("a1", group() as never, onChanged);
    expect(toastError).toHaveBeenCalledWith(m["groups.refused"]);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a server action that REJECTS (a stale tab after a deploy) is a toast, never an unhandled throw (mutation: drop the try -> FAILS)", async () => {
    vi.mocked(actions.removeMembershipAction).mockRejectedValue(new Error("Failed to find Server Action"));
    await expect(removeFrom("a1", group() as never, vi.fn())).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledWith(m["groups.failed"]);
  });

  it("an Undo that is refused says so (mutation: ignore the undo's result -> FAILS)", async () => {
    vi.mocked(actions.setBillingAction).mockResolvedValueOnce(ok({ previous: true }));
    await toggleBilling("a1", group() as never, vi.fn());
    vi.mocked(actions.setBillingAction).mockResolvedValueOnce({ ok: false, error: "groups.refused" });
    undoOffered()!();
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(m["groups.refused"]));
  });
});

describe("searchOutcome (review correction 2; fix round 1, I2)", () => {
  it("hits are ready", async () => {
    expect(await searchOutcome(Promise.resolve({ ok: true as const, hits: [{ id: "g1", kind: "household" as const, name: "Garcia" }] })))
      .toEqual({ status: "ready", hits: [{ id: "g1", kind: "household", name: "Garcia" }] });
  });
  it("a search the server reports as failed is the error state, not 'no matches' (I2; mutation: read { ok: false } as no hits -> FAILS)", async () => {
    expect(await searchOutcome(Promise.resolve({ ok: false as const }))).toEqual({ status: "error" });
  });
  it("a search that THROWS is the search's error state, never a crashed card (mutation: let the rejection through -> FAILS)", async () => {
    expect(await searchOutcome(Promise.reject(new Error("db down")))).toEqual({ status: "error" });
  });
});

describe("groupsLoadFrom: the route's body is parsed, not cast", () => {
  const res = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;

  it("a good body is ready with its groups", async () => {
    expect(await groupsLoadFrom(res({ groups: [group()] }))).toEqual({ status: "ready", groups: [group()] });
  });
  it("a non-OK response is the error state, even with a body that would parse", async () => {
    expect(await groupsLoadFrom(res({ groups: [] }, false))).toEqual({ status: "error" });
  });
  it("a body without a list, or a group missing its name or with a third kind, is the error state, never a throw in render (mutation: cast the body -> FAILS)", async () => {
    expect(await groupsLoadFrom(res({}))).toEqual({ status: "error" });
    expect(await groupsLoadFrom(res({ groups: [group({ name: undefined })] }))).toEqual({ status: "error" });
    expect(await groupsLoadFrom(res({ groups: [group({ kind: "facility" })] }))).toEqual({ status: "error" });
    expect(await groupsLoadFrom(res({ groups: [group({ others: null })] }))).toEqual({ status: "error" });
    expect(await groupsLoadFrom(res({ groups: [group({ moreOthers: "3" })] }))).toEqual({ status: "error" });
  });
  it("a body that is not JSON is the error state", async () => {
    const bad = { ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
    expect(await groupsLoadFrom(bad)).toEqual({ status: "error" });
  });
});

describe("the inline saves (rename, role): what InlineField is handed", () => {
  it("a blank group name is refused in the group's own words, never the account rename's 'company' sentence, and nothing is sent (G4; mutation: drop the blank check so the blank reaches the action -> FAILS)", async () => {
    expect(await nameSave("a1", "g1", vi.fn())("")).toEqual({ ok: false, error: m["groups.nameEmpty"] });
    expect(actions.renameGroupAction).not.toHaveBeenCalled();
    expect(m["groups.nameEmpty"]).not.toMatch(/company/i);
  });
  it("a rename hands back the server's previous name as the Undo payload (mutation: no undoPayload -> FAILS)", async () => {
    vi.mocked(actions.renameGroupAction).mockResolvedValue(ok({ previous: "Garcia" }));
    expect(await nameSave("a1", "g1", vi.fn())("García")).toEqual({ ok: true, undoPayload: "Garcia" });
    expect(actions.renameGroupAction).toHaveBeenCalledWith("a1", "g1", "García");
  });
  it("a taken business name is the catalogue's sentence (mutation: return the raw key -> FAILS)", async () => {
    vi.mocked(actions.renameGroupAction).mockResolvedValue({ ok: false, error: "groups.nameTaken" });
    expect(await nameSave("a1", "g1", vi.fn())("Acme")).toEqual({ ok: false, error: m["groups.nameTaken"] });
  });
  it("clearing the role sends null, and a first role's Undo payload is the server's null (mutation: send \"\" -> FAILS)", async () => {
    vi.mocked(actions.setRoleAction).mockResolvedValue(ok({ previous: null }));
    expect(await roleSave("a1", "m1", vi.fn())("")).toEqual({ ok: true, undoPayload: null });
    expect(actions.setRoleAction).toHaveBeenCalledWith("a1", "m1", null);
  });
  it("an Undo write that rejects comes back as a failure InlineField can show, never a throw (mutation: drop the catch -> FAILS)", async () => {
    expect(await inlineUndo(() => Promise.reject(new Error("stale")), vi.fn())).toEqual({ ok: false, error: m["groups.failed"] });
    expect(await inlineUndo(async () => ({ ok: false as const, error: "groups.refused" as const }), vi.fn())).toEqual({ ok: false, error: m["groups.refused"] });
    expect(await inlineUndo(async () => ({ ok: true as const, previous: "x" }), vi.fn())).toEqual({ ok: true });
  });
});

describe("fix round 1, I1: an inline save and its Undo report a change (a rename can change the Business name)", () => {
  it("a rename that saved reports it; one refused does not (mutation: drop onChanged from nameSave -> FAILS)", async () => {
    const onChanged = vi.fn();
    vi.mocked(actions.renameGroupAction).mockResolvedValueOnce(ok({ previous: "Garcia" }));
    await nameSave("a1", "g1", onChanged)("García");
    expect(onChanged).toHaveBeenCalledTimes(1);
    vi.mocked(actions.renameGroupAction).mockResolvedValueOnce({ ok: false, error: "groups.nameTaken" });
    await nameSave("a1", "g1", onChanged)("Acme");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it("a role save that saved reports it", async () => {
    const onChanged = vi.fn();
    vi.mocked(actions.setRoleAction).mockResolvedValue(ok({ previous: null }));
    await roleSave("a1", "m1", onChanged)("Madre");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it("an inline Undo that landed reports it; a refused or rejected one does not (mutation: drop onChanged from inlineUndo -> FAILS)", async () => {
    const onChanged = vi.fn();
    await inlineUndo(async () => ({ ok: true as const, previous: "x" }), onChanged);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await inlineUndo(async () => ({ ok: false as const, error: "groups.refused" as const }), onChanged);
    await inlineUndo(() => Promise.reject(new Error("stale")), onChanged);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
