import type { ExpiredReason, Proposal, ProposalKind } from "@bis/db/proposal-rules";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";

/** The request client every kind reads and writes with (RLS applies: the decider's own access). */
export type Db = Parameters<typeof import("@bis/db").addTask>[0];

export type DescribeCtx = {
  tr: Tr; zone: string;
  /** Stage names and positions by id, as the screen resolved them; a missing id reads as unresolved. */
  stages: Readonly<Record<string, { name: string; position: number }>>;
  now: Date;
};
/** One run of the suggestion's sentence. `lang` only on the model's own words (P18): "en". */
export type Part = { text: string; lang?: "en" };
export type Description = { parts: Part[]; detail: string | null; pastDue: boolean };
/** What the edit form posted; each kind reads only its own `editable` fields from it. */
export type EditInput = Record<string, unknown>;
export type EditCtx = {
  zone: string; now: Date;
  stages: ReadonlyArray<{ id: string; position: number; pipelineId: string }>;
  pipelineIdOfDeal: string | null;
};
export type EditError = { field: string; key: MessageKey };
export type StillHolds = { ok: true } | { ok: false; reason: ExpiredReason };
export type ApplyCtx = { db: Db; accountId: string; userId: string; contactId: string | null };
/** `ref` is stored as `applied_ref`; `noWrite` is a known no-op the decision reverts and explains. */
export type Applied = { ref: Record<string, unknown>; noWrite?: "field_filled" | "name_mismatch"; flagged?: boolean };
/** `undo` acts only while the record is as the Accept left it (`ref`), else answers "changed" and writes
 *  nothing; a ref it cannot read (null: a copied row, an old-code Accept) is "changed" too. */
export type Inverse =
  | { undo: (ctx: ApplyCtx, ref: unknown) => Promise<"undone" | "changed"> }
  | { irreversible: MessageKey };

export type KindDef<K extends ProposalKind, P> = {
  kind: K;
  sources: readonly ["call"];
  needsContact: boolean;
  dataClass: "facts";
  parse(v: unknown): P | null;
  describe(p: P, ctx: DescribeCtx): Description;
  /** task: title, dueAt; contact_field: value; opportunity_stage: toStageId. */
  editable: readonly string[];
  validateEdit(stored: P, input: EditInput, ctx: EditCtx): { ok: true; payload: P } | { ok: false; error: EditError };
  normalise(p: P): P;
  stillHolds(db: Db, row: Proposal & { kind: K }): Promise<StillHolds>;
  apply(ctx: ApplyCtx, p: P): Promise<Applied>;
  inverse: Inverse;
  toast(p: P, tr: Tr, stages: DescribeCtx["stages"]): string;
  /** contact:<id>:<field>, deal:<id>; a to-do: null. */
  targetKey(p: P, contactId: string | null): string | null;
};
