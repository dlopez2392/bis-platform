import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

/**
 * Agency-only by construction: this component is rendered from the Settings
 * page, which is gated by requireAgencyOnlyAccountAccess. It is deliberately
 * NOT part of BrandingPanel — that panel also renders on the client's own
 * /branding page, and a client must never see or set this (spec §4, §5).
 */
export function SendingAddressCard({
  fromEmail, action,
}: {
  fromEmail: string | null;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["settings.sendingAddress"]}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          {m["settings.sendingAddressBody"]}
        </p>
        <form action={action} className="flex flex-col gap-3">
          <Label htmlFor="fromEmail">{m["settings.sendingAddress"]}</Label>
          <Input
            id="fromEmail"
            name="fromEmail"
            type="email"
            defaultValue={fromEmail ?? ""}
            placeholder={m["settings.sendingAddressPlaceholder"]}
          />
          {!fromEmail && (
            <p className="text-xs text-muted-foreground">
              {m["settings.sendingAddressDefault"]}
            </p>
          )}
          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
