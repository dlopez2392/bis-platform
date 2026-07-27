import { Badge } from "@/components/ui/badge";

export function TagChips({
  tags,
  max = 2,
}: {
  tags: { id: string; name: string }[];
  max?: number;
}) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <Badge key={t.id} variant="secondary" className="font-normal">
          {t.name}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="outline" className="font-normal">
          +{rest}
        </Badge>
      ) : null}
    </div>
  );
}
