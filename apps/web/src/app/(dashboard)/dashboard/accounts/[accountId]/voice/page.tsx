import { serviceDb, getVoiceProfile, type PhoneNumberRow } from "@bis/db";
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
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  await requireAgencyOnlyAccountAccess(accountId);

  const db = serviceDb();
  const [profile, { data: numbersData, error: numbersError }] = await Promise.all([
    getVoiceProfile(db, accountId),
    db.from("phone_numbers")
      .select("id, account_id, e164, telnyx_id, status")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true }),
  ]);
  if (numbersError) throw new Error(`voice: phone number lookup failed: ${numbersError.message}`);
  const numbers = (numbersData ?? []) as PhoneNumberRow[];

  const boundSaveProfile = saveVoiceProfileAction.bind(null, accountId);
  const boundAssignNumber = assignNumberAction.bind(null, accountId);
  const boundSetStatus = setNumberStatusAction.bind(null, accountId);

  return (
    <>
      <PageHeader title={m["voice.title"]} />
      <div className="max-w-2xl space-y-6 p-6">
        <VoiceSettings
          profile={profile}
          numbers={numbers}
          saveProfileAction={boundSaveProfile}
          assignNumberAction={boundAssignNumber}
          setStatusAction={boundSetStatus}
        />
      </div>
    </>
  );
}
