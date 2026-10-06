/**
 * Builder keeps refusing a session that the identity provider keeps renewing (#771).
 *
 * A 401 normally means the token expired: the request layer renews it and sends the
 * request once more. When the renewed token is refused too, renewing is not the cure —
 * the audience does not match, the e-mail is not verified, the account is not let in —
 * and every query on the screen went on renewing and resending, each one a failed
 * authentication at Builder, where they add up to its throttle (429).
 *
 * So the request layer records the refusal here once, stops renewing and resending while
 * it stands, and the app shell shows one explanation in place of the page, as it does for
 * a sign-up the ledger holds back (`signupStatus`).
 *
 * It is forgotten when a request is accepted, when the user asks to try again, and when
 * the signed-in user changes.
 */
import { create } from "zustand";

export interface SessionRefusal {
  /** Builder's `code` on the 401, when it sent one. */
  code: string | null;
  /** Builder's own sentence; it is what names the cause (e.g. "email not verified"). */
  reason: string | null;
}

interface SessionRefusalState {
  refusal: SessionRefusal | null;
}

export const useSessionRefusalStore = create<SessionRefusalState>(() => ({ refusal: null }));

/** Whether a refusal stands: no renewal or resend is tried while it does. */
export function isSessionRefused(): boolean {
  return useSessionRefusalStore.getState().refusal !== null;
}

/** Record that a renewed token was refused. The first refusal stays; later ones add nothing. */
export function noteSessionRefused(body: unknown): void {
  if (isSessionRefused()) return;
  const record = typeof body === "object" && body !== null ? (body as { code?: unknown; error?: unknown }) : {};
  useSessionRefusalStore.setState({
    refusal: {
      code: typeof record.code === "string" ? record.code : null,
      reason: typeof record.error === "string" && record.error.trim() ? record.error.trim() : null,
    },
  });
}

/** Forget the refusal, so the next request is treated as any other. */
export function clearSessionRefusal(): void {
  if (isSessionRefused()) useSessionRefusalStore.setState({ refusal: null });
}
