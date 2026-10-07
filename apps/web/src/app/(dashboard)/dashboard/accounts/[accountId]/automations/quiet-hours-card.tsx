import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/lib/messages";

/**
 * The sending hours, READ-ONLY (consent chain spec §6, decision 4): they are
 * fixed by law and by danlo's decision, not a setting, so there is no form,
 * no switch and no Save. The sentence names the account's own zone, the one
 * the hours are read in for every customer (BIS stores no per-contact zone
 * yet). A server component: nothing here is interactive.
 */
export function QuietHoursCard({ zoneLabel }: { zoneLabel: string }) {
  return (
    <Card id="quiet-hours" data-testid="quiet-hours-card" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["automations.quiet.title"]}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-card-foreground" data-testid="quiet-hours-fixed">
          {m["automations.quiet.fixed"].replace("{zone}", zoneLabel)}
        </p>
      </CardContent>
    </Card>
  );
}
