import { serviceDb, ensureDefaultPipeline, listBoard, listContacts } from "@bis/db";
import { SubmitButton } from "../../submit-button";
import { createOpportunityAction, moveOppAction, setOppStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceDb();
  const { pipelineId } = await ensureDefaultPipeline(db, accountId);
  const [board, contacts] = await Promise.all([
    listBoard(db, accountId, pipelineId),
    listContacts(db, accountId, { limit: 200 }),
  ]);
  return (
    <div className="space-y-6">
      <form action={createOpportunityAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="pipelineId" value={pipelineId} />
        <select name="contactId" required className="rounded border px-3 py-2">
          <option value="">Contact…</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <input name="name" placeholder="Opportunity name" required className="rounded border px-3 py-2" />
        <input name="value" type="number" step="0.01" placeholder="$ value" className="w-32 rounded border px-3 py-2" />
        <SubmitButton>Add opportunity</SubmitButton>
      </form>
      <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
        {board.map((col) => (
          <div key={col.stage.id} className="min-w-52 rounded border p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-sm font-semibold">{col.stage.name}</h4>
              <span className="text-xs text-gray-500">${col.totalValue.toLocaleString()}</span>
            </div>
            <div className="space-y-2">
              {col.opportunities.map((o) => (
                <div key={o.id} className="rounded border p-2 text-sm">
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-gray-500">
                    {[o.contact.first_name, o.contact.last_name].filter(Boolean).join(" ")}
                    {" · $"}{o.monetary_value.toLocaleString()}
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <form action={moveOppAction}>
                      <input type="hidden" name="accountId" value={accountId} />
                      <input type="hidden" name="oppId" value={o.id} />
                      <input type="hidden" name="direction" value="left" />
                      <button className="rounded border px-2 text-xs" title="Move left">◀</button>
                    </form>
                    <form action={moveOppAction}>
                      <input type="hidden" name="accountId" value={accountId} />
                      <input type="hidden" name="oppId" value={o.id} />
                      <input type="hidden" name="direction" value="right" />
                      <button className="rounded border px-2 text-xs" title="Move right">▶</button>
                    </form>
                    <form action={setOppStatusAction} className="ml-auto">
                      <input type="hidden" name="accountId" value={accountId} />
                      <input type="hidden" name="oppId" value={o.id} />
                      <select name="status" defaultValue={o.status}
                        className="rounded border px-1 text-xs">
                        <option value="open">open</option>
                        <option value="won">won</option>
                        <option value="lost">lost</option>
                      </select>
                      <button className="ml-1 rounded border px-2 text-xs">set</button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
