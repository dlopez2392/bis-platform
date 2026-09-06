import { serviceDb, getVoiceProfile, type PhoneNumberRow } from "@bis/db";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";
import { VoiceSettings } from "./voice-settings";
import { saveVoiceProfileAction, assignNumberAction, setNumberStatusAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The agency's manual path onto a client's voice receptionist — the surface
 * that lets the FIRST client go live before the setup wizard exists to
 * automate this. Agency-only throughout: `requireAgencyOnlyAccountAccess`
 * gates the page the same way it gates Settings and the activation
 * checklist, and every write in ./actions.ts re-checks it independently
 * rather than trusting the nav item being hidden from clients.
 *
 * Both reads below go through serviceDb(), matching the writes: 0019/0020
 * grant `authenticated` SELECT on these tables, so `dbForRequest()` would
 * actually work for the read half — but splitting the read onto RLS and the
 * write onto serviceDb() buys nothing here (this whole page is agency-only,
 * unlike calendar's shared-audience split) and adds a second db client for
 * no reason. One client, one guard.
 */
export default async function VoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { accountId } = await params;
  // Set by the setup wizard's links, and by nothing else — the breadcrumb
  // below appears only for someone who arrived mid-flow.
  const { from } = await searchParams;
  await requireAgencyOnlyAccountAccess(accountId);

  const db = serviceDb();
  const [profile, { data: numbersData, error: numbersError }, { data: accountData, error: accountError }] =
    await Promise.all([
      getVoiceProfile(db, accountId),
      db.from("phone_numbers")
        .select("id, account_id, e164, telnyx_id, status")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true }),
      // Just the name — the text-back default (defaultTextbackBody) names the
      // company so a text from an unknown number doesn't read as spam, the
      // same field the call flow itself uses ("Thanks for calling
      // ${accountRow.name}", api/voice/incoming/route.ts).
      db.from("accounts").select("name").eq("id", accountId).maybeSingle(),
    ]);
  if (numbersError) throw new Error(`voice: phone number lookup failed: ${numbersError.message}`);
  if (accountError) throw new Error(`voice: account lookup failed: ${accountError.message}`);
  const numbers = (numbersData ?? []) as PhoneNumberRow[];
  const accountName = (accountData as { name: string } | null)?.name ?? "";

  const boundSaveProfile = saveVoiceProfileAction.bind(null, accountId);
  const boundAssignNumber = assignNumberAction.bind(null, accountId);
  const boundSetStatus = setNumberStatusAction.bind(null, accountId);

  return (
    <>
      {from === "setup" ? <BackToSetup accountId={accountId} /> : null}
      <PageHeader title={m["voice.title"]} />
      <div className="max-w-2xl space-y-6 p-6">
        <VoiceSettings
          profile={profile}
          accountName={accountName}
          numbers={numbers}
          saveProfileAction={boundSaveProfile}
          assignNumberAction={boundAssignNumber}
          setStatusAction={boundSetStatus}
        />
      </div>
    </>
  );
}
