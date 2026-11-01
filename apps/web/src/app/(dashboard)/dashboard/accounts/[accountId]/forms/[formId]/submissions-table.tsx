import Link from "next/link";
import { Check, X } from "lucide-react";
import type { SubmissionRow } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTimeInZone } from "@/lib/format";
import { normalizeConsent } from "@/lib/forms/consent";
import type { MessageKey } from "@/lib/messages";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

export function SubmissionsTable({
  accountId, submissions, timezone, readerLocale = "en", pseudo = false,
}: {
  accountId: string;
  submissions: SubmissionRow[];
  /** The account's RESOLVED zone (`renderZone`, computed once by the form
   *  editor's own `page.tsx`) — a submission's own `created_at` (and a
   *  consent entry's own `at`) rendered through `formatDateTime`, the
   *  RUNTIME's zone (server or browser), never the account's, the same bug
   *  D-010 fixed for the contacts list and the activity timeline. */
  timezone: string;
  /** S-10 T5 part 2: the OPERATOR reading this card — never a submission's
   *  OWN `locale` (the language the visitor filled the form out in, a fact
   *  about the row, never read here). */
  readerLocale?: Locale;
  pseudo?: boolean;
}) {
  const tr = makeTr(readerLocale, pseudo);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{tr.text("forms.submissions")}</CardTitle></CardHeader>
      <CardContent>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr.text("forms.noSubmissions")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {submissions.map((submission) => (
              <li key={submission.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatDateTimeInZone(submission.created_at, timezone, readerLocale)}
                  </span>
                  {submission.spam_reason ? (
                    <Badge
                      variant="secondary"
                      title={tr.text(`forms.spamReason.${submission.spam_reason}` as MessageKey)}
                    >
                      {tr.text("forms.blocked")}
                    </Badge>
                  ) : null}
                  {/* Surfaced, not swallowed: the lead was saved but part of the
                      enrichment failed, and somebody has to know. */}
                  {submission.processing_error ? (
                    <Badge variant="destructive" title={submission.processing_error}>
                      {tr.text("forms.needsAttention")}
                    </Badge>
                  ) : null}
                  {submission.contact_id ? (
                    <Link
                      href={`/dashboard/accounts/${accountId}/contacts/${submission.contact_id}`}
                      className="text-xs text-primary underline"
                    >
                      {tr.text("forms.contact")}
                    </Link>
                  ) : null}
                </div>
                <dl className="mt-1 space-y-0.5">
                  {submission.answers.filter((a) => a.value).map((answer) => (
                    <div key={answer.key} className="flex gap-2 text-sm">
                      <dt className="shrink-0 text-muted-foreground">{answer.label}:</dt>
                      <dd className="min-w-0 break-words text-card-foreground">{answer.value}</dd>
                    </div>
                  ))}
                </dl>
                {/* The pipeline stores the exact copy the person was shown, per
                    consent field, precisely so it can be produced later. Until
                    this rendered it, that evidence lived only in the database
                    and no operator could answer "prove they agreed". */}
                <ConsentList consent={submission.consent} timezone={timezone} tr={tr} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConsentList({
  consent, timezone, tr,
}: { consent: SubmissionRow["consent"]; timezone: string; tr: Tr }) {
  const entries = normalizeConsent(consent);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1.5 space-y-1 border-t border-border pt-1.5">
      {entries.map((entry) => (
        <li key={entry.key} className="flex gap-1.5 text-xs">
          {entry.given ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          ) : (
            <X className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
          )}
          <span className="min-w-0">
            {/* The icon carries the meaning, so a screen reader needs the word. */}
            <span className="sr-only">
              {entry.given ? tr.text("forms.consentGiven") : tr.text("forms.consentNotGiven")}:{" "}
            </span>
            <span className="break-words text-card-foreground">{entry.text}</span>
            {entry.at ? (
              <span className="text-muted-foreground"> · {formatDateTimeInZone(entry.at, timezone, tr.locale)}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
