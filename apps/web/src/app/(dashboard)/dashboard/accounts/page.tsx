import Link from "next/link";
import { Building2 } from "lucide-react";
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

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  // Agency-only: every client company's name, status, and creation date. The
  // parent layout admits clients into the /dashboard tree, so this leaf must
  // guard itself rather than rely solely on that shared choke point.
  await requireAgency();
  const [accounts, blueprints] = await Promise.all([
    listAccounts(serviceDb()),
    listBlueprints(serviceDb()),
  ]);
  return (
    <>
      <PageHeader
        title={m["accounts.title"]}
        count={`${accounts.length}`}
        actions={<CreateAccountDialog action={createClientAccount} blueprints={blueprints} />}
      />
      <div className="p-6">
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
