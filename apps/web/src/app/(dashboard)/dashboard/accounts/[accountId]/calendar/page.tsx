import { Calendar } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { m } from "@/lib/messages";

export default function CalendarPage() {
  return (
    <>
      <PageHeader title={m["nav.calendar"]} />
      <div className="p-6">
        <EmptyState
          icon={Calendar}
          title={m["empty.calendar.title"]}
          body={m["empty.calendar.body"]}
        />
      </div>
    </>
  );
}
