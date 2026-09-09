"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

export type ClientAccessMember = { id: string; email: string; role: string };

function InviteButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? m["common.saving"] : m["clientAccess.invite"]}
    </Button>
  );
}

export function ClientAccessPanel({
  enabled,
  members,
  pendingInvites = [],
  membersUnavailable = false,
  setAccessAction,
  inviteAction,
}: {
  enabled: boolean;
  members: ClientAccessMember[];
  /** Invited but not yet accepted. Listed alongside members because the
   *  success toast is transient — without these, an agency that invited
   *  someone sees no trace of it after a reload. */
  pendingInvites?: ClientAccessMember[];
  membersUnavailable?: boolean;
  setAccessAction: (formData: FormData) => Promise<void>;
  inviteAction: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [email, setEmail] = useState("");

  return (
    // The palette's `settings:client-access` entry jumps here. scroll-mt-24
    // keeps the anchored section clear of the sticky topbar instead of
    // landing underneath it. The id lives on the component's own root so it
    // travels with the component rather than depending on its call site.
    <Card id="client-access" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["clientAccess.title"]}</CardTitle>
        <CardDescription>{m["clientAccess.body"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={setAccessAction}>
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <SubmitButton>{enabled ? m["clientAccess.disable"] : m["clientAccess.enable"]}</SubmitButton>
        </form>

        <div className="space-y-2">
          <p className="text-sm font-medium text-card-foreground">{m["clientAccess.members"]}</p>
          {membersUnavailable ? (
            <p className="text-sm text-destructive">{m["clientAccess.membersUnavailable"]}</p>
          ) : members.length === 0 && pendingInvites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m["common.none"]}</p>
          ) : (
            <ul className="flex flex-col">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--row-line)] py-[7px] text-[13px] first:border-t-0"
                >
                  <span className="font-medium text-card-foreground">{member.email}</span>
                  <Badge variant="secondary" className="font-normal">{member.role}</Badge>
                </li>
              ))}
              {pendingInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-[var(--line-strong)] py-[7px] text-[13px] first:border-t-0"
                >
                  <span className="font-medium text-muted-foreground">{invite.email}</span>
                  <Badge variant="secondary" className="font-normal">{invite.role}</Badge>
                  <Badge variant="outline" className="font-normal">
                    {m["clientAccess.invitePending"]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          action={async (formData) => {
            const result = await inviteAction(formData);
            if (result.ok) {
              toast.success(m["clientAccess.inviteSent"]);
              setEmail("");
            } else {
              toast.error(result.error);
            }
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{m["clientAccess.inviteEmail"]}</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              disabled={!enabled}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {!enabled ? (
            <p className="text-xs text-muted-foreground">{m["clientAccess.disabledHint"]}</p>
          ) : null}
          <InviteButton disabled={!enabled} />
        </form>
      </CardContent>
    </Card>
  );
}
