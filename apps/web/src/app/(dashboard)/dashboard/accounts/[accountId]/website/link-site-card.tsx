"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";

export type VercelProjectOption = { id: string; name: string; domain: string | null };

export function LinkSiteCard({
  projects, projectsUnavailable, linked, saveAction, testAction,
}: {
  projects: VercelProjectOption[];
  projectsUnavailable: boolean;
  linked: { vercelProjectId: string; domain: string } | null;
  saveAction: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  testAction: (formData: FormData) => Promise<{ ok: true; visitors: number; pageviews: number } | { ok: false; error: string }>;
}) {
  const [projectId, setProjectId] = useState(linked?.vercelProjectId ?? "");
  const [domain, setDomain] = useState(linked?.domain ?? "");
  const [testing, setTesting] = useState(false);

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
          <div className="flex gap-2">
            <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
            <Button type="button" variant="outline" disabled={!projectId || testing} onClick={test}>{testing ? m["common.saving"] : m["website.link.test"]}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
