import { describe, it, expect } from "vitest";
import { groupChanges, foldVia, COLLAPSE_MINUTES, type ChangeRow, type ChangeGroup } from "./record-changes";

/**
 * F-115 part 1 (S-04), Task 4: `groupChanges`/`foldVia` are pure (no Supabase variable; see
 * `listChangeRows`'s own impure tests via the RLS/schema suites that exercise it live).
 */
let nextId = 1;
function row(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id: nextId++, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
    op: "update", field: "phone", before: "a", after: "b", xact: "100",
    authorKind: "person", authorId: "user_1", via: null, createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function group(over: Partial<ChangeGroup> = {}): ChangeGroup {
  const r = row();
  return {
    key: "k1", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "user_1",
    via: null, at: r.createdAt, firstAt: r.createdAt, steps: [[r]], rows: [r], ...over,
  };
}

describe("groupChanges", () => {
  it("rows sharing one xact and record form one group; a different xact is a different group, even at the identical instant (mutation: group by createdAt -> FAILS on two writes in the same second)", () => {
    const sameWrite = [
      row({ id: 1, field: "phone", xact: "100", createdAt: "2026-01-01T00:00:00.500Z" }),
      row({ id: 2, field: "email", xact: "100", createdAt: "2026-01-01T00:00:00.500Z" }),
    ];
    const grouped = groupChanges(sameWrite);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.rows).toHaveLength(2);

    // Two DIFFERENT writes (different xact), the exact same instant, but different authors so the
    // separate collapse rule (tested below) cannot be the reason they stay apart: only the xact-based
    // write key can be. A buggy implementation keyed on createdAt alone would merge these into one.
    const twoWrites = [
      row({ id: 3, xact: "200", authorKind: "person", authorId: "user_1", createdAt: "2026-01-01T00:00:00.500Z" }),
      row({ id: 4, xact: "201", authorKind: "ai", authorId: null, createdAt: "2026-01-01T00:00:00.500Z" }),
    ];
    expect(groupChanges(twoWrites)).toHaveLength(2);
  });

  it("two writes by the same author on the same record collapse into one group within 10 minutes, and stay two past it (mutation: compare with <= 11 -> FAILS)", () => {
    const near = [
      row({ id: 1, xact: "1", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 2, xact: "2", createdAt: "2026-01-01T00:09:00.000Z" }), // 9 minutes later
    ];
    const nearGroups = groupChanges(near);
    expect(nearGroups).toHaveLength(1);
    expect(nearGroups[0]!.steps).toHaveLength(2);

    const far = [
      row({ id: 3, xact: "3", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 4, xact: "4", createdAt: "2026-01-01T00:11:00.000Z" }), // 11 minutes later
    ];
    expect(groupChanges(far)).toHaveLength(2);
  });

  it("COLLAPSE_MINUTES is 10", () => {
    expect(COLLAPSE_MINUTES).toBe(10);
  });

  it("a different author, or a different record, never collapses even seconds apart", () => {
    const differentAuthor = [
      row({ id: 1, xact: "1", authorKind: "person", authorId: "user_1", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 2, xact: "2", authorKind: "person", authorId: "user_2", createdAt: "2026-01-01T00:00:01.000Z" }),
    ];
    expect(groupChanges(differentAuthor)).toHaveLength(2);

    const differentRecord = [
      row({ id: 3, xact: "1", recordId: "c1", contactId: "c1", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 4, xact: "2", recordId: "c2", contactId: "c2", createdAt: "2026-01-01T00:00:01.000Z" }),
    ];
    expect(groupChanges(differentRecord)).toHaveLength(2);
  });

  it("a group with no author (observe mode) is kept, not dropped", () => {
    const rows = [row({ authorKind: null, authorId: null })];
    const groups = groupChanges(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.authorKind).toBeNull();
  });
});

describe("foldVia", () => {
  it("drops a merge/ai_act/proposal group only when its id is already on this page; keeps it when the referenced row is not on the page (mutation: drop the onPage check -> FAILS)", () => {
    const onPage = { mergeIds: new Set(["7"]), aiActIds: new Set(["a1"]), proposalIds: new Set(["p1"]) };
    const mergeOnPage = group({ key: "m", via: "merge:7" });
    const mergeNotOnPage = group({ key: "m2", via: "merge:9" });
    const aiActOnPage = group({ key: "a", via: "ai_act:a1" });
    const aiActNotOnPage = group({ key: "a2", via: "ai_act:a9" });
    const proposalOnPage = group({ key: "p", via: "proposal:p1" });
    const plain = group({ key: "x", via: null });

    const kept = foldVia([mergeOnPage, mergeNotOnPage, aiActOnPage, aiActNotOnPage, proposalOnPage, plain], onPage);
    expect(kept.map((g) => g.key)).toEqual(["m2", "a2", "x"]);
  });

  it("never folds a restore: group, even one a client could have forged, because there is no restoreIds set to prove it against (mutation: fold restore too -> FAILS)", () => {
    const onPage = { mergeIds: new Set<string>(), aiActIds: new Set<string>(), proposalIds: new Set<string>() };
    const forgedRestore = group({ key: "r", via: "restore:999" });
    expect(foldVia([forgedRestore], onPage).map((g) => g.key)).toEqual(["r"]);
  });

  it("keeps a group with no author (observe mode) through the fold", () => {
    const onPage = { mergeIds: new Set<string>(), aiActIds: new Set<string>(), proposalIds: new Set<string>() };
    const noAuthor = group({ key: "n", via: null, authorKind: null, authorId: null });
    expect(foldVia([noAuthor], onPage).map((g) => g.key)).toEqual(["n"]);
  });
});
