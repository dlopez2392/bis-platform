import { NextResponse } from "next/server";
import { apiAccountAccessWithRole } from "@/lib/auth";
import { readShellSnapshot } from "@/lib/shell/snapshot";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The shell's badges for one account (unread total, setup meter, presence, business status), fetched by
 * `ShellDataProvider` on every in-account navigation. A plain GET, never a server action: the agency
 * refresh loop after the reason chooser (production, 2026-10-30) was this read as a server action, posted
 * by Next to a stale `/dashboard/enter/<id>` url, whose redirect or cookie-modifying response refreshed the
 * whole app about once a second. A route handler cannot navigate or refresh the page.
 *
 * Refused (signed out, another tenant, client access off, the agency with no live visit) is a bodiless 204:
 * nothing to show, and nothing that says why. A failed visit read throws (fail closed) and is the
 * framework's 500, which the shell swallows like any failed read. Read-only, so a paused account answers.
 * No access-log entry: a list read inside the visit, not a record open (access-log-routes.test.ts).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  const access = await apiAccountAccessWithRole(accountId);
  if (!access) return new NextResponse(null, { status: 204, headers: NO_STORE });
  const snapshot = await readShellSnapshot(accountId, { isAgency: access.isAgency, role: access.role });
  return NextResponse.json(snapshot, { headers: NO_STORE });
}
