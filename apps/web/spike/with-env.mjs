// usage: node with-env.mjs <envfile> <cmd> [args...]  (loads the env file into the child's env; prints nothing from it)
import { spawn } from "node:child_process";
const [envFile, cmd, ...args] = process.argv.slice(2);
process.loadEnvFile(envFile);
for (const [k, v] of Object.entries(process.env)) {
  if (/^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_DB_URL|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)$/.test(k) && typeof v === "string" && v.includes("tlbkbmlrfafquucsmsmm")) {
    console.error(`REFUSED: ${k} names production`); process.exit(2);
  }
}
const child = spawn(cmd, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
