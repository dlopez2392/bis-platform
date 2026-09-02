"use client";

import { useState } from "react";
import { Trash2, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { m } from "@/lib/messages";
import { bulkAddTagAction, bulkRemoveTagAction, bulkDeleteContactsAction } from "./actions";

export function BulkActionBar({
  accountId, selectedIds, existingTags, onDone,
}: {
  accountId: string;
  selectedIds: string[];
  existingTags: { id: string; name: string }[];
  onDone: () => void; // clear selection in the table
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const count = selectedIds.length;
  if (count === 0) return null;

  async function applyTag(name: string) {
    const ids = [...selectedIds];
    const r = await bulkAddTagAction(accountId, ids, name).catch(
      () => ({ ok: false as const, error: m["inline.crashed"] }));
    if (!r.ok) { toast.error(r.error); return; }
    onDone();
    toast.success(
      m["bulk.tagged"].replace("{count}", String(r.applied)).replace("{tag}", name),
      {
        action: {
          label: m["common.undo"],
          onClick: () => void bulkRemoveTagAction(accountId, ids, r.tagId)
            .then((u) => { if (!u.ok) toast.error(u.error); })
            .catch(() => toast.error(m["inline.crashed"])),
        },
      },
    );
  }

  async function doDelete() {
    const ids = [...selectedIds];
    setConfirmOpen(false);
    setTyped("");
    const r = await bulkDeleteContactsAction(accountId, ids).catch(
      () => ({ ok: false as const, error: m["inline.crashed"] }));
    if (!r.ok) { toast.error(r.error); return; }
    onDone();
    toast.success(
      r.skippedBlocked === 0
        ? m["bulk.deleted"].replace("{count}", String(r.deleted))
        : m["bulk.deletedSkipped"]
            .replace("{count}", String(r.deleted))
            .replace("{skipped}", String(r.skippedBlocked)),
    );
  }

  return (
    <div
      role="toolbar"
      aria-label={m["bulk.selected"].replace("{count}", String(count))}
      className="border-border bg-card mb-3 flex items-center gap-3 rounded-lg border px-4 py-2"
      data-testid="bulk-action-bar"
    >
      <span className="text-sm font-medium">
        {m["bulk.selected"].replace("{count}", String(count))}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Tag className="size-3.5" aria-hidden />
            {m["bulk.addTag"]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {existingTags.length > 0 && (
            <>
              {existingTags.map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => void applyTag(t.name)}>
                  {t.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <form
            className="flex items-center gap-1 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (tagDraft.trim()) { void applyTag(tagDraft.trim()); setTagDraft(""); }
            }}
          >
            <Input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder={m["contact.addTag"]}
              className="h-7 w-36 text-xs"
            />
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
        <Trash2 className="size-3.5" aria-hidden />
        {m["bulk.delete"]}
      </Button>

      <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={onDone}
        aria-label={m["bulk.clear"]}>
        <X className="size-3.5" aria-hidden />
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m["bulk.confirmTitle"].replace("{count}", String(count))}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {m["bulk.confirmBody"].replace("{count}", String(count))}
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={String(count)}
            aria-label={m["bulk.confirmTitle"].replace("{count}", String(count))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); setTyped(""); }}>
              {m["common.cancel"]}
            </Button>
            <Button
              variant="destructive"
              disabled={typed.trim() !== String(count)}
              onClick={() => void doDelete()}
            >
              {m["bulk.delete"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
