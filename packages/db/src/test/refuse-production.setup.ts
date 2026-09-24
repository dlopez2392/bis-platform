import "dotenv/config";
import { refuseProduction } from "./refuse-production";

/**
 * globalSetup for `test:integration` (vitest.integration.config.ts). The
 * integration tests load packages/db/.env themselves (`import "dotenv/config"`)
 * and write through it; this loads the same file first and refuses before a
 * single one is collected if it names production. Guard only: no sweep, which
 * stays the db suite's (./global-setup.ts). See ./refuse-production.ts.
 */
export default function setup(): void {
  refuseProduction(process.env, "The integration suite");
}
