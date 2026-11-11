import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The call-in code, shown once from the verification action's own answer (it is stored hashed). Final review M-4:
 * an aria-label on a <p> is ignored (a paragraph cannot be named), so the code is named by VISIBLE label text, in a
 * group labelled by it. "It works for N minutes" reads `minutes` (OWNER_LINE_VERIFY_MINUTES, passed down from the
 * server page), so the copy cannot drift from the expiry the database writes.
 */
export function OwnerLineCode(props: { accountId: string; code: string; number: string; minutes: number; locale: Locale; pseudo: boolean }) {
  const tr = makeTr(props.locale, props.pseudo);
  const labelId = `ol-code-label-${props.accountId}`;
  return (
    <>
      <p className="text-sm">{tr.text("ownerLine.card.verify.instructions", { number: props.number, minutes: String(props.minutes) })}</p>
      <div role="group" aria-labelledby={labelId} className="space-y-1">
        <p id={labelId} className="text-sm text-[var(--text-2)]">{tr.text("ownerLine.card.verify.codeLabel")}</p>
        <p className="font-mono text-2xl tabular-nums tracking-[0.3em]">{props.code}</p>
      </div>
    </>
  );
}
