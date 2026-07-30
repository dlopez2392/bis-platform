"use client";

import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BoardOpportunity } from "./pipeline-board";
import { m } from "@/lib/messages";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

export function OpportunityDrawer({
  opportunity,
  onClose,
  action,
}: {
  opportunity: BoardOpportunity | null;
  onClose: () => void;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <Sheet open={opportunity !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex flex-col gap-6">
        <SheetHeader>
          <SheetTitle>{opportunity?.name ?? ""}</SheetTitle>
        </SheetHeader>
        {opportunity ? (
          <form
            action={async (formData) => {
              try {
                await action(formData);
                onClose();
              } catch {
                toast.error(m["pipeline.updateFailed"]);
              }
            }}
            className="flex flex-1 flex-col gap-4"
          >
            <input type="hidden" name="oppId" value={opportunity.id} />
            <div className="space-y-2">
              <Label htmlFor="name">{m["pipeline.name"]}</Label>
              <Input id="name" name="name" defaultValue={opportunity.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">{m["pipeline.value"]}</Label>
              <Input
                id="value"
                name="value"
                type="number"
                step="0.01"
                defaultValue={opportunity.monetary_value}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">{m["pipeline.status"]}</Label>
              <Select name="status" defaultValue={opportunity.status}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{m["pipeline.status.open"]}</SelectItem>
                  <SelectItem value="won">{m["pipeline.status.won"]}</SelectItem>
                  <SelectItem value="lost">{m["pipeline.status.lost"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SheetFooter className="mt-auto">
              <Submit />
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
