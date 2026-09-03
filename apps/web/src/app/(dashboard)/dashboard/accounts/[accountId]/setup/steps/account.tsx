import { InlineField } from "@/components/inline-field";
import { m } from "@/lib/messages";
import type { StepDetailProps } from "./step-shared";

/**
 * Trim, then reject empty — matching `renameAccountAction`'s own
 * server-side rule (../actions.ts) exactly, both the trim and the message.
 * An account name is not one of `InlineField`'s five CONTACT columns (it
 * has no `field` to pass without lying about which column this edits), and
 * a contact column's own rule is wrong here anyway: `normalizeFieldInput`
 * treats an empty value as a CLEAR (every contact column is nullable),
 * while `accounts.name` has no fallback for "" — the client switcher, the
 * dashboard greeting and the accounts list would all break. This function
 * is the one place that rule lives; it only ever gets a chance to run
 * before the same rule runs again, for real, on the server.
 */
function validateAccountName(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: m["setup.rename.empty"] };
  return { ok: true, value };
}

export function AccountStep({ accountName, renameAction }: StepDetailProps): React.ReactNode {
  return (
    <div className="mt-3 max-w-sm space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{m["setup.rename.label"]}</p>
        <InlineField
          label={m["setup.rename.label"]}
          validate={validateAccountName}
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
