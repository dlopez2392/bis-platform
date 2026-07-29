import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={SearchX}
        title={m["notFound.title"]}
        body={m["notFound.body"]}
        action={
          <Button variant="outline" asChild>
            <Link href="/dashboard">{m["notFound.back"]}</Link>
          </Button>
        }
      />
    </div>
  );
}
