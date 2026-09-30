import { m } from "@/lib/messages";

/**
 * The confirmation ask's LEAD: the brand, the appointment time (formatWhen,
 * in the BOOKER's zone — the email reminder's rule), the question, and the
 * reassurance, inside a fixed sentence the operator cannot rearrange.
 *
 * WHY IT IS FIXED. Spec decision 6: a YES gets no text back — a second
 * outbound per confirmation costs a message, risks a loop against the
 * carrier's own STOP handling, and would make the inbound webhook a sender
 * rather than a recorder. But a customer who replies YES into silence does
 * not know it worked, and this recipe exists to cut no-shows, so the
 * certainty is written into the ask instead: "either way we'll see it". If
 * that clause lived in the operator's editable body, the copy test asserting
 * it would be asserting a default anyone can delete — a guarantee the product
 * would not actually have. So the operator's field is a CLOSING line, exactly
 * as the text reminder's is (sms-reminder-copy.ts).
 *
 * `brandName` is the customer-facing name (the due-row carries only that); a
 * blank one drops the clause rather than inventing a noun. Function
 * replacement, not a plain string, for names containing `$&`.
 */
export function appointmentConfirmLead(brandName: string, whenText: string): string {
  const template = brandName.trim()
    ? m["automations.appointmentConfirm.lead"].replace("{name}", () => brandName)
    : m["automations.appointmentConfirm.leadNoName"];
  return template.replace("{when}", () => whenText);
}

/**
 * THE ONE composer: the lead, one space, the operator's optional closing
 * line. The settings page's segment counter and the pass both call this with
 * the same inputs, so the count the operator approves is the count that is
 * billed — the preview-vs-send drift fixed twice on 2026-09-06 cannot recur.
 */
export function composeAppointmentConfirm(brandName: string, whenText: string, body: string): string {
  return [appointmentConfirmLead(brandName, whenText), body.trim()].filter(Boolean).join(" ");
}
