import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

// D-087: each half-created company (a Clerk organisation with no account row)
// carries its own "Add as a company" remedy, bound to THAT organisation — not
// a pointer to the Add company dialog, which would make a second one. The
// page is called, not rendered, and its element tree walked.

vi.mock("@/lib/auth", () => ({ requireAgency: async () => ({ userId: "user_agency" }) }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({}),
  listAccounts: async () => [
    { id: "acct_1", name: "Linked Co", clerk_org_id: "org_linked", status: "active", timezone: "America/Chicago", created_at: "2026-10-01T00:00:00Z" },
  ],
  listBlueprints: async () => [],
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganizationList: async () => ({
        data: [
          { id: "org_linked", name: "Linked Co", createdAt: 1 },
          { id: "org_orphan", name: "Orphan Co", createdAt: 2 },
        ],
      }),
    },
  }),
}));
const actions = vi.hoisted(() => ({
  createClientAccount: vi.fn(async () => ({ ok: true })),
  adoptOrphanOrgAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./actions", () => actions);

const { default: AccountsPage } = await import("./page");
const { AdoptOrgDialog } = await import("./adopt-org-dialog");

function everyElement(n: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(n)) { n.forEach((c) => everyElement(c, out)); return out; }
  if (!isValidElement(n)) return out;
  const el = n as ReactElement<Record<string, unknown>>;
  out.push(el);
  for (const v of Object.values(el.props)) everyElement(v, out);
  return out;
}

describe("accounts page — adopting a half-created company (D-087)", () => {
  it("offers each orphan, and only the orphan, an Add as a company dialog bound to ITS organisation (mutation: drop the dialog → FAILS; bind the wrong id → FAILS)", async () => {
    const dialogs = everyElement(await AccountsPage()).filter((e) => e.type === AdoptOrgDialog);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]!.props.orgName).toBe("Orphan Co");
    const f = new FormData();
    await (dialogs[0]!.props.action as (fd: FormData) => Promise<unknown>)(f);
    expect(actions.adoptOrphanOrgAction).toHaveBeenCalledWith("org_orphan", f);
    expect(actions.createClientAccount).not.toHaveBeenCalled();
  });
});
