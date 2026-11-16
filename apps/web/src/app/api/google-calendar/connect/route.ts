import type { NextRequest } from "next/server";
import { handleGoogleConnect, liveGoogleDeps } from "@/lib/google/oauth-routes";

/** S-22 slice 1: start a Google Calendar connect. 404 while the feature is unconfigured (lib/google/oauth-routes.ts). */
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleGoogleConnect(req, liveGoogleDeps());
}
