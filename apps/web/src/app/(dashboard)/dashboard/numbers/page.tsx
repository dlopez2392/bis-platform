// apps/web/src/app/(dashboard)/dashboard/numbers/page.tsx
//
// The agency numbers inventory. Top level, beside Companies, Blueprints and
// the work queue — the second screen in the app whose whole purpose is to
// span every account.
//
// It exists because the only way to move a phone number was the DESTINATION
// account's setup wizard, and only while that account had no number of its
// own. That is the right shape for onboarding and the wrong shape for
// running a carrier account: when a client churns, their number is an asset
// that keeps costing line rental and is still the number their old customers
// dial, and nothing in the app would tell you it was sitting idle.
//
// `requireAgency()` is the literal first line, before any read: every read
// below is cross-tenant through `serviceDb()`, and such a read must never be
// ISSUED on a client's behalf, not merely have its output withheld.
import { PhoneForwarded } from "lucide-react";
import { listAccounts, listAllPhoneNumbers, serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireAgency } from "@/lib/auth";
import { buildNumberInventory, countByStatus, type InventoryNumber } from "@/lib/voice/number-inventory";
import { m } from "@/lib/messages";
import { NumbersTable } from "./numbers-table";
import { StatusCountStrip } from "./status-counts";

export const dynamic = "force-dynamic";

export default async function NumbersPage() {
  await requireAgency();

  const db = serviceDb();
  // Neither read is swallowed. Unlike the setup wizard's cross-account read
  // — cosmetic there, one optional panel on a page with another path to the
  // same outcome — these two ARE the page. A half-rendered inventory would
  // quietly show fewer numbers than exist, or offer a destination that is
  // already taken; the dashboard error boundary is the honest answer.
  const [numbers, accounts] = await Promise.all([
    listAllPhoneNumbers(db),
    listAccounts(db),
  ]);

  const inventory: InventoryNumber[] = numbers.map((n) => ({
    id: n.id,
    e164: n.e164,
    telnyxId: n.telnyx_id ?? null,
    status: n.status,
    accountId: n.account_id,
    // Null when the join came back empty — rendered as "an account we
    // couldn't name", never as "no company", which would read as free stock.
    accountName: n.account?.name ?? null,
  }));

  const rows = buildNumberInventory(
    inventory,
    (accounts ?? []).map((a) => ({ id: a.id, name: a.name, archived: a.status === "archived" })),
  );

  return (
    <>
      <PageHeader title={m["numbers.title"]} subtitle={m["numbers.subtitle"]} />
      <div className="space-y-4 p-6">
        {rows.length === 0 ? (
          <EmptyState
            icon={PhoneForwarded}
            title={m["numbers.empty.title"]}
            body={m["numbers.empty.body"]}
          />
        ) : (
          <>
            {/* DESIGN.md rule 1 — the total never ships alone. The breakdown
                IS its context: four numbers is not the useful fact, how many
                of them are earning their line rental is. */}
            <StatusCountStrip total={rows.length} counts={countByStatus(inventory)} />
            {/* The seam this screen cannot cross, stated before the controls
                that imply otherwise rather than after one has been pressed.
                Not a Notice: nothing is wrong, and a standing warn band on a
                healthy page is noise an operator learns to skim past. This is
                the page telling the truth about its own reach. */}
            <p className="text-xs text-muted-foreground">{m["numbers.carrierSeam"]}</p>
            <NumbersTable rows={rows} />
          </>
        )}
      </div>
    </>
  );
}
