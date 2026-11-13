/**
 * pnpm --filter @bis/db migration:new <slug>
 *
 * Creates packages/db/supabase/migrations/<YYYYMMDDHHMMSS>_<slug>.sql, named
 * from the UTC clock (./names.ts), and prints its path. The only way a new
 * migration file should be made: numbered names stopped at 0116.
 */
import { fileURLToPath } from "node:url";
import { createMigrationFile } from "./create";

const DIR = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("usage: pnpm --filter @bis/db migration:new <slug>   (lower-case letters, digits, underscores)");
  process.exit(2);
}
try {
  console.log(createMigrationFile(DIR, args[0]!, new Date()));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
