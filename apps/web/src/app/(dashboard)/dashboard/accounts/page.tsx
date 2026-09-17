import Link from "next/link";
import { clerkClient } from "@clerk/nextjs/server";
import { Building2, Unlink } from "lucide-react";
import { serviceDb, listAccounts, listBlueprints } from "@bis/db";
import { createClientAccount } from "./actions";
import { CreateAccountDialog } from "./create-account-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { requireAgency } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { ACCOUNT_STATUS_LABEL } from "@/lib/labels";
import { orphanedOrgs, type ClerkOrgSummary } from "@/lib/accounts/orphans";

/**
 * Clerk organizations, or `null` when Clerk cannot be reached.
 *
 * `null` rather than `[]` on failure, deliberately: an empty list would render
 * as "nothing is broken", which is the one thing a health check must never say
 * when it has not actually checked.
 *
 * 100 is Clerk's per-page maximum and far beyond any plausible client count
 * here; if that ever stops being true this under-reports rather than lies, and
 * the count on screen makes that visible.
 */
async function fetchClerkOrgs(): Promise<ClerkOrgSummary[] | null> {
  try {
    const clerk = await clerkClient();
    const { data } = await clerk.organizations.getOrganizationList({ limit: 100 });
    return data.map((o) => ({ id: o.id, name: o.name, createdAt: o.createdAt }));
  } catch (e) {
    // Never fatal: this page is where the agency starts every session, and a
    // Clerk outage must not take it down to report a Clerk outage.
    console.error("accounts: could not list Clerk organizations:", String(e));
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  // Agency-only: every client company's name, status, and creation date. The
  // parent layout admits clients into the /dashboard tree, so this leaf must
  // guard itself rather than rely solely on that shared choke point.
  await requireAgency();
  const [accounts, blueprints, clerkOrgs] = await Promise.all([
    listAccounts(serviceDb()),
    listBlueprints(serviceDb()),
    fetchClerkOrgs(),
  ]);
  // A company exists in two places. When only the Clerk half was made — from
  // the Clerk dashboard rather than through Add company — invitations send and
  // sign-in fails, and the client finds out before the agency does.
  const orphans = clerkOrgs === null ? [] : orphanedOrgs(clerkOrgs, accounts);
  return (
    <>
      <PageHeader
        title={m["accounts.title"]}
        count={`${accounts.length}`}
        actions={<CreateAccountDialog action={createClientAccount} blueprints={blueprints} />}
      />
      <div className="p-6">
        {clerkOrgs === null && (
          <p className="mb-4 text-sm text-muted-foreground">
            {m["accounts.orphan.unavailable"]}
          </p>
        )}
        {orphans.length > 0 && (
          <section className="mb-6 rounded-xl border border-[var(--warn)] bg-card px-4 py-3.5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--warn-bg)] text-[var(--warn)]">
                <Unlink className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                {/* DESIGN.md rule 3: never colour alone — the icon and border
                    are reinforcement, the heading is what says it. */}
                <p className="text-[13.5px] font-semibold text-card-foreground">
                  {m["accounts.orphan.title"]}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{m["accounts.orphan.body"]}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {orphans.map((o) => (
                    <li key={o.id} data-orphan-org={o.id}>
                      <Badge variant="chip" className="gap-1.5 py-1 pr-2.5 pl-2">
                        <span className="size-[7px] rounded-full bg-[var(--warn)]" aria-hidden />
                        {o.name}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
        {accounts.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={m["accounts.empty.title"]}
            body={m["accounts.empty.body"]}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/dashboard/accounts/${a.id}/contacts`}
                  data-testid={`account-${a.id}`}
                  // The agency's home screen was a grid of flat rectangles —
                  // the one screen every session starts on.
                  className="block rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3 transition-colors hover:border-[var(--accent)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-9 items-center justify-center rounded-[8px] bg-[var(--accent-dim)] text-[var(--accent)]">
                      <Building2 className="size-4" aria-hidden />
                    </span>
                    {/* DESIGN.md rule 3: status is dot + word, never the word
                        in a differently-coloured box. */}
                    <Badge variant="chip" className="gap-1.5 py-1 pr-2.5 pl-2">
                      <span
                        className={cn(
                          "size-[7px] rounded-full",
                          a.status === "active" ? "bg-[var(--good)]" : "bg-muted-foreground/60",
                        )}
                        aria-hidden
                      />
                      {ACCOUNT_STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </div>
                  <p className="mt-4 truncate text-[13.5px] font-semibold text-card-foreground">{a.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{a.timezone}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {m["accounts.created"].replace("{date}", formatDate(a.created_at))}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
