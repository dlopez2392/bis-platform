"use client";

import { useOptimistic, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency, contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";

export type BoardOpportunity = {
  id: string;
  name: string;
  monetary_value: number;
  status: string;
  contact: { id: string; first_name: string | null; last_name: string | null };
};

export type BoardColumn = {
  stage: { id: string; name: string; position: number };
  totalValue: number;
  opportunities: BoardOpportunity[];
};

const STAGE_BAR = [
  "bg-stage-1",
  "bg-stage-2",
  "bg-stage-3",
  "bg-stage-4",
  "bg-stage-5",
  "bg-stage-6",
];

export function PipelineBoard({
  board,
  accountId,
  moveAction,
  onOpen,
}: {
  board: BoardColumn[];
  accountId: string;
  moveAction: (formData: FormData) => Promise<void>;
  onOpen?: (opp: BoardOpportunity) => void;
}) {
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<BoardOpportunity | null>(null);

  const [optimistic, applyMove] = useOptimistic(
    board,
    (state: BoardColumn[], move: { oppId: string; toStageId: string }) => {
      let moved: BoardOpportunity | undefined;
      const stripped = state.map((col) => {
        const found = col.opportunities.find((o) => o.id === move.oppId);
        if (!found) return col;
        moved = found;
        const rest = col.opportunities.filter((o) => o.id !== move.oppId);
        return {
          ...col,
          opportunities: rest,
          totalValue: rest.reduce((s, o) => s + o.monetary_value, 0),
        };
      });
      if (!moved) return state;
      return stripped.map((col) => {
        if (col.stage.id !== move.toStageId) return col;
        const next = [moved!, ...col.opportunities];
        return {
          ...col,
          opportunities: next,
          totalValue: next.reduce((s, o) => s + o.monetary_value, 0),
        };
      });
    },
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const oppId = String(event.active.id);
    const toStageId = event.over ? String(event.over.id) : null;
    if (!toStageId) return;
    const from = optimistic.find((c) => c.opportunities.some((o) => o.id === oppId));
    if (!from || from.stage.id === toStageId) return;

    startTransition(async () => {
      applyMove({ oppId, toStageId });
      const formData = new FormData();
      formData.set("accountId", accountId);
      formData.set("oppId", oppId);
      formData.set("toStageId", toStageId);
      try {
        await moveAction(formData);
      } catch {
        toast.error(m["pipeline.moveFailed"]);
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        const id = String(e.active.id);
        const found = optimistic.flatMap((c) => c.opportunities).find((o) => o.id === id);
        setDragging(found ?? null);
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {optimistic.map((col, i) => (
          <Column key={col.stage.id} column={col} index={i} onOpen={onOpen} />
        ))}
      </div>
      <DragOverlay>
        {dragging ? <CardBody opp={dragging} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  index,
  onOpen,
}: {
  column: BoardColumn;
  index: number;
  onOpen?: (opp: BoardOpportunity) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className={cn("h-1", STAGE_BAR[index % STAGE_BAR.length])} aria-hidden />
        <div className="px-4 py-3">
          <p className="font-medium text-card-foreground">{column.stage.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {column.opportunities.length} · {formatCurrency(column.totalValue)}
          </p>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-32 flex-col gap-2 rounded-lg p-1 transition-colors",
          isOver && "bg-primary/5 ring-1 ring-primary/30",
        )}
      >
        {column.opportunities.map((opp) => (
          <DraggableCard key={opp.id} opp={opp} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({
  opp,
  onOpen,
}: {
  opp: BoardOpportunity;
  onOpen?: (opp: BoardOpportunity) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: opp.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen?.(opp)}
      className={cn("cursor-grab text-left", isDragging && "opacity-40")}
      data-testid={`opp-${opp.id}`}
    >
      <CardBody opp={opp} />
    </div>
  );
}

function CardBody({ opp, dragging }: { opp: BoardOpportunity; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        dragging && "shadow-lg ring-1 ring-primary/40",
      )}
    >
      <p className="truncate font-medium text-card-foreground">{opp.name}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {contactDisplayName(opp.contact)}
      </p>
      <p className="mt-2 text-sm font-medium text-foreground">
        {formatCurrency(opp.monetary_value)}
      </p>
    </div>
  );
}
