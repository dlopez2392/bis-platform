import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The "Call in to your business" card's error state (DESIGN rule 5 extended to the card; design review Critical 1):
 * one business's failed read costs only that business's card, never the page. With no `accountId` it stands in for
 * the whole list, when the person's memberships could not be read at all. No action here: reloading the page is
 * the retry, and the copy says so.
 */
export function OwnerLineCardError(props: { accountId?: string; businessName?: string; locale: Locale; pseudo: boolean }) {
  const tr = makeTr(props.locale, props.pseudo);
  return (
    <Card lang={props.locale} data-owner-line-card-error={props.accountId ?? ""}>
      <CardHeader>
        <CardTitle>{tr.text("ownerLine.card.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="status" className="text-sm text-[var(--text-2)]">
          {props.businessName
            ? tr.text("ownerLine.card.loadError", { business: props.businessName })
            : tr.text("ownerLine.card.loadErrorAll")}
        </p>
      </CardContent>
    </Card>
  );
}
