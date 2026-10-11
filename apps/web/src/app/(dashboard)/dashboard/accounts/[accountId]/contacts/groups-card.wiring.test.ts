import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

/**
 * Task 6 fix round 1, I1: what the Groups card tells the page when it changes
 * something. A group write can change contacts.company_name (0069's trigger),
 * so the card refreshes the server-rendered page (the drawer's row, the
 * contact page's Business name) and tells its parent, as well as re-reading
 * its own list.
 *
 * No DOM renderer in apps/web: the components are CALLED with React's hooks
 * captured (the drawer wiring test's idiom), and the callbacks they hand down
 * are invoked directly.
 */
const states: { initial: unknown; set: ReturnType<typeof vi.fn> }[] = [];
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => {},
    useId: () => "id",
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      states.push({ initial, set });
      return [initial, set];
    },
  };
});
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {} }) }));
vi.mock("./groups-actions", () => ({
  searchGroupsAction: vi.fn(), createGroupAction: vi.fn(), addToGroupAction: vi.fn(), setRoleAction: vi.fn(),
  setBillingAction: vi.fn(), makePrimaryAction: vi.fn(), removeMembershipAction: vi.fn(), restoreMembershipAction: vi.fn(),
  renameGroupAction: vi.fn(), setBillingAddressAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const { GroupsCard, GroupsCardView } = await import("./groups-card");
const { InlineField } = await import("@/components/inline-field");
const actions = await import("./groups-actions");

function* walk(node: unknown): Generator<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  yield el;
  yield* walk(el.props.children);
}

const GROUP = {
  memberId: "m1", groupId: "g1", kind: "business" as const, name: "Acme", billingAddress: null, role: null,
  isPrimary: true, isBilling: false, others: [], moreOthers: 0,
};

beforeEach(() => { states.length = 0; vi.clearAllMocks(); });

describe("GroupsCard: a change refreshes the page and tells the parent (fix round 1, I1)", () => {
  const card = (onChanged?: () => void) =>
    GroupsCard({ accountId: "a1", contactId: "c1", canManageGroups: true, onChanged }) as ReactElement<{ onChanged: () => void; onRetry: () => void }>;

  it("re-reads its own list, refreshes the server-rendered page and calls the parent's onChanged (mutation: drop router.refresh, or the passthrough -> FAILS)", () => {
    const parent = vi.fn();
    const el = card(parent);
    const nonce = states.find((s) => s.initial === 0)!;
    el.props.onChanged();
    expect(nonce.set).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it("with no parent (the contact page) it still refreshes the page", () => {
    card().props.onChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("Retry is not a change: it re-reads the card only", () => {
    const parent = vi.fn();
    card(parent).props.onRetry();
    expect(refresh).not.toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
  });
});

describe("GroupRow hands its inline fields saves and Undos that report a change (fix round 1, I1)", () => {
  /** The row's InlineField elements, by label, from the view's own tree. */
  function fields(onChanged: () => void) {
    const view = GroupsCardView({
      accountId: "a1", contactId: "c1", canManageGroups: true, load: { status: "ready", groups: [GROUP] },
      onRetry: () => {}, onChanged,
    });
    const row = [...walk(view)].find((e) => typeof e.type === "function" && e.type.name === "GroupRow")!;
    const tree = (row.type as (p: unknown) => unknown)(row.props);
    return new Map([...walk(tree)].filter((e) => e.type === InlineField).map((e) => [e.props.label as string, e.props]));
  }
  type FieldProps = { save: (v: string) => Promise<unknown>; undoWith: (p: unknown) => Promise<unknown> };

  it("the name field's save and its Undo each report the change (mutation: hand InlineField a save without onChanged -> FAILS)", async () => {
    const onChanged = vi.fn();
    const name = fields(onChanged).get("Group name") as unknown as FieldProps;
    vi.mocked(actions.renameGroupAction).mockResolvedValue({ ok: true, previous: "Acme" });
    await name.save("Acme Roofing");
    expect(onChanged).toHaveBeenCalledTimes(1);
    await name.undoWith("Acme");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("the role and billing address fields report theirs too", async () => {
    const onChanged = vi.fn();
    const f = fields(onChanged);
    vi.mocked(actions.setRoleAction).mockResolvedValue({ ok: true, previous: null });
    vi.mocked(actions.setBillingAddressAction).mockResolvedValue({ ok: true, previous: null });
    await (f.get("Role") as unknown as FieldProps).save("Dueño");
    await (f.get("Billing address") as unknown as FieldProps).save("1 Main St");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});
