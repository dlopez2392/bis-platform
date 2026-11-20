import { serviceDb, readAiAppsSwitch, readAccountTimezone, readAiAppLog, type AiAppLogRow, type AiAppsSwitchState } from "@bis/db";
import { dbForRequest } from "@/lib/db";
import { loggableError } from "@/lib/loggable-error";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/lib/i18n/locale";
import { AiAppsCard, AiAppsCardError } from "./ai-apps-card";

type Result = { ok: true; value: AiAppsSwitchState } | { ok: false; error: string };

/**
 * The AI apps card in its OWN boundary on the Team page (rule 5 extended to the card; the page wraps it in Suspense).
 * A failed read of the switch costs this card's place only (its error state, logged by account). The list of reads is
 * read on the REQUEST's client, because the access log's RLS is what decides who sees it (the account's Owner and the
 * agency; readAiAppLog's own comment), and a failure there costs the list only. Who changed the switch is a nicety:
 * one users read on serviceDb, and a failure leaves "the Owner" in its place.
 */
async function ownerName(db: ReturnType<typeof serviceDb>, userId: string | null, accountId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data, error } = await db.from("users").select("name, email").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { name: string | null; email: string | null } | null;
    return row?.name?.trim() || row?.email?.trim() || null;
  } catch (e) {
    console.error(`team page: account ${accountId} AI apps switch name read failed: ${loggableError(e)}`);
    return null;
  }
}

async function readLog(accountId: string): Promise<AiAppLogRow[] | null> {
  try {
    return await readAiAppLog(await dbForRequest(), accountId, 20);
  } catch (e) {
    console.error(`team page: account ${accountId} AI apps log read failed: ${loggableError(e)}`);
    return null;
  }
}

export async function AiAppsSection(props: {
  accountId: string; viewer: "owner" | "agency"; locale: Locale; pseudo: boolean; setSwitch: (on: boolean) => Promise<Result>;
}) {
  const db = serviceDb();
  let loaded: { state: AiAppsSwitchState; zone: string };
  try {
    const [state, zoneRead] = await Promise.all([readAiAppsSwitch(db, props.accountId), readAccountTimezone(db, props.accountId)]);
    loaded = { state, zone: zoneRead ?? "America/Chicago" };
  } catch (e) {
    console.error(`team page: account ${props.accountId} AI apps switch read failed: ${loggableError(e)}`);
    return <AiAppsCardError locale={props.locale} pseudo={props.pseudo} />;
  }
  const [changedByName, log] = await Promise.all([
    loaded.state.enabledAt !== null ? ownerName(db, loaded.state.changedBy, props.accountId) : Promise.resolve(null),
    readLog(props.accountId),
  ]);
  return (
    <AiAppsCard state={loaded.state} changedByName={changedByName} log={log} viewer={props.viewer}
      locale={props.locale} zone={loaded.zone} pseudo={props.pseudo} setSwitch={props.setSwitch} />
  );
}

/** The loading state (rule 7): shaped like the card, never a spinner. */
export function AiAppsSkeleton() {
  return (
    <Card data-ai-apps-skeleton className="mt-6">
      <CardHeader>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-11 rounded-full" />
        <Skeleton className="h-4 w-48" />
      </CardContent>
    </Card>
  );
}
