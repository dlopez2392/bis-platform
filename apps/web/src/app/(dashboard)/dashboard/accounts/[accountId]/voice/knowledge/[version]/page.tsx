import Link from "next/link";
import { AlertTriangle, ArrowLeft, FileQuestion } from "lucide-react";
import {
  serviceDb, getKnowledgeSnapshot, getLatestKnowledgeVersion, getVoiceProfile, listPeopleNames,
} from "@bis/db";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { makeTr, type Tr } from "@/lib/record/copy";
import { cn } from "@/lib/utils";
import { parseKnowledgePayload } from "@/lib/voice/knowledge/payload";

export const dynamic = "force-dynamic";

/** A version segment the two RPCs could ever have produced: a positive integer, at most 9 digits
 *  (`voice_knowledge_snapshots_version_check` is `> 0`). Anything else (zero, a leading zero, a
 *  fraction, a word) is this page's OWN not-found state, never a query. */
const VERSION_RE = /^[1-9][0-9]{0,8}$/;

/** The header every state shares: the title (persona-named once it is known; "Sofía" otherwise, the
 *  same literal fallback `calls/[callId]/page.tsx` uses while its own persona read is in flight) and
 *  the one way back, so a reader is never stuck on a not-found or a failed read. */
function KnowledgeShell({
  tr, backHref, persona, children,
}: { tr: Tr; backHref: string; persona: string; children: React.ReactNode }) {
  return (
    <div lang={tr.locale}>
      <PageHeader
        title={tr.text("voice.knowledge.title", { persona })}
        actions={
          <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <ArrowLeft className="size-3.5" aria-hidden />
            {tr.text("voice.knowledge.back")}
          </Link>
        }
      />
      <div className="max-w-2xl space-y-4 p-6">{children}</div>
    </div>
  );
}

/**
 * "What Sofía knew" (spec 5.8): one numbered knowledge snapshot, read-only. A sub-page of the
 * agency-only Voice section (`requireAgencyOnlyAccountAccess`, the same guard `voice/page.tsx` uses),
 * never a top-level surface — reached only from the call page's Knowledge link and from Older/Newer
 * here. Every read is scoped to THIS route's `accountId`, on the service client (as `voice/page.tsx`):
 * this whole page is agency-only, so there is no RLS boundary to additionally buy by splitting the
 * read onto a request client.
 *
 * States (rule 5): a version segment the RPCs could never have produced, or one this account has no
 * row for, is the NOT-FOUND state — in-page, never `notFound()`, because the two neighbours Older/Newer
 * link to are themselves data, not a route this server can vouch for existing ahead of a read. A
 * throwing read, or a stored payload `parseKnowledgePayload` cannot make sense of, is the ERROR state.
 * Every read failure (the persona, the person lookup) folds into the same error state: this screen has
 * one job, showing this snapshot, so one boundary around the whole read phase is the screen's boundary
 * (rule 5), not a card's.
 */
export default async function VoiceKnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string; version: string }>;
  searchParams?: Promise<{ locale?: string }>;
}) {
  const { accountId, version: versionParam } = await params;
  const { locale: localeParam } = (await searchParams) ?? {};
  await requireAgencyOnlyAccountAccess(accountId);

  const prefs = await getPersonPrefs();
  // Agency-only, like voice/page.tsx: no account language to default from (decision 2's precedent).
  const locale = requestLocale({ account: null, isOperator: true, userLanguage: prefs.language }, { locale: localeParam });
  const pseudo = requestPseudoMode({ locale: localeParam });
  const tr = makeTr(locale, pseudo);
  const backHref = `/dashboard/accounts/${accountId}/voice`;

  if (!VERSION_RE.test(versionParam)) {
    return (
      <KnowledgeShell tr={tr} backHref={backHref} persona="Sofía">
        <EmptyState icon={FileQuestion} title={tr.text("voice.knowledge.notFound", { version: versionParam })} lang={locale} />
      </KnowledgeShell>
    );
  }
  const version = Number(versionParam);
  const db = serviceDb();

  let persona = "Sofía";
  let state: { kind: "not-found" } | { kind: "error" } | {
    kind: "loaded";
    version: number; latest: number; savedLine: string;
    facts: string; servicesText: string; hoursLines: string[] | null;
    services: { position: number; name_en: string; sentence_en: string; sentence_es: string }[];
  };
  try {
    const [snapshot, latest, profile] = await Promise.all([
      getKnowledgeSnapshot(db, accountId, version),
      getLatestKnowledgeVersion(db, accountId),
      getVoiceProfile(db, accountId),
    ]);
    persona = profile?.persona_name?.trim() || "Sofía";
    if (!snapshot) {
      state = { kind: "not-found" };
    } else {
      const payload = parseKnowledgePayload(snapshot.payload);
      if (!payload) {
        state = { kind: "error" };
      } else {
        let personName: string | null = null;
        if (snapshot.created_by !== "system") {
          const names = await listPeopleNames(db, [snapshot.created_by]);
          personName = names[snapshot.created_by] ?? tr.text("assign.someone");
        }
        const date = new Intl.DateTimeFormat(locale, {
          dateStyle: "medium", timeStyle: "short", timeZone: payload.timezone,
        }).format(new Date(snapshot.created_at));
        const savedLine = personName
          ? tr.text("voice.knowledge.savedBy", { version: snapshot.version, date, person: personName })
          : tr.text("voice.knowledge.recordedAutomatically", { version: snapshot.version, date });
        state = {
          kind: "loaded",
          version: snapshot.version,
          latest,
          savedLine,
          facts: payload.facts,
          servicesText: payload.services_text,
          hoursLines: payload.hours_lines,
          services: payload.services.map((s) => ({
            position: s.position, name_en: s.name_en, sentence_en: s.sentence_en, sentence_es: s.sentence_es,
          })),
        };
      }
    }
  } catch (e) {
    console.error(`voice knowledge ${accountId}#${versionParam}: read failed: ${loggableError(e)}`);
    state = { kind: "error" };
  }

  if (state.kind === "not-found") {
    return (
      <KnowledgeShell tr={tr} backHref={backHref} persona={persona}>
        <EmptyState icon={FileQuestion} title={tr.text("voice.knowledge.notFound", { version: versionParam })} lang={locale} />
      </KnowledgeShell>
    );
  }
  if (state.kind === "error") {
    return (
      <KnowledgeShell tr={tr} backHref={backHref} persona={persona}>
        <EmptyState icon={AlertTriangle} title={tr.text("voice.knowledge.loadFailed")} lang={locale} />
      </KnowledgeShell>
    );
  }

  return (
    <KnowledgeShell tr={tr} backHref={backHref} persona={persona}>
      <Card lang={locale}>
        <CardHeader>
          <CardTitle>{tr.text("voice.knowledge.title", { persona })}</CardTitle>
          <CardDescription>{state.savedLine}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-1">
            <h3 className="text-sm font-medium text-card-foreground">{tr.text("voice.knowledge.facts")}</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {state.facts.trim() ? state.facts : tr.text("voice.knowledge.nothing")}
            </p>
          </section>

          <section className="space-y-1">
            <h3 className="text-sm font-medium text-card-foreground">{tr.text("voice.knowledge.servicesText")}</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {state.servicesText.trim() ? state.servicesText : tr.text("voice.knowledge.nothing")}
            </p>
          </section>

          <section className="space-y-1">
            <h3 className="text-sm font-medium text-card-foreground">{tr.text("voice.knowledge.hours")}</h3>
            {state.hoursLines ? (
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {state.hoursLines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{tr.text("voice.knowledge.noHours")}</p>
            )}
          </section>

          <section className="space-y-1">
            <h3 className="text-sm font-medium text-card-foreground">{tr.text("voice.knowledge.prices")}</h3>
            {state.services.length > 0 ? (
              <ul className="space-y-3">
                {state.services.map((s) => (
                  <li key={s.position} className="space-y-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <p className="text-sm font-medium text-card-foreground">{s.name_en}</p>
                    <dl className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
                      <dt className="whitespace-nowrap">{tr.text("voice.knowledge.inEnglish")}</dt>
                      <dd>{s.sentence_en}</dd>
                    </dl>
                    <dl className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
                      <dt className="whitespace-nowrap">{tr.text("voice.knowledge.inSpanish")}</dt>
                      <dd>{s.sentence_es}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{tr.text("voice.knowledge.noPrices")}</p>
            )}
          </section>
        </CardContent>
      </Card>

      {/* Older (N-1, absent at 1) / Newer (N+1, absent at the latest) — ghost links. Versions are
          contiguous per account (both RPCs append latest + 1 under the account lock), so N-1 and N+1
          need no existence check of their own. */}
      {state.version > 1 || state.version < state.latest ? (
        <div className="flex items-center justify-between gap-3">
          {state.version > 1 ? (
            <Link
              href={`/dashboard/accounts/${accountId}/voice/knowledge/${state.version - 1}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              {tr.text("voice.knowledge.older")}
            </Link>
          ) : <span />}
          {state.version < state.latest ? (
            <Link
              href={`/dashboard/accounts/${accountId}/voice/knowledge/${state.version + 1}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              {tr.text("voice.knowledge.newer")}
            </Link>
          ) : <span />}
        </div>
      ) : null}
    </KnowledgeShell>
  );
}
