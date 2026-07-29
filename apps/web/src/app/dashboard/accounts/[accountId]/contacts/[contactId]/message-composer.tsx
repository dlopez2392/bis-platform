"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

type Mode = "note" | "email";

export function MessageComposer({
  contactId,
  contactHasEmail,
  noteAction,
  emailAction,
}: {
  contactId: string;
  contactHasEmail: boolean;
  noteAction: (formData: FormData) => Promise<void>;
  emailAction: (formData: FormData) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("note");
  const isEmail = mode === "email";

  return (
    <div className="w-full space-y-2">
      <div className="flex gap-1">
        {(["note", "email"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              mode === value
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "note" ? m["compose.note"] : m["compose.email"]}
          </button>
        ))}
      </div>

      {isEmail && !contactHasEmail ? (
        <p className="text-xs text-muted-foreground">{m["compose.noEmailOnContact"]}</p>
      ) : (
        <form
          key={mode}
          action={async (formData) => {
            try {
              await (isEmail ? emailAction : noteAction)(formData);
            } catch {
              toast.error(isEmail ? m["compose.sendFailed"] : m["contact.addNote"]);
            }
          }}
          className="space-y-2"
        >
          <input type="hidden" name="contactId" value={contactId} />
          {isEmail ? (
            <Input name="subject" placeholder={m["compose.subject"]} className="text-sm" />
          ) : null}
          <div className="flex gap-2">
            <Input
              name="body"
              placeholder={isEmail ? m["compose.emailPlaceholder"] : m["contact.addNote"]}
              className="flex-1"
              required
            />
            <Button type="submit" variant={isEmail ? "default" : "outline"}>
              {isEmail ? m["compose.send"] : m["common.add"]}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
