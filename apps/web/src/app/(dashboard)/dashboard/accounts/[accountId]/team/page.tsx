import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { TeamSkeleton } from "@/components/team/team-card";
import { TeamSection } from "@/components/team/team-section";
import { requireAccountOwner } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * The Team page (staff and roles, spec §8): the client Owner's own place to
 * run their team, reached from the sidebar's pinned footer and the ⌘K
 * palette (Task 8). It becomes the client's Ajustes page when F-096's part
 * lands. The agency reaches it too, from the palette, and sees the same card
 * it has under Settings' Client access switch.
 *
 * requireAccountOwner is the FIRST call: it admits the agency and a client
 * Owner and sends a Staff to their dashboard (never a 403). Every Team action
 * repeats the same guard; hiding the footer link is convenience.
 *
 * The card streams in its own boundary because it waits on Clerk
 * (invitations and the cap); the header paints without it.
 */
export default async function TeamPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { isAgency } = await requireAccountOwner(accountId);
  const db = await dbForRequest();
  const { data, error } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`team page: account read failed: ${error.message}`);
  const clerkOrgId = (data as { clerk_org_id: string | null } | null)?.clerk_org_id ?? null;

  return (
    <>
      <PageHeader title={m["team.title"]} subtitle={m["team.page.subtitle"]} />
      <div className="p-6">
        <Suspense fallback={<TeamSkeleton />}>
          <TeamSection accountId={accountId} clerkOrgId={clerkOrgId} viewer={isAgency ? "agency" : "owner"} />
        </Suspense>
      </div>
    </>
  );
}
