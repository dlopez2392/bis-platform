export type SubmitResult =
  | { status: "idle" }
  | { status: "success"; message: string; redirectUrl?: string }
  // `formError` is optional and separate from `fieldErrors`: it is for a
  // rejection that is not about any single field (e.g. an expired render
  // token), so there is no field key to attach it to.
  | { status: "invalid"; fieldErrors: Record<string, string>; formError?: string }
  | { status: "error" };

export const IDLE: SubmitResult = { status: "idle" };
