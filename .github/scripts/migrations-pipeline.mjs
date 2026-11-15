// The migration pipeline's files: ONE list for the two scripts that need it
// (docs/superpowers/plans/2026-11-13-migration-pipeline.md, D2 and PR 6;
// review of #372, 2026-11-15). No side effects: both import it.
//
//   migrations-plan.mjs refuses a branch that adds a migration AND changes a
//   path isPipeline() matches (owner decision Q6, 2026-11-13).
//   migrations-prod-evidence.mjs skips production's click only when every
//   entry of EVIDENCE_TREES is identical (same git object id, or absent on
//   both sides) between production's last successful commit and HEAD.
//
// Each entry is a TREE (a directory or one file) with an optional pattern for
// the paths under it that count. Evidence compares the WHOLE tree, a superset
// of what the plan counts under it, so by construction nothing that decides
// how production is checked (parity's rules, the bootstrap, the stacks'
// config, @bis/db's migration code, the workflows and scripts) can change
// between production's run and HEAD unseen.

export const MIGRATIONS_DIR = "packages/db/supabase/migrations";

const PIPELINE = [
  { tree: ".github", under: /^(workflows\/|scripts\/(ci-|migrations-))/ },
  { tree: "packages/db/supabase/parity" },
  { tree: "packages/db/supabase/bootstrap" },
  // [db.migrations] enabled and major_version decide whether and how the CI
  // stacks apply migrations. (Not packages/db/package.json: a dependency bump
  // in a schema PR is ordinary.)
  { tree: "packages/db/supabase/config.toml" },
  { tree: "packages/db/src/migrations" },
  { tree: "packages/db/src/ci" },
];

/** Is this repository path part of the migration pipeline? */
export function isPipeline(path) {
  return PIPELINE.some(({ tree, under }) =>
    path === tree ? !under : path.startsWith(`${tree}/`) && (!under || under.test(path.slice(tree.length + 1))));
}

/** What must be byte-identical for production's earlier run to stand for this commit. */
export const EVIDENCE_TREES = [MIGRATIONS_DIR, ...PIPELINE.map((entry) => entry.tree)];
