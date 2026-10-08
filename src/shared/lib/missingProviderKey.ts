/**
 * Telling "a provider key is missing" apart from every other failure (#787).
 *
 * Two answers of Builder mean the user has to give a key and send the build again:
 *
 * - `provider_credential_required` — the request was refused before any provider was
 *   called, and `providers` names which ones need a key. 400 in a multi-user deployment
 *   (the request carries no key for it, builder#1070), 403 where Builder stores keys and
 *   will not use the operator's (builder#786).
 * - `credentials_required` on a failed job — the key was there at submission and Builder
 *   no longer holds it: the server restarted, or the job waited longer than its keys are
 *   kept (builder#683, #1070). The run is over; a new one has to be submitted.
 *
 * Both used to reach the user as an ordinary error sentence.
 */
import { ApiError } from "./builderApi";

export const PROVIDER_CREDENTIAL_REQUIRED = "provider_credential_required";
export const CREDENTIALS_REQUIRED = "credentials_required";

export interface MissingProviderKeys {
  /** The providers Builder says need a key, lower-cased, without repeats. */
  providers: string[];
  /**
   * Where the key goes. `request`: held for this page load and sent with each request
   * (a multi-user deployment). `stored`: saved in Builder on the Connections page.
   */
  keptIn: "request" | "stored";
}

/** The missing keys an error from a build or a preview names, or null when it is not that. */
export function missingProviderKeys(cause: unknown): MissingProviderKeys | null {
  if (!(cause instanceof ApiError) || (cause.status !== 400 && cause.status !== 403)) return null;
  const body = cause.details;
  if (!body || typeof body !== "object") return null;
  const { code, providers } = body as { code?: unknown; providers?: unknown };
  if (code !== PROVIDER_CREDENTIAL_REQUIRED || !Array.isArray(providers)) return null;
  const names = [
    ...new Set(
      providers
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0),
    ),
  ];
  // Without a provider there is nothing to ask the user for: leave it an ordinary error.
  if (names.length === 0) return null;
  return { providers: names, keptIn: cause.status === 403 ? "stored" : "request" };
}

/** What of a job says why it failed: at the top, and — from some paths — in its `response`. */
interface FailedJob {
  status: string;
  code?: string | null;
  error?: string | null;
  response?: Record<string, unknown> | null;
}

function saysKeysLost(code: unknown, error: unknown): boolean {
  if (code === CREDENTIALS_REQUIRED) return true;
  return typeof error === "string" && error.startsWith(`${CREDENTIALS_REQUIRED}:`);
}

/**
 * Whether a finished job failed because Builder no longer held its keys. The `code` is
 * read first; a Builder older than contract 1.78.0 says it only in the sentence.
 *
 * The job's own `code` and `error` decide when either is there. When the job gives no
 * reason at the top, the reason in its `response` is read the same way (#849): a
 * failure that carried `credentials_required` only there was shown as an ordinary one,
 * without the way on that this failure has.
 */
export function keysWereLost(job: FailedJob): boolean {
  if (job.status !== "failed") return false;
  if (job.code || job.error) return saysKeysLost(job.code, job.error);
  return saysKeysLost(job.response?.code, job.response?.error);
}
