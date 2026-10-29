import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { TeamSkeleton } from "@/components/team/team-card";
import { TeamSection } from "@/components/team/team-section";
import { BisAccessFrame } from "@/components/access-log/bis-access-frame";
import { BisAccessSection } from "@/components/access-log/bis-access-section";
import { BisAccessSkeleton } from "@/components/access-log/bis-access-skeleton";
import { requireAccountOwner } from "@/lib/auth";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * The Team page (staff and roles, spec §8): the client Owner's own place to
 * run their team, reached from the sidebar's pinned footer and the ⌘K
 * palette (Task 8). It becomes the client's Ajustes page when F-096's part
 * lands. The agency reaches it too, from the palette, and sees the same card
 * it has under Settings' Client access switch, gated the same way: with
 * client access off, the access-off note instead of an Invite (TeamSection).
 *
 * requireAccountOwner is the FIRST call: it admits the agency and a client
 * Owner and sends a Staff to their dashboard (never a 403). Every Team action
 * repeats the same guard; hiding the footer link is convenience. The same
 * guard is what gates BIS access below: Staff and a Technician never even
 * reach this page, and the agency only reaches it on a live visit
 * (`requireAgencyVisit`, inside `requireAccountAccess`).
 *
 * The page reads nothing itself: TeamSection reads the account once (its
 * organisation, access and language) and streams in its own boundary,
 * because it waits on Clerk. The header paints without it.
 *
 * F-118 part 1 (plan Task 10; spec 6.1): below TeamSection, the "BIS access"
 * section — every visit BIS has made to this account, its reason and what it
 * opened — lives in its OWN frame (`BisAccessFrame`) and its OWN Suspense,
 * reading its OWN data (`BisAccessSection`). A failed log read never costs
 * the Team card above it (rule 5 extended to the card). `accessBefore` is
 * this section's OWN cursor, named apart from any other card's `?before=`.
 */
export default async function TeamPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams?: Promise<{ accessBefore?: string }>;
}) {
  const { accountId } = await params;
  const { isAgency } = await requireAccountOwner(accountId);
  const { accessBefore } = (await searchParams) ?? {};
  return (
    <>
      <PageHeader title={m["team.title"]} subtitle={m["team.page.subtitle"]} />
      <div className="p-6">
        <Suspense fallback={<TeamSkeleton />}>
          <TeamSection accountId={accountId} viewer={isAgency ? "agency" : "owner"} />
        </Suspense>
        <BisAccessFrame>
          <Suspense fallback={<BisAccessSkeleton />}>
            <BisAccessSection accountId={accountId} isAgency={isAgency} before={accessBefore} />
          </Suspense>
        </BisAccessFrame>
      </div>
    </>
  );
}
