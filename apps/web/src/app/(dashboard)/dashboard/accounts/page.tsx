import Link from "next/link";
import { Building2 } from "lucide-react";
import { serviceDb, listAccounts, listBlueprints } from "@bis/db";
import { createClientAccount } from "./actions";
import { CreateAccountDialog } from "./create-account-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { m } from "@/lib/messages";
import { ACCOUNT_STATUS_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
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
                  className="block rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Building2 className="size-4" aria-hidden />
                    </span>
                    <Badge variant={a.status === "active" ? "secondary" : "outline"}>
                      {ACCOUNT_STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </div>
                  <p className="mt-4 truncate font-medium text-card-foreground">{a.name}</p>
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
