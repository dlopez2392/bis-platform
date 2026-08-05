"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { m } from "@/lib/messages";
import { NO_BLUEPRINT_SENTINEL } from "./constants";
import { SubmitButton } from "./submit-button";

export function CreateAccountDialog({
  action,
  blueprints,
}: {
  action: (formData: FormData) => Promise<void>;
  blueprints: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          {m["accounts.add"]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m["accounts.add"]}</DialogTitle>
        </DialogHeader>
        <form
          action={async (formData) => {
            try {
              await action(formData);
              setOpen(false);
            } catch (e) {
              // A successful create ends in redirect(), which Next.js
              // implements by throwing a special control-flow error.
              // Rethrow it so the navigation actually happens instead of
              // being swallowed here and misreported as a failed create.
              unstable_rethrow(e);
              toast.error(m["accounts.createFailed"]);
            }
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">{m["accounts.name"]}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">{m["accounts.timezone"]}</Label>
            <Input id="timezone" name="timezone" defaultValue="America/Chicago" />
          </div>
          {blueprints.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="acct-blueprint">{m["accounts.blueprint"]}</Label>
              <Select name="blueprintId" defaultValue={NO_BLUEPRINT_SENTINEL}>
                <SelectTrigger id="acct-blueprint" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BLUEPRINT_SENTINEL}>{m["accounts.blueprintNone"]}</SelectItem>
                  {blueprints.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{m["accounts.blueprintHint"]}</p>
            </div>
          ) : null}
          <DialogFooter>
            <SubmitButton>{m["common.add"]}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
