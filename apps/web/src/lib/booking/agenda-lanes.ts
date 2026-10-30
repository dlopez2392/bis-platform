/** F-046 (spec 5.2, R1): live rows whose ranges overlap ([) bounds, as bookings_no_overlap) form one item:
 *  two lanes side by side when two lanes hold them, else a stack. Cancelled rows never join a lane. */
export type LaneInput = { id: string; startsAt: Date; endsAt: Date; live: boolean };
export type LaneItem = { kind: "single"; id: string } | { kind: "side"; lanes: [string[], string[]] } | { kind: "stack"; ids: string[] };

export function agendaLanes(rows: readonly LaneInput[]): { items: LaneItem[]; overlapping: ReadonlySet<string> } {
  const live = rows.filter((r) => r.live).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const clusters: LaneInput[][] = [];
  let reach = -Infinity;                       // the latest end in the CURRENT cluster
  for (const r of live) {
    const current = clusters[clusters.length - 1];
    if (current && r.startsAt.getTime() < reach) {
      current.push(r);
      reach = Math.max(reach, r.endsAt.getTime());
    } else {
      clusters.push([r]);
      reach = r.endsAt.getTime();
    }
  }
  const overlapping = new Set<string>();
  const items: LaneItem[] = clusters.map((c) => {
    if (c.length === 1) return { kind: "single", id: c[0]!.id };
    c.forEach((r) => overlapping.add(r.id));
    const lanes: [LaneInput[], LaneInput[]] = [[], []];
    for (const r of c) {
      const lane = lanes.find((l) => l.length === 0 || l[l.length - 1]!.endsAt.getTime() <= r.startsAt.getTime());
      if (!lane) return { kind: "stack", ids: c.map((x) => x.id) };
      lane.push(r);
    }
    return { kind: "side", lanes: [lanes[0].map((x) => x.id), lanes[1].map((x) => x.id)] };
  });
  return { items, overlapping };
}
