import { Label } from "@/components/ui/label";

/**
 * The text a customer will receive, shown as the field it becomes. One
 * component for every SMS preview on the Automations page (confirmations,
 * text reminders, instant reply in both languages) so two cards side by side
 * cannot render the same idea two ways.
 *
 * A `<Label htmlFor>` plus an `<output id>`, not a bare `<p>`: the label is
 * what NAMES the preview to a screen reader and the `<output>` makes it a
 * live region that is re-read as the operator types. The --input-line /
 * --input-bg box in the control radius is what makes it read as a field.
 * `data-testid` stays the output's LAST attribute: the card tests read the
 * text with `data-testid="…">([^<]*)</output>`.
 *
 * The segment counter under each preview stays at the call site; each card
 * counts a different string (the disclosed body), and says so in its own
 * words.
 */
export function SmsPreview({
  id, label, text, testId,
}: { id: string; label: string; text: string; testId: string }) {
  return (
    <>
      <Label htmlFor={id}>{label}</Label>
      <output
        id={id}
        className="block rounded-[var(--radius-ctl)] border border-[var(--input-line)] bg-[var(--input-bg)] px-3 py-2 text-[13px]"
        data-testid={testId}
      >{text}</output>
    </>
  );
}
