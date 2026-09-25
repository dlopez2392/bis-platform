// The lead, onto the tenant's own destination form, through the same
// `enrich` the public form and the machine intake both run.
//
// EXTRACTED from `route.ts` (Branch 2 hardening, item 2 of the whole-branch
// review). Reason: `route.test.ts`'s own fixtures once let PROFILE's and
// CONVERSATION's form ids and the request's origin collide on the same
// literal value everywhere, so a regression reading the wrong one could not
// have failed a single assertion. `lead.test.ts` tests this function
// directly, with distinct literals for exactly that reason. Behaviour is
// otherwise UNCHANGED from what lived inside route.ts, except the consent
// shape (see the comment on `consent` below).
//
// ORDER, and why it is this way: `setConciergeSubmission` takes a submission
// id, so the row has to exist before the slot can be claimed — which means
// the LOSER of a race has already written a `form_submissions` row when it
// learns it lost. That row is deleted here rather than left behind: a
// lead-shaped row with no contact, no thread and no alert is a row nobody
// will ever act on, and it would inflate the form's submission count on the
// Forms screen. `enrich` runs only on the winner, so one visitor can never
// become two contacts, two threads and two alerts.
//
// Returns whether a submission was actually created and enriched — the
// route's own `spoken` line depends on this (Important 1, review of commit
// 129b43f): it must never thank a visitor for details that were not stored.
import type { serviceDb as serviceDbType } from "@bis/db";
import { isValidEmail, isValidPhone } from "@/lib/forms/guards";
import { splitName } from "@/lib/concierge/prompt";

// Same private type route.ts still declares for its own use (`serviceDb() as
// Db` at the top of the handler) — duplicated on purpose rather than
// imported back from there, so this module has no dependency on route.ts at
// all.
export type Db = ReturnType<typeof serviceDbType>;
export type Lead = { fullName: string; email: string; phone: string; need: string };

// Kept as its own tag rather than closing over route.ts's `log` (there is
// nothing to close over once this is its own module) — same JSON shape and
// the same `at` tag the route's own calls inside this function always used,
// so a log reader sees no change.
function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: "concierge/turn", msg, ...extra }));
}

export async function fileLead(ctx: {
  db: Db; accountId: string; formId: string; conversationId: string;
  attribution: Record<string, string>; locale: "en" | "es"; ipHash: string;
  origin: string | null; lead: Lead;
}): Promise<boolean> {
  const { db, lead } = ctx;
  try {
    // Lazy for the same reason as the handler's own import, and cached — the
    // module is already resolved by the time a lead is filed.
    const { getForm, createSubmission, setConciergeSubmission } = await import("@bis/db");
    const { enrich } = await import("@/lib/forms/enrich");

    // getForm(db, accountId, formId) — the account id IS a tenant boundary
    // (packages/db/src/forms.ts:97), so a form id that has drifted onto
    // another account's profile reads as "no such form" rather than as a
    // lead filed into somebody else's CRM. `ctx.formId` is taken as GIVEN —
    // this function has no profile row of its own to read a form id from,
    // and never should: which form to file against is the CALLER's decision
    // (route.ts passes the conversation's own `form_id`, captured at
    // conversation start, never `profile.concierge_form_id` — Important 1,
    // whole-branch review), and trusting whatever it was handed is what
    // keeps that decision in one place.
    const form = await getForm(db, ctx.accountId, ctx.formId);
    if (!form || form.status !== "published") {
      log("lead not filed: form unavailable", { formId: ctx.formId, status: form?.status });
      return false;
    }

    // Mapped by KIND, not by position: kinds this form does not carry are
    // dropped, exactly as `enrich`'s own byKind map expects. Required flags
    // are NOT enforced — a conversation that produced a name and a way to
    // reach someone is a lead, and refusing it because a fifth field is blank
    // throws away the thing this widget exists to catch.
    const { first, last } = splitName(lead.fullName);
    const hasSurnameField = form.fields.some((f) => f.kind === "core.last_name");
    const value = (kind: string) =>
      kind === "core.first_name" ? (hasSurnameField ? first : lead.fullName)
      : kind === "core.last_name" ? last
      // Validated before it is stored: the model was told not to invent
      // values, but "was told" is not a guarantee, and this value reaches the
      // contact dedupe lookup.
      : kind === "core.email" ? (isValidEmail(lead.email) ? lead.email : "")
      : kind === "core.phone" ? (isValidPhone(lead.phone) ? lead.phone : "")
      : kind === "message" ? lead.need : "";
    const answers = form.fields
      .map((f) => ({ key: f.key, label: f.label, value: value(f.kind) }))
      .filter((a) => a.value !== "");
    if (!answers.length) {
      log("lead not filed: nothing the form can carry", { formId: form.id });
      return false;
    }

    // Item 10 (Branch 2 hardening): the machine intake (#99,
    // api/intake/[publicId]/route.ts:117-121) writes every CONSENT-kind field
    // on the form as `{ key, given: false, text: label, at }`, never `[]`
    // regardless of whether the form carries one — so an operator reading the
    // row can tell "this form has no consent field at all" from "the visitor
    // never ticked it". A widget conversation cannot tick a box under its
    // exact wording either way — that is what `consentWithheld: true` below
    // is for, and it is unconditional, so this has no behavioural effect of
    // its own. Matching the shape only, for the operator reading the row.
    const now = new Date().toISOString();
    const consentFields = form.fields
      .filter((f) => f.kind === "consent")
      .map((f) => ({ key: f.key, given: false, text: f.label, at: now }));
    const consent = consentFields.length > 0 ? consentFields : null;

    // SubmissionInput's optional fields are `?: string`, NOT `| null`
    // (packages/db/src/forms.ts:147-155) — omit what you do not have rather
    // than passing null, which does not typecheck.
    const submission = await createSubmission(db, form.account_id, form.id, {
      answers, attribution: ctx.attribution, consent,
      locale: ctx.locale, ipHash: ctx.ipHash,
    });

    const claimedSlot = await setConciergeSubmission(db, ctx.conversationId, submission.id);
    if (!claimedSlot) {
      // A concurrent turn filed this conversation's lead first. See the
      // ORDER note above: clean up rather than leave an orphan.
      const { error } = await db.from("form_submissions")
        .delete().eq("id", submission.id).eq("account_id", form.account_id);
      log("lead not filed: already claimed", {
        conversationId: ctx.conversationId, cleanup: error?.message ?? "ok",
      });
      return false;
    }

    await enrich(
      db, form, submission.id, answers, ctx.attribution, ctx.origin, ctx.locale,
      // TRUE, ALWAYS, and NOT derived from whether this form happens to carry
      // a consent field. A conversation cannot tick a box under its exact
      // wording — the machine intake records every consent field as
      // `given: false` for exactly this reason — and a form WITHOUT one would
      // otherwise let a widget lead trigger an automatic text nobody agreed
      // to. The operator replies by hand from Conversations; that is the
      // design, not a gap.
      true,
    );
    log("lead filed", { conversationId: ctx.conversationId, submissionId: submission.id });
    return true;
  } catch (e) {
    // A failed lead must not cost the visitor their answer — they are
    // mid-conversation and the transcript is already stored.
    log("lead capture failed", { conversationId: ctx.conversationId, error: String(e) });
    return false;
  }
}
