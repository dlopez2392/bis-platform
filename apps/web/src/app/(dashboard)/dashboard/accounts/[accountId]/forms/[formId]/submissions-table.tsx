import Link from "next/link";
import type { SubmissionRow } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { m } from "@/lib/messages";

export function SubmissionsTable({
  accountId, submissions,
}: { accountId: string; submissions: SubmissionRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{m["forms.submissions"]}</CardTitle></CardHeader>
      <CardContent>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m["forms.noSubmissions"]}</p>
        ) : (
          <ul className="divide-y divide-border">
            {submissions.map((submission) => (
              <li key={submission.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(submission.created_at)}
                  </span>
                  {submission.spam_reason ? (
                    <Badge variant="secondary">{m["forms.blocked"]}</Badge>
                  ) : null}
                  {/* Surfaced, not swallowed: the lead was saved but part of the
                      enrichment failed, and somebody has to know. */}
                  {submission.processing_error ? (
                    <Badge variant="destructive" title={submission.processing_error}>
                      {m["forms.needsAttention"]}
                    </Badge>
                  ) : null}
                  {submission.contact_id ? (
                    <Link
                      href={`/dashboard/accounts/${accountId}/contacts/${submission.contact_id}`}
                      className="text-xs text-primary underline"
                    >
                      {m["forms.contact"]}
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
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
