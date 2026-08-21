"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

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
  fromEmail, action,
}: {
  fromEmail: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  return (
    <Card>
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
          action={async (formData) => {
            const result = await action(formData);
            if (result.ok) toast.success(m["settings.sendingAddressSaved"]);
            else toast.error(result.error);
          }}
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
          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
