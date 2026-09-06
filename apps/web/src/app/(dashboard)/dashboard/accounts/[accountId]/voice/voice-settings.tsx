"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { PhoneNumberRow, PhoneNumberStatus, VoiceProfileRow } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultTextbackBody } from "@/lib/voice/textback-body";
import type { ActionResult } from "./actions";

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
};

const STATUS_LABEL: Record<PhoneNumberStatus, string> = {
  provisioned: m["voice.numbers.status.provisioned"],
  testing: m["voice.numbers.status.testing"],
  live: m["voice.numbers.status.live"],
  released: m["voice.numbers.status.released"],
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
  // What the counter below previews must match what actually sends: an
  // empty textarea means "use the live default at send time" (the
  // empty-means-default contract this column exists for, explained above),
  // so the preview has to be the default's own segment count, not 0
  // chars / 1 message for a string that will never be what goes out. The
  // moment the operator types anything, `textbackBody` itself takes over.
  const previewBody = textbackBody || defaultTextbackBody(brandName);
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
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="greeting_es">{m["voice.profile.greetingEs"]}</Label>
              <textarea
                id="greeting_es" name="greeting_es" rows={3} defaultValue={p.greeting_es}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="facts">{m["voice.profile.facts"]}</Label>
            <textarea
              id="facts" name="facts" rows={5} defaultValue={p.facts}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">{m["voice.profile.factsHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="services">{m["voice.profile.services"]}</Label>
            <textarea
              id="services" name="services" rows={3} defaultValue={p.services}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="languages">{m["voice.profile.language"]}</Label>
              <Select name="languages" defaultValue={p.languages}>
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
              placeholder={defaultTextbackBody(brandName)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          <SelectItem key={v} value={v}>{STATUS_LABEL[v]}</SelectItem>
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
  profile, brandName, numbers, saveProfileAction, assignNumberAction, setStatusAction,
}: {
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
  saveProfileAction: (formData: FormData) => Promise<ActionResult>;
  assignNumberAction: (formData: FormData) => Promise<ActionResult>;
  setStatusAction: (phoneNumberId: string, status: string) => Promise<ActionResult>;
}) {
  return (
    <div className="space-y-6">
      <VoiceProfileForm profile={profile} brandName={brandName} action={saveProfileAction} />
      <PhoneNumbersPanel numbers={numbers} assignAction={assignNumberAction} statusAction={setStatusAction} />
    </div>
  );
}
