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
import { dbForRequest } from "@/lib/db";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { makeTr, type Tr } from "@/lib/record/copy";
import { cn } from "@/lib/utils";
import { parseKnowledgePayload, type KnowledgeService } from "@/lib/voice/knowledge/payload";

export const dynamic = "force-dynamic";

/** A version segment the two RPCs could ever have produced: a positive integer, at most 9 digits
 *  (`voice_knowledge_snapshots_version_check` is `> 0`). Anything else (zero, a leading zero, a
 *  fraction, a word) is this page's OWN not-found state, never a query, and its sentence never echoes
 *  what was typed (design review: a long or odd segment does not belong in the page's own words). */
const VERSION_RE = /^[1-9][0-9]{0,8}$/;

type ShownService = Pick<KnowledgeService,
  "position" | "name_en" | "name_es" | "description_en" | "description_es" | "sentence_en" | "sentence_es">;

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

/** One labelled line of a service: what she was told, marked with the language it is in, so a screen
 *  reader reads the Spanish lines in Spanish. */
function ServiceLine({ label, value, lang }: { label: string; value: string; lang: "en" | "es" }) {
  return (
    <dl className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
      <dt className="whitespace-nowrap">{label}</dt>
      <dd lang={lang}>{value}</dd>
    </dl>
  );
}

/**
 * "What Sofía knew" (spec 5.8): one numbered knowledge snapshot, read-only. A sub-page of the
 * agency-only Voice section (`requireAgencyOnlyAccountAccess`, the same guard `voice/page.tsx` uses),
 * never a top-level surface — reached only from the call page's Knowledge link and from Older/Newer
 * here. Every snapshot read is scoped to THIS route's `accountId`, on the service client (as
 * `voice/page.tsx`): this whole page is agency-only. The one exception is naming the person who saved:
 * `listPeopleNames` runs on the REQUEST client, so RLS decides who may be named (its own contract,
 * packages/db/src/record.ts: no service-role read names anyone), the way the call page names people.
 *
 * States (rule 5): a version segment the RPCs could never have produced, or one this account has no
 * row for, is the NOT-FOUND state — in-page, never `notFound()`, because the two neighbours Older/Newer
 * link to are themselves data, not a route this server can vouch for existing ahead of a read. A
 * throwing read, or a stored payload `parseKnowledgePayload` cannot make sense of, is the ERROR state.
 * Every read failure (the persona, the person lookup) folds into the same error state: this screen has
 * one job, showing this snapshot, so one boundary around the whole read phase is the screen's boundary
 * (rule 5), not a card's. Loading is `./loading.tsx` (rule 7).
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
  // Every link off this page keeps the reader's ?locale= (design review), as voice/page.tsx's Retry does.
  const query = localeParam ? `?${new URLSearchParams({ locale: localeParam })}` : "";
  const base = `/dashboard/accounts/${accountId}/voice`;
  const backHref = `${base}${query}`;

  if (!VERSION_RE.test(versionParam)) {
    return (
      <KnowledgeShell tr={tr} backHref={backHref} persona="Sofía">
        <EmptyState icon={FileQuestion} title={tr.text("voice.knowledge.notFoundGeneric")} lang={locale} />
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
    services: ShownService[];
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
          const names = await listPeopleNames(await dbForRequest(), [snapshot.created_by]);
          personName = names[snapshot.created_by] ?? tr.text("assign.someone");
        }
        const date = new Intl.DateTimeFormat(locale, {
          dateStyle: "medium", timeStyle: "short", timeZone: payload.timezone,
        }).format(new Date(snapshot.created_at));
        const savedLine = personName
          ? tr.text("voice.knowledge.savedBy", { date, person: personName })
          : tr.text("voice.knowledge.recordedAutomatically", { date });
        state = {
          kind: "loaded",
          version: snapshot.version,
          latest,
          savedLine,
          facts: payload.facts,
          servicesText: payload.services_text,
          hoursLines: payload.hours_lines,
          services: payload.services.map((s) => ({
            position: s.position, name_en: s.name_en, name_es: s.name_es,
            description_en: s.description_en, description_es: s.description_es,
            sentence_en: s.sentence_en, sentence_es: s.sentence_es,
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

  const headingClass = "text-sm font-medium text-card-foreground";
  return (
    <KnowledgeShell tr={tr} backHref={backHref} persona={persona}>
      <Card lang={locale}>
        <CardHeader>
          {/* The page header already says "What {persona} knew"; the card names the version (design review). */}
          <CardTitle>{tr.text("voice.knowledge.version", { version: state.version })}</CardTitle>
          <CardDescription>{state.savedLine}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-1">
            <h4 className={headingClass}>{tr.text("voice.knowledge.facts")}</h4>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {state.facts.trim() ? state.facts : tr.text("voice.knowledge.nothing")}
            </p>
          </section>

          <section className="space-y-1">
            <h4 className={headingClass}>{tr.text("voice.knowledge.servicesText")}</h4>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {state.servicesText.trim() ? state.servicesText : tr.text("voice.knowledge.nothing")}
            </p>
          </section>

          <section className="space-y-1">
            <h4 className={headingClass}>{tr.text("voice.knowledge.hours")}</h4>
            {state.hoursLines ? (
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {state.hoursLines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{tr.text("voice.knowledge.noHours")}</p>
            )}
          </section>

          <section className="space-y-1">
            <h4 className={headingClass}>{tr.text("voice.knowledge.prices")}</h4>
            {state.services.length > 0 ? (
              <ul className="space-y-3">
                {state.services.map((s) => (
                  // Everything the prompt carried for the service (spec SD7's "About it" lines included),
                  // each line marked with its language.
                  <li key={s.position} className="space-y-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <p className="text-sm font-medium text-card-foreground" lang="en">{s.name_en}</p>
                    {s.name_es ? <ServiceLine label={tr.text("voice.knowledge.nameEs")} value={s.name_es} lang="es" /> : null}
                    {s.description_en ? <ServiceLine label={tr.text("voice.knowledge.aboutEn")} value={s.description_en} lang="en" /> : null}
                    {s.description_es ? <ServiceLine label={tr.text("voice.knowledge.aboutEs")} value={s.description_es} lang="es" /> : null}
                    <ServiceLine label={tr.text("voice.knowledge.inEnglish")} value={s.sentence_en} lang="en" />
                    <ServiceLine label={tr.text("voice.knowledge.inSpanish")} value={s.sentence_es} lang="es" />
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
              href={`${base}/knowledge/${state.version - 1}${query}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              {tr.text("voice.knowledge.older")}
            </Link>
          ) : <span />}
          {state.version < state.latest ? (
            <Link
              href={`${base}/knowledge/${state.version + 1}${query}`}
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
