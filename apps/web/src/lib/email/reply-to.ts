/**
 * The one place an absent reply-to becomes an omitted header.
 *
 * Three unrelated sources feed the two send paths, and each spells "no
 * address" differently: an unset column is `null`, a cleared form field is
 * `""`, and a form with no email question yields `""` from `enrich`'s byKind
 * map. Passing any of them straight through hands Resend `replyTo: ""` — a
 * header with an empty value rather than no header at all.
 *
 * Both callers go through this rather than testing truthiness inline, so the
 * blank case is decided once and pinned by one test instead of being
 * re-derived at each send site.
 */
export function normalizeReplyTo(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
