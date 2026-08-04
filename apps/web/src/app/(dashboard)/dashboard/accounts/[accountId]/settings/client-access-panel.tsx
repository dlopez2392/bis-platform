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
  setAccessAction,
  inviteAction,
}: {
  enabled: boolean;
  members: ClientAccessMember[];
  setAccessAction: (formData: FormData) => Promise<void>;
  inviteAction: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [email, setEmail] = useState("");

  return (
    <Card>
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
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m["common.none"]}</p>
          ) : (
            <ul className="space-y-2">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border p-3 text-sm"
                >
                  <span className="font-medium text-card-foreground">{member.email}</span>
                  <Badge variant="secondary" className="font-normal">{member.role}</Badge>
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
