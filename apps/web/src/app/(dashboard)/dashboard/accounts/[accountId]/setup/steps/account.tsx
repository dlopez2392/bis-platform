import { InlineField } from "@/components/inline-field";
import { m } from "@/lib/messages";
import type { StepDetailProps } from "./step-shared";

/**
 * `required`, not `field` — and a plain boolean, not a function.
 *
 * An account name is not one of `InlineField`'s five CONTACT columns (there
 * is no `field` to pass without lying about which column this edits), and a
 * contact column's own rule is wrong here anyway: `normalizeFieldInput`
 * treats an empty value as a CLEAR (every contact column is nullable),
 * while `accounts.name` has no fallback for "" — the client switcher, the
 * dashboard greeting and the accounts list would all break.
 *
 * The trim-and-reject-empty rule itself lives in `inline-field.tsx`
 * (`normalizeRequired`), NOT here, because this module is a SERVER
 * component and `InlineField` is `"use client"`: a function prop across
 * that boundary is not a lint nit but a hard Flight serializer error
 * ("Functions cannot be passed directly to Client Components") that 500s
 * the whole setup page — setup-panel.tsx builds all ten step nodes on
 * every render, so it threw no matter which step was selected. A boolean
 * serializes; a rule the client component already owns runs.
 */
export function AccountStep({ accountName, renameAction }: StepDetailProps): React.ReactNode {
  return (
    <div className="mt-3 max-w-sm space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{m["setup.rename.label"]}</p>
        <InlineField
          label={m["setup.rename.label"]}
          required
          value={accountName}
          save={renameAction}
        />
      </div>
      {/* Two facts, one line: this label is agency-private, and it is NOT
          what the client's own customers see — that name comes from
          Branding (steps/branding.tsx), a different step entirely. */}
      <p className="text-xs text-muted-foreground">{m["setup.rename.help"]}</p>
    </div>
  );
}
