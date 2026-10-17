"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { InboundMode } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { InboundModeResult, DnsCheckResult } from "./actions";
import { applyReplies, probeDns, MODE_LABEL, type RepliesSettings } from "./replies-row-handlers";

const MODE_OPTIONS: readonly InboundMode[] = ["off", "bis", "own_domain"];

/** The body sentence under the state dot — the mode's own sentence, never another mode's (mutation target: swap bis/off → caught in sending-address-card.test.ts). */
function repliesBody(s: { mode: InboundMode; domain: string | null }): string {
  if (s.mode === "off") return m["settings.replies.offBody"];
  if (s.mode === "bis") return m["settings.replies.bisBody"];
  return m["settings.replies.ownBody"].replace("{domain}", s.domain ?? "");
}

/**
 * The Replies row (S-06 part 1, Task 10): on/off customer replies into BIS,
 * either at the shared BIS address or the client's own domain once its DNS
 * is proven. Applies AT ONCE with an Undo toast (DESIGN.md rule 6) — there
 * is no Save button for this row, unlike the sending-address form above it.
 *
 * "Own domain" is a two-step choice, not a single radio click: picking the
 * tile only REVEALS the domain field and Check DNS — selecting it never
 * calls `setReplies` itself. Only a Check DNS that answers `{ ok: true }`
 * writes the mode (the server re-checks the MX anyway; this is a
 * convenience, never a trust boundary — setInboundModeAction's own comment).
 * Picking Off or BIS address applies immediately, same as every other
 * at-once control in this app (the Texts row, the Email row).
 */
function RepliesRow({
  replies, setReplies, checkDns,
}: {
  replies: { mode: InboundMode; domain: string | null };
  setReplies: (next: { mode: InboundMode; domain: string | null }) => Promise<InboundModeResult>;
  checkDns: (domain: string) => Promise<DnsCheckResult>;
}) {
  // What is actually SAVED — drives the dot and the body sentence.
  const [applied, setApplied] = useState(replies);
  // What the radio group shows — can sit on "own_domain" locally while
  // nothing has been written yet (the field is revealed but unconfirmed).
  const [selected, setSelected] = useState<InboundMode>(replies.mode);
  const [domainInput, setDomainInput] = useState(replies.domain ?? "");
  const [dnsResult, setDnsResult] = useState<DnsCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  // Every write below runs through applyReplies/probeDns
  // (replies-row-handlers.ts), which catches a THROWN server action — a
  // stale deployment, an expired session — and toasts common.actionCrashed
  // instead of failing silently (fix round 1, code review). Local state is
  // only ever written from onApplied/onUndone, which those helpers call
  // ONLY once the server has answered `{ ok: true }` — so a crash or a
  // refusal leaves `applied`/`selected`/`domainInput` exactly as they were.
  function onApplied(next: RepliesSettings) {
    setApplied(next);
    setSelected(next.mode);
  }
  function onUndone(previous: RepliesSettings) {
    setApplied(previous);
    setSelected(previous.mode);
    setDomainInput(previous.domain ?? "");
    setDnsResult(null);
  }

  async function chooseOffOrBis(next: "off" | "bis") {
    setSaving(true);
    try {
      await applyReplies({ setReplies, toast, onApplied, onUndone }, { mode: next, domain: applied.domain });
    } finally {
      setSaving(false);
    }
  }

  function chooseOwnDomain() {
    // Reveals the field; writes nothing yet.
    setSelected("own_domain");
    setDnsResult(null);
  }

  async function runCheckDns() {
    setChecking(true);
    try {
      const result = await probeDns(checkDns, domainInput, toast);
      if (!result) return; // crashed; probeDns already toasted
      setDnsResult(result);
      if (!result.ok) return;
      setSaving(true);
      try {
        await applyReplies({ setReplies, toast, onApplied, onUndone }, { mode: "own_domain", domain: domainInput });
      } finally {
        setSaving(false);
      }
    } finally {
      setChecking(false);
    }
  }

  const busy = checking || saving;

  return (
    <div className="mt-4 border-t border-[var(--line)] pt-4">
      <Label>{m["settings.replies.label"]}</Label>
      <p data-replies-state={applied.mode} className="mt-2 flex items-center gap-2 text-sm">
        <span
          data-dot
          aria-hidden
          className={cn("size-2 rounded-full", applied.mode === "off" ? "bg-[var(--text-3)]" : "bg-[var(--good)]")}
        />
        <span className="font-medium text-card-foreground">{MODE_LABEL[applied.mode]}</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{repliesBody(applied)}</p>

      <fieldset role="radiogroup" className="mt-3 flex flex-wrap gap-3" disabled={busy}>
        {MODE_OPTIONS.map((value) => (
          <label key={value} className="flex min-h-11 items-center gap-1.5 text-sm md:min-h-8">
            <input
              type="radio"
              name="replies-mode"
              value={value}
              checked={selected === value}
              disabled={busy}
              onChange={() => {
                if (value === "own_domain") chooseOwnDomain();
                else void chooseOffOrBis(value);
              }}
            />
            {MODE_LABEL[value]}
          </label>
        ))}
      </fieldset>

      {selected === "own_domain" ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor="replies-domain">{m["settings.replies.domainLabel"]}</Label>
          <div className="flex gap-2">
            <Input
              id="replies-domain"
              value={domainInput}
              onChange={(e) => { setDomainInput(e.target.value); setDnsResult(null); }}
              placeholder={m["settings.replies.domainPlaceholder"]}
              className="font-mono"
            />
            {/* Ghost, never the card's one primary (DESIGN rule 8): Save
                above stays the only `default`-variant button on this card. */}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void runCheckDns()}>
              {m["settings.replies.checkDns"]}
            </Button>
          </div>
          {dnsResult ? (
            <p className="flex items-center gap-1.5 text-xs">
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dnsResult.ok ? "bg-[var(--good)]" : "bg-[var(--crit)]")} />
              <span className={dnsResult.ok ? "text-muted-foreground" : "text-[var(--crit)]"}>
                {dnsResult.ok ? m["settings.replies.dnsOk"] : dnsResult.error}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Agency-only by construction: this component is rendered from the Settings
 * page, which is gated by requireAgencyOnlyAccountAccess. It is deliberately
 * NOT part of BrandingPanel — that panel also renders on the client's own
 * /branding page, and a client must never see or set this (spec §4, §5).
 *
 * A client component for one reason: the preflight's failure message is the
 * most important string in this feature — Resend names the unverified domain
 * and says what to do about it, and preflight.ts deliberately does not wrap
 * it. A thrown server action reaches the operator as the dashboard's generic
 * error boundary, and in production Next redacts it to a digest, so the
 * message was unreachable on screen. Same shape as BrandingPanel: the action
 * returns a result and this renders it.
 */
export function SendingAddressCard({
  fromEmail, action, replies, setReplies, checkDns, neverLog,
}: {
  fromEmail: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The Replies row's current, SAVED settings (S-06 part 1, Task 10). */
  replies: { mode: InboundMode; domain: string | null };
  setReplies: (next: { mode: InboundMode; domain: string | null }) => Promise<InboundModeResult>;
  checkDns: (domain: string) => Promise<DnsCheckResult>;
  /** S-06 part 2: the Never record list, below the Replies row; outside the card's form. */
  neverLog?: ReactNode;
}) {
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: m["settings.sendingAddressSaved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    // Anchor for the palette's `settings:sending-address` entry; see
    // client-access-panel.tsx for why the id lives on the component root.
    <Card id="sending-address" className="scroll-mt-24">
      <CardHeader>
        {/* Deliberately NOT m["settings.sendingAddress"]. The title and the
            field's Label both used to render that string, so "Sending
            address" appeared on screen twice, stacked — the same duplication
            branding-panel.tsx was changed to avoid. The card takes the
            broader name; the field keeps the precise one, which is also the
            accessible label two e2e specs address it by. */}
        <CardTitle>{m["settings.sendingIdentity"]}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          {m["settings.sendingAddressBody"]}
        </p>
        <form
          // onSubmit, NOT the `action` prop — and this card is the sharpest
          // case of that defect in the app, because REFUSAL IS THE DESIGNED
          // PATH here: the whole reason this is a client component is to show
          // Resend's "domain not verified" message. React resets an
          // action-prop form when the action resolves to {ok:false}, so the
          // refused save silently reverted this field to the STORED address
          // while it still looked filled — and the operator's next save, after
          // verifying the domain, would write the old address back. On a
          // column that is deliberately ungranted to clients because a wrong
          // value means sending as another tenant. See
          // lib/forms/use-form-submit.ts.
          onSubmit={onSubmit}
          className="flex flex-col gap-3"
        >
          <Label htmlFor="fromEmail">{m["settings.sendingAddress"]}</Label>
          <Input
            id="fromEmail"
            name="fromEmail"
            type="email"
            defaultValue={fromEmail ?? ""}
            placeholder={m["settings.sendingAddressPlaceholder"]}
          />
          {!fromEmail && (
            <p className="text-xs text-muted-foreground">
              {m["settings.sendingAddressDefault"]}
            </p>
          )}
          <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
        </form>

        <RepliesRow replies={replies} setReplies={setReplies} checkDns={checkDns} />
        {neverLog ? <div className="mt-6 border-t border-[var(--line)] pt-4">{neverLog}</div> : null}
      </CardContent>
    </Card>
  );
}
