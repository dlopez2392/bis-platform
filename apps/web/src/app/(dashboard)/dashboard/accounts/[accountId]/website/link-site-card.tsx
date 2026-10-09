"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SubmitButton } from "../../submit-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";

export type VercelProjectOption = { id: string; name: string; domain: string | null };

/**
 * The typed-name confirm's own predicate (D-057, review round): trimmed AND
 * case-insensitive, because DESIGN.md rule 6 asks a person to TYPE the
 * name, not reproduce its exact byte casing — a domain has no case anyway.
 * Exported and pure so it carries its own unit test, same reason color.ts
 * stays separate from the action that calls it: a source pin on the JSX
 * that calls this could never prove the PREDICATE itself still works if
 * its own logic regressed.
 */
export function confirmsUnlink(typed: string, domain: string): boolean {
  return typed.trim().toLowerCase() === domain.toLowerCase();
}

export function LinkSiteCard({
  projects, projectsUnavailable, linked, daysStored, saveAction, testAction, unlinkAction,
}: {
  projects: VercelProjectOption[];
  projectsUnavailable: boolean;
  linked: { vercelProjectId: string; domain: string } | null;
  /** Days of traffic stored for the linked site — what an unlink removes. */
  daysStored: number;
  saveAction: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  testAction: (formData: FormData) => Promise<{ ok: true; visitors: number; pageviews: number } | { ok: false; error: string }>;
  unlinkAction: () => Promise<{ ok: true; daysDeleted: number } | { ok: false; error: string }>;
}) {
  const [projectId, setProjectId] = useState(linked?.vercelProjectId ?? "");
  const [domain, setDomain] = useState(linked?.domain ?? "");
  const [testing, setTesting] = useState(false);
  // A Dialog, not window.confirm: blocking dialogs are banned here (see
  // setup-move-number-button.tsx), and the bulk-delete bar is the precedent.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  // D-057: unlinking a site deletes its stored traffic history, so DESIGN.md
  // rule 6 wants a TYPED name, not a reflexive "Are you sure?" — the same
  // shape as contacts' bulk-action-bar.tsx typing the selection count. Reset
  // on every open/close/success so a stale value can never cross accounts
  // (this panel's own account-keying lesson, right above in `unlink`'s own
  // comment) or outlive the dialog that asked for it.
  const [confirmText, setConfirmText] = useState("");

  function closeConfirm(open: boolean) {
    if (unlinking) return;
    setConfirmOpen(open);
    setConfirmText("");
  }

  async function unlink() {
    setUnlinking(true);
    try {
      const r = await unlinkAction();
      if (r.ok) {
        toast.success(m["website.link.unlinked"]);
        // The server re-renders `linked` as null; the inputs are local state
        // keyed on the account, so they would otherwise keep the old values.
        setProjectId(""); setDomain(""); setConfirmOpen(false); setConfirmText("");
      } else {
        toast.error(r.error);
      }
    } catch {
      // try/FINALLY alone lets a stale-deployment or network rejection skip
      // the toast and leave the dialog armed over an unknown outcome (the
      // setup-move-number-button lesson). Say so and collapse the confirm.
      toast.error(m["common.actionCrashed"]);
      setConfirmOpen(false); setConfirmText("");
    } finally { setUnlinking(false); }
  }

  // onSubmit + useTransition, NOT the `action` prop: React resets an
  // action-prop form even when the action FAILED, and Radix Select drives
  // state backwards on that reset (the recorded lesson).
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    const r = await saveAction(formData);
    if (r.ok) toast.success(m["website.link.saved"]); else toast.error(r.error);
  });

  async function test() {
    setTesting(true);
    try {
      const f = new FormData(); f.set("vercelProjectId", projectId);
      const r = await testAction(f);
      if (r.ok) toast.success(m["website.link.testOk"].replace("{visitors}", String(r.visitors)).replace("{pageviews}", String(r.pageviews)));
      else toast.error(r.error);
    } finally { setTesting(false); }
  }

  return (
    <Card id="website" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["website.link.title"]}</CardTitle>
        <CardDescription>{linked ? m["website.link.linked"].replace("{domain}", linked.domain) : m["website.link.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        {projectsUnavailable ? <p className="mb-4 text-sm text-muted-foreground">{m["website.link.noToken"]}</p> : null}
        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" name="vercelProjectId" value={projectId} />
          <div className="space-y-1.5">
            <Label htmlFor="site-project">{m["website.link.project"]}</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); const p = projects.find((x) => x.id === v); if (p?.domain && !domain) setDomain(p.domain); }}>
              <SelectTrigger id="site-project"><SelectValue /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.domain ? ` — ${p.domain}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-domain">{m["website.link.domain"]}</Label>
            <Input id="site-domain" name="domain" value={domain} onChange={(e) => setDomain(e.target.value)} required />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
            {/* Ghost, not outline (D-056): Save is this card's one primary
                (DESIGN.md rule 8), so everything else here is ghost — and its
                own "Testing…" word, not Save's borrowed "Saving…", since
                nothing here is saving anything. */}
            <Button type="button" variant="ghost" disabled={!projectId || testing} onClick={test}>{testing ? m["website.link.testing"] : m["website.link.test"]}</Button>
            {linked ? (
              <Button type="button" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => setConfirmOpen(true)}>
                {m["website.link.unlink"]}
              </Button>
            ) : null}
          </div>
        </form>
        {linked ? (
          <Dialog open={confirmOpen} onOpenChange={closeConfirm}>
            <DialogContent showCloseButton={!unlinking}>
              <DialogHeader>
                <DialogTitle>{m["website.link.unlinkTitle"].replace("{domain}", linked.domain)}</DialogTitle>
                <DialogDescription>
                  {daysStored > 1
                    ? m["website.link.unlinkBody"].replace("{days}", String(daysStored)).replace("{domain}", linked.domain)
                    : daysStored === 1
                      ? m["website.link.unlinkBodyOne"].replace("{domain}", linked.domain)
                      : m["website.link.unlinkBodyNone"].replace("{domain}", linked.domain)}
                </DialogDescription>
              </DialogHeader>
              {/* Typed-name confirm (D-057, DESIGN.md rule 6): unlinking
                  deletes stored history, so a reflexive "Are you sure?" is
                  banned. Same shape as contacts/bulk-action-bar.tsx typing
                  the selection count. */}
              <div className="space-y-1.5">
                <Label htmlFor="unlink-confirm">
                  {m["website.link.unlinkType"].replace("{domain}", linked.domain)}
                </Label>
                <Input
                  id="unlink-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={linked.domain}
                  autoComplete="off"
                  disabled={unlinking}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => closeConfirm(false)} disabled={unlinking}>{m["common.cancel"]}</Button>
                <Button variant="destructive" onClick={() => void unlink()} disabled={unlinking || !confirmsUnlink(confirmText, linked.domain)}>
                  {unlinking ? m["website.link.unlinking"] : m["website.link.unlinkConfirm"]}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </CardContent>
    </Card>
  );
}
