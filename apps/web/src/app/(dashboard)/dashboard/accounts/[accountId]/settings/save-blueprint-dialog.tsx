"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

export function SaveBlueprintDialog({
  action, existing,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Every blueprint's current name and version, agency-wide — used only to
   *  warn before a recapture overwrites one. Never affects which server
   *  action runs or which account it targets. */
  existing: { name: string; version: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Exact match against the trimmed input, same as captureBlueprint's own
  // `.eq("name", input.name)` lookup — this warning has to agree with the
  // backend about what counts as "the same blueprint" or it will warn (or
  // stay silent) on the wrong input.
  const collision = existing.find((b) => b.name === name.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setName(""); }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{m["blueprints.save"]}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{m["blueprints.save"]}</DialogTitle></DialogHeader>
        <form
          action={async (formData) => {
            try {
              await action(formData);
              toast.success(m["blueprints.saved"]);
              setOpen(false);
              setName("");
            } catch (e) {
              console.error("save-blueprint-dialog: save failed", e);
              toast.error(m["blueprints.saveFailed"]);
            }
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="bp-name">{m["blueprints.name"]}</Label>
            <Input
              id="bp-name" name="name" required autoFocus
              value={name} onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{m["blueprints.saveHint"]}</p>
            {collision ? (
              <p
                role="alert"
                className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning"
              >
                {m["blueprints.overwriteWarning"]
                  .replace("{name}", collision.name)
                  .replace("{version}", String(collision.version))}
              </p>
            ) : null}
          </div>
          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
