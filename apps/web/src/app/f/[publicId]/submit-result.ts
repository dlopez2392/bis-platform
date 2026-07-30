export type SubmitResult =
  | { status: "idle" }
  | { status: "success"; message: string; redirectUrl?: string }
  | { status: "invalid"; fieldErrors: Record<string, string> }
  | { status: "error" };

export const IDLE: SubmitResult = { status: "idle" };
