"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { PhoneNumberRow, PhoneNumberStatus, VoiceProfileRow } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, nativeFieldClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { EmbedSnippet } from "@/components/embed-snippet";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultTextbackBody } from "@/lib/voice/textback-body";
import { NUMBER_STATUS_LABEL } from "@/lib/voice/number-status";
import type { ActionResult, EnableConciergeResult } from "./actions";

// The DB-side defaults (0019_voice_core.sql) — used whenever no row exists
// yet, which is the common case for an account that has never been touched:
// there is no auto-insert trigger, so `getVoiceProfile` returns null until
// the first save.
const DEFAULT_PROFILE: Omit<VoiceProfileRow, "id" | "account_id"> = {
  persona_name: "Sofía",
  greeting_en: "", greeting_es: "", facts: "", services: "",
  languages: "both", booking_enabled: true,
  after_hours: "hours_then_message", enabled: false,
  textback_enabled: false, textback_body: "",
  public_id: null, concierge_enabled: false, concierge_form_id: null,
};

const STATUS_VALUES: PhoneNumberStatus[] = ["provisioned", "testing", "live", "released"];

function VoiceProfileForm({
  profile, brandName, action,
}: {
  profile: VoiceProfileRow | null;
  brandName: string;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const p = profile ?? DEFAULT_PROFILE;
  // Controlled, not the uncontrolled `defaultValue` every other field in this
  // form uses, so the segment counter below can recompute on every keystroke
  // (message-composer.tsx's precedent — the rest of the form stays
  // uncontrolled). Seeded with the STORED value ONLY, never the live default:
  // this form submits `textback_body` on every save, including saves of
  // unrelated fields, so seeding it with `defaultTextbackBody(...)` would
  // silently pin that frozen text into the column on the operator's next
  // unrelated save — the exact calendars.followup_body defect this column's
  // empty-means-default contract exists to prevent. The empty textarea shows
  // the live default as its `placeholder` instead: greyed, not a real value,
  // so typing replaces it rather than appending to it.
  const [textbackBody, setTextbackBody] = useState(p.textback_body);
  // Which language the default previews in. `detectSpokenLanguage` decides
  // this per call at send time, and for a Spanish-only line it can only ever
  // answer "es" — so previewing English there would show the operator a
  // message none of their callers will receive. A bilingual line falls back
  // to "en", which is exactly what detectSpokenLanguage returns when the
  // caller's speech does not clear its Spanish bar.
  //
  // Uncontrolled Select + onValueChange, NOT a controlled `value`: the form
  // submits via onSubmit so React never resets it (see the form comment
  // below), and passing `value` here would re-introduce the Radix
  // reset-drives-state-backwards hazard for no gain. This state exists only
  // to redraw the preview.
  const [previewLanguage, setPreviewLanguage] = useState<"en" | "es">(
    p.languages === "es" ? "es" : "en",
  );
  // What the counter below previews must match what actually sends: an
  // empty textarea means "use the live default at send time" (the
  // empty-means-default contract this column exists for, explained above),
  // so the preview has to be the default's own segment count, not 0
  // chars / 1 message for a string that will never be what goes out. The
  // moment the operator types anything, `textbackBody` itself takes over.
  const previewBody = textbackBody || defaultTextbackBody(brandName, previewLanguage);
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: m["voice.profile.saved"],
      crashed: m["common.actionCrashed"],
    });
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["voice.profile.title"]}</CardTitle>
        <CardDescription>{m["voice.profile.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          // onSubmit via useFormSubmit, NOT the `action` prop: React resets an
          // action-prop form even when the action resolves to {ok:false}, and
          // the two Selects below revert to their first-render values on that
          // reset — so a refused save silently discarded the operator's
          // choices. See lib/forms/use-form-submit.ts.
          //
          // notifyActionResult stays for its own reason: a stale-deployment
          // tab's save REJECTS rather than returning {ok:false} — that failure
          // must toast, never vanish (2026-08-29 calendar-settings, live).
          onSubmit={onSubmit}
          className="space-y-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="persona_name">{m["voice.profile.personaName"]}</Label>
            <Input id="persona_name" name="persona_name" defaultValue={p.persona_name} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="greeting_en">{m["voice.profile.greetingEn"]}</Label>
              <textarea
                id="greeting_en" name="greeting_en" rows={3} defaultValue={p.greeting_en}
                className={nativeFieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="greeting_es">{m["voice.profile.greetingEs"]}</Label>
              <textarea
                id="greeting_es" name="greeting_es" rows={3} defaultValue={p.greeting_es}
                className={nativeFieldClass}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="facts">{m["voice.profile.facts"]}</Label>
            <textarea
              id="facts" name="facts" rows={5} defaultValue={p.facts}
              className={nativeFieldClass}
            />
            <p className="text-xs text-muted-foreground">{m["voice.profile.factsHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="services">{m["voice.profile.services"]}</Label>
            <textarea
              id="services" name="services" rows={3} defaultValue={p.services}
              className={nativeFieldClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="languages">{m["voice.profile.language"]}</Label>
              <Select
                name="languages" defaultValue={p.languages}
                onValueChange={(v) => setPreviewLanguage(v === "es" ? "es" : "en")}
              >
                <SelectTrigger id="languages" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{m["voice.profile.language.en"]}</SelectItem>
                  <SelectItem value="es">{m["voice.profile.language.es"]}</SelectItem>
                  <SelectItem value="both">{m["voice.profile.language.both"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="after_hours">{m["voice.profile.afterHours"]}</Label>
              <Select name="after_hours" defaultValue={p.after_hours}>
                <SelectTrigger id="after_hours" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours_then_message">{m["voice.profile.afterHours.hoursThenMessage"]}</SelectItem>
                  <SelectItem value="message_only">{m["voice.profile.afterHours.messageOnly"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="booking_enabled" name="booking_enabled" defaultChecked={p.booking_enabled} />
            <Label htmlFor="booking_enabled">{m["voice.profile.bookingEnabled"]}</Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="enabled" name="enabled" defaultChecked={p.enabled} />
            <Label htmlFor="enabled">{m["voice.profile.enabled"]}</Label>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Checkbox id="textback_enabled" name="textback_enabled" defaultChecked={p.textback_enabled} />
              <Label htmlFor="textback_enabled">{m["voice.textback.enabled"]}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{m["voice.textback.help"]}</p>
            <Label htmlFor="textback_body">{m["voice.textback.body"]}</Label>
            <textarea
              id="textback_body" name="textback_body" rows={2}
              value={textbackBody}
              onChange={(e) => setTextbackBody(e.target.value)}
              placeholder={defaultTextbackBody(brandName, previewLanguage)}
              className={nativeFieldClass}
            />
            <p className="text-xs text-muted-foreground">
              {m["compose.smsSegments"]
                .replace("{chars}", String(segmentsFor(previewBody).chars))
                .replace("{segments}", String(segmentsFor(previewBody).segments))}
            </p>
          </div>

          <SubmitButton pending={pending}>{m["voice.profile.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

export type ConciergeLockReason = "no_profile" | "blank_greeting" | "no_published_form";

/**
 * The pure decision behind the website-assistant toggle's disabled state —
 * extracted so it is testable without a DOM (this repo has no jsdom/.tsx
 * infra; concierge-chat.tsx's `pickTurnUpdate` is the precedent).
 *
 * Order is load-bearing: a profile that does not exist has no greeting to
 * check, so `no_profile` comes first. `no_published_form` comes last because
 * it is the destination gate, independent of the profile's own readiness —
 * an account can have a form published long before its greeting is written,
 * or vice versa.
 *
 * Greeting rule, verbatim from the brief: gate on `greeting_en` ALWAYS
 * (regardless of `languages`), and on `greeting_es` too when `languages` is
 * `es` or `both` — a bilingual line silent for half its callers is exactly
 * the state this exists to prevent.
 */
export function conciergeLockReason(
  profile: Pick<VoiceProfileRow, "greeting_en" | "greeting_es" | "languages"> | null,
  publishedFormCount: number,
): ConciergeLockReason | null {
  if (!profile) return "no_profile";
  const enBlank = !profile.greeting_en.trim();
  const esBlank = (profile.languages === "es" || profile.languages === "both") && !profile.greeting_es.trim();
  if (enBlank || esBlank) return "blank_greeting";
  if (publishedFormCount === 0) return "no_published_form";
  return null;
}

export type ConciergeDestinationOption = { id: string; name: string };

/**
 * Whether the card's whole body should be replaced by the empty state
 * (DESIGN.md rule 5) that sells "publish a form first."
 *
 * `!enabled` is load-bearing, not decoration (Task 6's review, "an ON
 * assistant with no off switch"): `conciergeLockReason` correctly reads
 * `no_published_form` the moment an operator unpublishes the form an ALREADY
 * ON assistant sends to — deciding to show the empty state from that reason
 * alone would then hide the toggle itself, and a hidden toggle cannot be
 * switched off. The empty state is for an account that has never had
 * anywhere to send a lead; an account that is live and lost its destination
 * gets `conciergeFormUnpublished`'s sentence instead, beside a toggle it can
 * still click.
 */
export function shouldShowConciergeEmptyState(
  enabled: boolean, lockReason: ConciergeLockReason | null,
): boolean {
  return !enabled && lockReason === "no_published_form";
}

/**
 * True when the assistant is ON and its stored destination is not among the
 * currently published forms — unpublished out from under it, most likely.
 * Off by construction while the assistant is off: an account that has never
 * turned it on has no live destination to warn about yet, whatever
 * `concierge_form_id` happens to hold from a prior, since-disabled run.
 */
export function conciergeFormUnpublished(
  enabled: boolean, storedFormId: string | null, publishedForms: ConciergeDestinationOption[],
): boolean {
  return enabled && Boolean(storedFormId) && !publishedForms.some((f) => f.id === storedFormId);
}

/**
 * The destination Select's own option list. Ordinarily just the published
 * forms — the only things a NEW selection may point at. But once the
 * assistant is on and its stored destination has fallen out of that list
 * (unpublished), the Select's `value` still equals that stored id, and
 * `SelectValue` renders blank for a value matching no `SelectItem` — a
 * destination that is very much still live, reading as if nothing were
 * chosen at all. This component never receives an unpublished form's real
 * title (page.tsx narrows `listForms` to published on purpose — "a draft has
 * no /f/<publicId> a lead could land on" — so there is no name to recover
 * here, only to invent), so the added option carries the explanatory label
 * `voice.assistant.unpublishedFormOption` instead of a fabricated title.
 */
export function conciergeDestinationOptions(
  enabled: boolean, storedFormId: string | null, publishedForms: ConciergeDestinationOption[],
): ConciergeDestinationOption[] {
  if (!enabled || !storedFormId) return publishedForms;
  if (publishedForms.some((f) => f.id === storedFormId)) return publishedForms;
  return [...publishedForms, { id: storedFormId, name: m["voice.assistant.unpublishedFormOption"] }];
}

/**
 * The id the pasteable snippet renders from, or null to hide it.
 *
 * Prefers the server-confirmed `profile.public_id` once `enabled` reads
 * true. Falls back to `optimisticPublicId` — the id `enableConciergeAction`
 * just minted or kept (Task 1's contract: enabling always returns the
 * stored id, new or old) — for the moment between that action resolving and
 * `revalidatePath`'s refresh landing, so the snippet an operator's very
 * next move is "copy" appears the instant the toggle succeeds rather than
 * after a second round trip. A stale optimistic id left over from an
 * earlier click never wins once the real data catches up: the first branch
 * always takes priority.
 */
export function conciergeSnippetPublicId(
  enabled: boolean, storedPublicId: string | null, optimisticPublicId: string | null,
): string | null {
  if (enabled && storedPublicId) return storedPublicId;
  return optimisticPublicId;
}

/**
 * The website assistant — the same receptionist, answering on the client's
 * site instead of the phone. A sibling card to `VoiceProfileForm` above (its
 * `booking_enabled`/`textback_enabled` checkboxes are the pattern this
 * follows: a feature switch beside the profile that has to be ready before
 * it means anything), not nested inside it — its own action, its own
 * `enableConcierge`/`disableConcierge` write, matching the rest of this
 * file's one-form-per-write shape.
 *
 * Reversible, immediate, with an undo toast (DESIGN.md rule 6) — no "are you
 * sure": flipping it back is one click either direction, so a confirm dialog
 * would only slow down the common case to guard against a mistake that costs
 * nothing to reverse.
 *
 * Ghost actions throughout (DESIGN.md rule 8) — `VoiceProfileForm`'s Save
 * button above is this page's one primary button.
 */
function ConciergeCard({
  accountId, profile, publishedForms, origin,
  enableAction, disableAction,
}: {
  accountId: string;
  profile: VoiceProfileRow | null;
  publishedForms: { id: string; name: string }[];
  origin: string;
  enableAction: (formId: string) => Promise<EnableConciergeResult>;
  disableAction: () => Promise<ActionResult>;
}) {
  const lockReason = conciergeLockReason(profile, publishedForms.length);
  const enabled = Boolean(profile?.concierge_enabled);
  // Pre-selected when the account has exactly one published form (the
  // brief's own rule); otherwise seeded from whatever is already stored, so
  // a page reload after enabling still shows the real destination.
  const [selectedFormId, setSelectedFormId] = useState<string>(
    profile?.concierge_form_id ?? (publishedForms.length === 1 ? publishedForms[0]!.id : ""),
  );
  const [pending, startTransition] = useTransition();
  // The id `enableAction` just minted or kept, held only for the gap between
  // that promise resolving and `revalidatePath`'s refresh landing — see
  // `conciergeSnippetPublicId`'s own doc. Cleared on a successful disable so
  // a stale id never outlives the toggle that produced it.
  const [optimisticPublicId, setOptimisticPublicId] = useState<string | null>(null);

  function turnOn() {
    if (!selectedFormId || pending) return;
    startTransition(async () => {
      const result = await enableAction(selectedFormId);
      if (!result.ok) { toast.error(result.error); return; }
      setOptimisticPublicId(result.publicId);
      toast.success(m["voice.assistant.enabledToast"], {
        action: {
          label: m["common.undo"],
          onClick: () => startTransition(async () => {
            const r = await disableAction();
            if (!r.ok) { toast.error(r.error); return; }
            setOptimisticPublicId(null);
          }),
        },
      });
    });
  }

  function turnOff() {
    if (pending) return;
    startTransition(async () => {
      const result = await disableAction();
      if (!result.ok) { toast.error(result.error); return; }
      setOptimisticPublicId(null);
      toast.success(m["voice.assistant.disabledToast"], {
        action: {
          label: m["common.undo"],
          onClick: () => startTransition(async () => {
            const r = await enableAction(selectedFormId);
            if (!r.ok) { toast.error(r.error); return; }
            setOptimisticPublicId(r.publicId);
          }),
        },
      });
    });
  }

  const showEmptyState = shouldShowConciergeEmptyState(enabled, lockReason);
  const storedFormId = profile?.concierge_form_id ?? null;
  const destinationOptions = conciergeDestinationOptions(enabled, storedFormId, publishedForms);
  const formUnpublished = conciergeFormUnpublished(enabled, storedFormId, publishedForms);
  const snippetPublicId = conciergeSnippetPublicId(enabled, profile?.public_id ?? null, optimisticPublicId);

  // Which sentence, if any, sits under the toggle — tied to it with
  // `aria-describedby` (checklist-panel.tsx:65's precedent) so a screen
  // reader hears WHY a locked toggle refuses a click, or why an ON toggle
  // still needs attention. Mutually exclusive: `formUnpublished` only fires
  // while ON, `lockText` only renders while OFF.
  const reasonText = !enabled ? (
    lockReason === "no_profile" ? m["voice.assistant.lockedNoProfile"]
    : lockReason === "blank_greeting" ? m["voice.assistant.lockedBlankGreeting"]
    : !selectedFormId ? m["voice.assistant.lockedNoSelection"]
    : null
  ) : (formUnpublished ? m["voice.assistant.formUnpublished"] : null);
  const reasonId = "concierge-toggle-reason";

  const toggleDisabled =
    pending || (!enabled && (lockReason === "no_profile" || lockReason === "blank_greeting" || !selectedFormId));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{m["voice.assistant.title"]}</CardTitle>
          <CardDescription>{m["voice.assistant.body"]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showEmptyState ? (
            // The empty state (DESIGN.md rule 5): sells the next step rather
            // than reporting a failure — there is nothing broken here, the
            // account simply has not published a form yet. Gated on `!enabled`
            // inside `shouldShowConciergeEmptyState` — an assistant that is ON
            // never disappears behind this, because it contains no toggle.
            <EmptyState
              icon={MessageCircle}
              title={m["voice.assistant.noFormTitle"]}
              body={m["voice.assistant.noFormBody"]}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/dashboard/accounts/${accountId}/forms`}>{m["voice.assistant.goToForms"]}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="concierge_form">{m["voice.assistant.destinationLabel"]}</Label>
                <Select
                  value={selectedFormId}
                  onValueChange={setSelectedFormId}
                  disabled={enabled || pending}
                >
                  <SelectTrigger id="concierge_form" className="w-full">
                    <SelectValue placeholder={m["voice.assistant.destinationPlaceholder"]} />
                  </SelectTrigger>
                  <SelectContent>
                    {destinationOptions.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="concierge_enabled"
                  checked={enabled}
                  disabled={toggleDisabled}
                  onCheckedChange={(v) => (v === true ? turnOn() : turnOff())}
                  aria-describedby={reasonText ? reasonId : undefined}
                />
                <Label htmlFor="concierge_enabled">{m["voice.assistant.toggleLabel"]}</Label>
              </div>
              {reasonText ? (
                <p id={reasonId} className="text-xs text-muted-foreground">{reasonText}</p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
      {snippetPublicId ? (
        <EmbedSnippet
          attribute="data-concierge"
          publicId={snippetPublicId}
          origin={origin}
          title={m["voice.assistant.snippetTitle"]}
          hint={m["voice.assistant.snippetHint"]}
          disabledHint={m["voice.assistant.snippetHint"]}
          enabled
          copyLabel={m["voice.assistant.copy"]}
          copiedLabel={m["voice.assistant.copied"]}
          publicLinkLabel={m["voice.assistant.publicLink"]}
        />
      ) : null}
    </>
  );
}

/**
 * Where a caller who asks for a person gets sent — and the interlock on the
 * whole handoff feature, because Sofía is only told she can offer a transfer
 * when this number is set (`handoffAvailable`, lib/voice/system-prompt.ts).
 *
 * THE FIELD IS THE SWITCH. No checkbox beside it: a toggle and a number are
 * two places to say the same thing and they drift, and the drifted state
 * ("on" with nothing to dial) is a promise made to a caller that the product
 * cannot keep. Blank means Sofía takes a message, which is what she does
 * today, and the hint says so in those words rather than calling it "off".
 *
 * Its own form and its own action, not a field on the profile form above:
 * this writes `accounts`, the profile form writes `voice_profiles`, and a
 * refused transfer number must not take an unrelated greeting edit down with
 * it. Uncontrolled `defaultValue` — the server component re-reads the stored
 * value after `revalidatePath`, so what the box shows is what is saved.
 */
function TransferPanel({
  transferPhone, action,
}: {
  transferPhone: string | null;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    // Clearing and saving are the same submit, so the toast has to say which
    // one happened — "saved" after an operator emptied the box would read as
    // a transfer that is still on.
    const cleared = !String(formData.get("transfer_phone") ?? "").trim();
    await notifyActionResult(() => action(formData), toast, {
      success: cleared ? m["voice.transfer.cleared"] : m["voice.transfer.saved"],
      crashed: m["common.actionCrashed"],
    });
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["voice.transfer.title"]}</CardTitle>
        <CardDescription>{m["voice.transfer.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="transfer_phone">{m["voice.transfer.label"]}</Label>
            {/* No `required`: blank is a legitimate value here — it is how the
                feature is turned off. */}
            <Input
              id="transfer_phone" name="transfer_phone" type="tel"
              autoComplete="tel" defaultValue={transferPhone ?? ""}
            />
            <p className="text-xs text-muted-foreground">{m["voice.transfer.hint"]}</p>
          </div>
          <SubmitButton pending={pending}>{m["voice.transfer.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

function NumberStatusSelect({
  phoneNumber, statusAction,
}: {
  phoneNumber: PhoneNumberRow;
  statusAction: (phoneNumberId: string, status: string) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();

  function run(status: string) {
    startTransition(async () => {
      const result = await statusAction(phoneNumber.id, status);
      if (result.ok) toast.success(m["voice.numbers.statusUpdated"]);
      else toast.error(result.error);
    });
  }

  return (
    <Select value={phoneNumber.status} onValueChange={run} disabled={pending}>
      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        {STATUS_VALUES.map((v) => (
          <SelectItem key={v} value={v}>{NUMBER_STATUS_LABEL[v]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PhoneNumbersPanel({
  numbers, assignAction, statusAction,
}: {
  numbers: PhoneNumberRow[];
  assignAction: (formData: FormData) => Promise<ActionResult>;
  statusAction: (phoneNumberId: string, status: string) => Promise<ActionResult>;
}) {
  const assignSubmit = useFormSubmit(async (formData, form) => {
    const result = await assignAction(formData);
    if (result.ok) {
      toast.success(m["voice.numbers.assigned"]);
      // Clear for the next number. `isConnected` because a form that has been
      // unmounted mid-flight cannot be reset.
      if (form.isConnected) form.reset();
    } else {
      toast.error(result.error);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["voice.numbers.title"]}</CardTitle>
        <CardDescription>{m["voice.numbers.body"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m["voice.numbers.empty"]}</p>
        ) : (
          <ul className="divide-y divide-border">
            {numbers.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-card-foreground">{n.e164}</p>
                  {n.telnyx_id ? (
                    <p className="text-xs text-muted-foreground">{n.telnyx_id}</p>
                  ) : null}
                </div>
                <NumberStatusSelect phoneNumber={n} statusAction={statusAction} />
              </li>
            ))}
          </ul>
        )}

        <form
          // Same reason as every other converted form (see
          // lib/forms/use-form-submit.ts) — but this one is an ADD form, so
          // the clear-after-success that React's reset used to give for free
          // is wanted and is now explicit. Only on success: a rejected number
          // must stay in the field for the operator to correct, which is
          // exactly what the old behaviour got wrong.
          onSubmit={assignSubmit.onSubmit}
          className="space-y-3 border-t border-border pt-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="e164">{m["voice.numbers.e164"]}</Label>
            <Input id="e164" name="e164" required />
            <p className="text-xs text-muted-foreground">{m["voice.numbers.e164Hint"]}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="telnyxId">{m["voice.numbers.telnyxId"]}</Label>
            <Input id="telnyxId" name="telnyxId" />
          </div>
          <SubmitButton pending={assignSubmit.pending}>{m["voice.numbers.assign"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

export function VoiceSettings({
  accountId, profile, brandName, numbers, transferPhone, publishedForms, origin,
  saveProfileAction, assignNumberAction, setStatusAction, setTransferPhoneAction,
  enableConciergeAction, disableConciergeAction,
}: {
  accountId: string;
  profile: VoiceProfileRow | null;
  // The live text-back default (defaultTextbackBody) names the company, so
  // the textarea's placeholder needs it — passed down from the server
  // component rather than re-fetched here, matching how this whole page
  // resolves its data. Already resolved to the CUSTOMER-FACING name
  // (`brandDisplayName`, page.tsx), never the agency's internal
  // `accounts.name` label: what the operator previews has to be the string
  // that actually sends.
  brandName: string;
  numbers: PhoneNumberRow[];
  // Null is "no transfer configured", which is where every account starts and
  // is not a failure — it is the state that leaves Sofía taking a message.
  transferPhone: string | null;
  /** Published forms only — the website assistant's destination choices. */
  publishedForms: { id: string; name: string }[];
  /** For the pasteable snippet — read from the request, matching the
   *  forms/calendar embed cards' own origin (page.tsx). */
  origin: string;
  saveProfileAction: (formData: FormData) => Promise<ActionResult>;
  assignNumberAction: (formData: FormData) => Promise<ActionResult>;
  setStatusAction: (phoneNumberId: string, status: string) => Promise<ActionResult>;
  setTransferPhoneAction: (formData: FormData) => Promise<ActionResult>;
  enableConciergeAction: (formId: string) => Promise<EnableConciergeResult>;
  disableConciergeAction: () => Promise<ActionResult>;
}) {
  return (
    <div className="space-y-6">
      <VoiceProfileForm profile={profile} brandName={brandName} action={saveProfileAction} />
      <ConciergeCard
        accountId={accountId}
        profile={profile}
        publishedForms={publishedForms}
        origin={origin}
        enableAction={enableConciergeAction}
        disableAction={disableConciergeAction}
      />
      <TransferPanel transferPhone={transferPhone} action={setTransferPhoneAction} />
      <PhoneNumbersPanel numbers={numbers} assignAction={assignNumberAction} statusAction={setStatusAction} />
    </div>
  );
}
