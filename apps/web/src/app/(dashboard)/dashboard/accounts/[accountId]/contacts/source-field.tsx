"use client";

import { InlineField } from "@/components/inline-field";
import { m } from "@/lib/messages";
import { updateContactFieldAction } from "./actions";

/**
 * F-157's drawer line, shared by the drawer and the full contact page (the
 * same split `FIELDS` in contact-drawer.tsx follows): `source` is the raw
 * column, inline-editable like any other field — click, type the owner's
 * own note, save on blur, Undo toast (DESIGN.md record pattern). `sourceHint`
 * sits below it, read-only — the system's own observed fact (an attribution
 * channel, a referral answer, or "Source unknown" in plain words), never
 * something an edit here overwrites. Provenance: an edit here goes through
 * `updateContactFieldAction`, the same path every other inline field uses,
 * which emits `contact.updated` with the real actor (packages/db/src/
 * contacts.ts's `updateContact`) — never a silent write.
 */
export function SourceField({
  accountId, contactId, source, sourceHint, onSaved,
}: {
  accountId: string;
  contactId: string;
  source: string | null;
  sourceHint: string | null;
  /** Bumps the caller's refresh after a successful save — the hint can
   *  depend on `source` itself (the "Source unknown" case), so a save that
   *  fills it in needs a fresh read to drop that caption. */
  onSaved?: () => void;
}) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2">
      <dt className="text-muted-foreground pt-1 text-xs">{m["contact.source.label"]}</dt>
      <dd>
        <InlineField
          label={m["contact.source.label"]}
          field="source"
          value={source}
          save={async (v) => {
            const saved = await updateContactFieldAction(accountId, contactId, "source", v);
            if (saved.ok) onSaved?.();
            return saved;
          }}
        />
        {sourceHint ? (
          // Review round 3, item 3: `custom.referred_by` (the source
          // question's answer) is shown ONLY on this line, and round 2's
          // CSS fix (`truncate`, a one-line visual clip) hid it from any
          // keyboard or touch user — there is no hover to recover the
          // clipped part from a `title` tooltip without a mouse. The text
          // now WRAPS instead (`break-words`, no truncate, no
          // line-clamp): nothing is ever hidden from anyone. No `title`
          // either — the full text is already on screen, so a tooltip
          // repeating it adds nothing.
          <p className="text-muted-foreground mt-0.5 break-words px-2 text-xs">
            {sourceHint}
          </p>
        ) : null}
      </dd>
    </div>
  );
}
