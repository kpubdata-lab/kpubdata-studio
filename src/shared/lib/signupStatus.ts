/**
 * Whether Builder's sign-up ledger is holding the signed-in user back (#658).
 *
 * Builder contract v1.54.0 (#785): an OIDC user on no `OIDC_ALLOWED_*` list signs up as
 * `pending`, and every authenticated request then answers 403 with `code:
 * signup_pending` until an administrator approves them; a rejected user gets 403
 * `signup_rejected` from then on. Each page would otherwise show its own generic
 * "could not load" for the same cause, so the request layer records the code here once
 * and the app shell shows one explanation instead of the pages.
 *
 * Only these two codes count. A 403 without them — an endpoint the user may not use —
 * keeps its usual per-page handling.
 */
import { create } from "zustand";

export type SignupBlock = "pending" | "rejected";

const CODE_TO_BLOCK: Record<string, SignupBlock> = {
  signup_pending: "pending",
  signup_rejected: "rejected",
};

interface SignupStatusState {
  /** `null` while nothing has said the sign-up is held back. */
  block: SignupBlock | null;
}

export const useSignupStatusStore = create<SignupStatusState>(() => ({ block: null }));

/**
 * Read the sign-up block from one Builder error response, if it carries one.
 *
 * @param status - HTTP status of the response.
 * @param body - Parsed response body (Error schema `{error, code}`).
 * @returns The block, or `null` for any other response.
 */
export function signupBlockFrom(status: number, body: unknown): SignupBlock | null {
  if (status !== 403 || typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? (CODE_TO_BLOCK[code] ?? null) : null;
}

/** Record the block one error response carries; any other response changes nothing. */
export function noteSignupBlock(status: number, body: unknown): void {
  const block = signupBlockFrom(status, body);
  if (block && useSignupStatusStore.getState().block !== block) {
    useSignupStatusStore.setState({ block });
  }
}

/**
 * Forget the block so the pages ask Builder again — after an administrator's decision the
 * next request answers normally; if it is still held back, that request records it again.
 */
export function clearSignupBlock(): void {
  useSignupStatusStore.setState({ block: null });
}
