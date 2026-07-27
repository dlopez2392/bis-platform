import { Plus, X } from "lucide-react";
import type { getContact, listContactTags, CustomFieldDef } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { m } from "@/lib/messages";
import { SubmitButton } from "../../../submit-button";
import { updateContactAction, addTagAction, removeTagAction } from "./actions";

type Contact = NonNullable<Awaited<ReturnType<typeof getContact>>>;
type Tag = Awaited<ReturnType<typeof listContactTags>>[number];

export function ContactFieldsPanel({
  accountId,
  contactId,
  contact,
  tags,
  fieldDefs,
}: {
  accountId: string;
  contactId: string;
  contact: Contact;
  tags: Tag[];
  fieldDefs: CustomFieldDef[];
}) {
  const custom = (contact.custom ?? {}) as Record<string, unknown>;
  const hidden = (
    <>
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="contactId" value={contactId} />
    </>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{m["contact.details"]}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateContactAction} className="space-y-3">
            {hidden}
            <div className="space-y-1.5">
              <Label htmlFor="firstName">{m["contacts.firstName"]}</Label>
              <Input id="firstName" name="firstName" defaultValue={contact.first_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">{m["contacts.lastName"]}</Label>
              <Input id="lastName" name="lastName" defaultValue={contact.last_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{m["contacts.email"]}</Label>
              <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">{m["contacts.phone"]}</Label>
              <Input id="phone" name="phone" defaultValue={contact.phone ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyName">{m["contact.company"]}</Label>
              <Input id="companyName" name="companyName" defaultValue={contact.company_name ?? ""} />
            </div>

            {fieldDefs.length > 0 ? (
              <>
                <Separator />
                {fieldDefs.map((d) => {
                  const fieldName = `cf_${d.field_key}`;
                  const current = custom[d.field_key];
                  return (
                    <div key={d.id} className="space-y-1.5">
                      {d.data_type === "checkbox" ? (
                        <div className="flex items-center gap-2 pt-1">
                          <Checkbox id={fieldName} name={fieldName} defaultChecked={current === true} />
                          <Label htmlFor={fieldName} className="font-normal">
                            {d.name}
                          </Label>
                        </div>
                      ) : d.data_type === "single_select" ? (
                        <>
                          <Label htmlFor={fieldName}>{d.name}</Label>
                          <Select name={fieldName} defaultValue={String(current ?? "")}>
                            <SelectTrigger id={fieldName} className="w-full">
                              <SelectValue placeholder={m["common.none"]} />
                            </SelectTrigger>
                            <SelectContent>
                              {d.options.map((o) => (
                                <SelectItem key={o} value={o}>
                                  {o}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      ) : (
                        <>
                          <Label htmlFor={fieldName}>{d.name}</Label>
                          <Input
                            id={fieldName}
                            name={fieldName}
                            type={
                              d.data_type === "number" ? "number" : d.data_type === "date" ? "date" : "text"
                            }
                            defaultValue={String(current ?? "")}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            ) : null}

            <SubmitButton>{m["common.save"]}</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{m["contact.tags"]}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((t) => (
              <form key={t.id} action={removeTagAction} className="inline-flex">
                {hidden}
                <input type="hidden" name="tagId" value={t.id} />
                <button type="submit" className="group" title={t.name} aria-label={`Remove ${t.name}`}>
                  <Badge variant="secondary" className="gap-1 pr-1.5">
                    {t.name}
                    <X className="size-3 text-muted-foreground group-hover:text-foreground" aria-hidden />
                  </Badge>
                </button>
              </form>
            ))}
            <form action={addTagAction} className="inline-flex items-center gap-1">
              {hidden}
              <Input name="tag" placeholder={m["contact.addTag"]} className="h-7 w-28 text-xs" />
              <Button type="submit" size="icon-xs" variant="outline" aria-label={m["contact.addTag"]}>
                <Plus className="size-3" aria-hidden />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
