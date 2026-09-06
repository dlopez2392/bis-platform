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
  const [profile, { data: numbersData, error: numbersError }, accountName] =
    await Promise.all([
      getVoiceProfile(db, accountId),
      db.from("phone_numbers")
        .select("id, account_id, e164, telnyx_id, status")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true }),
      // Just the name — the text-back default (defaultTextbackBody) names the
      // company so a text from an unknown number doesn't read as spam, the
      // same field the call flow itself uses ("Thanks for calling
      // ${accountRow.name}", api/voice/incoming/route.ts). Cosmetic only —
      // this value renders placeholder text, nothing is written from it — so
      // a failed read degrades to a fallback (setup/page.tsx:64-69's
      // precedent) instead of throwing and 500ing the whole settings page.
      // The fallback (and an empty/blank stored name) is a name-shaped noun,
      // not "", so defaultTextbackBody's sentence still reads as a sentence
      // ("Hi, this is our team.") instead of "Hi, this is . Sorry we missed
      // you...".
      (async () => {
        try {
          const { data, error } = await db.from("accounts").select("name").eq("id", accountId).maybeSingle();
          if (error) throw new Error(error.message);
          const name = (data as { name: string } | null)?.name?.trim();
          return name || "our team";
        } catch (e) {
          console.error(`voice: account name lookup failed for account ${accountId}: ${String(e)}`);
          return "our team";
        }
      })(),
    ]);
  if (numbersError) throw new Error(`voice: phone number lookup failed: ${numbersError.message}`);
  const numbers = (numbersData ?? []) as PhoneNumberRow[];

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
