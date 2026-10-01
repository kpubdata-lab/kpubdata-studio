/**
 * Local storage for executed builds' BuildSpec keyed by run_id (#120).
 *
 * Builder does not persist BuildSpec. `/build` receives spec YAML on each call,
 * executes it, and discards it; no spec is retained in manifest.json either.
 * `GET /builds` only returns `{run_id, status, started_at, finished_at}`. Therefore,
 * to "load and edit an existing build," Studio must remember the spec at execution time.
 *
 * Note the limitations: this store is browser-local, so builds created on other
 * devices/browsers or executed via CLI cannot be edited. If Builder gains spec
 * persistence and individual query endpoints, we only need to replace the
 * implementation of `loadBuildSpec` with remote calls; callers depend only on
 * this module's function signatures.
 *
 * Storage format follows the same `{version, data, savedAt}` envelope convention as draftStorage.
 */
import { buildSpecSchema } from "@/shared/lib/schemas";
import type { BuildSpec, JsonValue, SourceRef } from "@/shared/lib/types";
import { ownedStorageKey } from "@/features/auth/storageOwner";
import { redactSecrets } from "@/features/assistant/scrub";
import { redactUrlEndpoint } from "@/features/add-data/urlRedaction";

const SPEC_STORE_KEY = "kpubdata-studio:build-specs";

/** Envelope schema version for storage. Increment when format changes. */
export const SPEC_STORE_VERSION = 1;

/**
 * Maximum number of items to retain.
 *
 * localStorage is roughly a few MB per origin, so unlimited accumulation could trigger
 * QuotaExceededError on writes for other features (draft storage, etc.). Old items are discarded first.
 */
export const SPEC_STORE_LIMIT = 50;

/** run_id-keyed saved item. */
interface SpecEntry {
  /** BuildSpec used in execution */
  spec: unknown;
  /** ISO string at save time (used to identify old items for cleanup) */
  savedAt: string;
}

/** Envelope structure persisted to localStorage. */
interface SpecStoreEnvelope {
  version: number;
  entries: Record<string, SpecEntry>;
}

/**
 * Read the persisted envelope. Returns an empty envelope if missing, version mismatch, or corrupted.
 *
 * @returns Always a usable envelope (empty on failure).
 */
function readEnvelope(): SpecStoreEnvelope {
  const empty: SpecStoreEnvelope = { version: SPEC_STORE_VERSION, entries: {} };
  try {
    const raw = localStorage.getItem(ownedStorageKey(SPEC_STORE_KEY));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as SpecStoreEnvelope).version !== SPEC_STORE_VERSION ||
      typeof (parsed as SpecStoreEnvelope).entries !== "object" ||
      (parsed as SpecStoreEnvelope).entries === null
    ) {
      // Version mismatch or corrupt envelope: clear without leaving residue.
      clearBuildSpecs();
      return empty;
    }
    return parsed as SpecStoreEnvelope;
  } catch {
     // localStorage inaccessible (SSR/private mode) or JSON parse error.
    return empty;
  }
}

/**
 * Save the envelope. Silently ignore failures (storage failure must not block builds).
 *
 * @param envelope - Envelope to persist.
 */
function writeEnvelope(envelope: SpecStoreEnvelope): void {
  try {
    localStorage.setItem(ownedStorageKey(SPEC_STORE_KEY), JSON.stringify(envelope));
  } catch {
     // Quota exceeded or storage inaccessible; ignore.
  }
}

/**
 * Persistence boundary (#206, S07): just before writing to localStorage, create a
 * redacted **copy** so API keys/tokens and credential-like values don't remain in spec.
 * The in-memory `spec` argument is not modified (ongoing Preview/Build requests use the original),
 * so fail-safe behavior is confined to the persistence boundary.
 *
 * - `sources[].params` (including nested object/array), `metadata`, and `extra` secret-named keys
 *   and high-entropy values are redacted via `redactSecrets` — same policy and helper as
 *   Saved BuildSpec (`savedSpecs.ts`).
 * - For `kind="url"` sources, `endpoint` redacts only query credentials (`?serviceKey=...`, userinfo)
 *   using the same `redactUrlEndpoint` rule as Add Data. The endpoint string is not passed through
 *   `redactSecrets` — if the full URL is flagged as high-entropy, host/path would vanish entirely,
 *   breaking schema enforcement (https:// mandatory) on restoration.
 */
export function redactSpecForStorage(spec: BuildSpec): BuildSpec {
  return {
    ...spec,
    sources: spec.sources.map((source) => {
      const safe: SourceRef = {
        ...source,
        params: redactSecrets(source.params ?? {}) as Record<string, JsonValue>,
        // Unmodeled source keys (#601) cross the same persistence boundary as params.
        ...(source.extra ? { extra: redactSecrets(source.extra) as Record<string, JsonValue> } : {}),
      };
      if (source.kind === "url" && source.endpoint) {
        safe.endpoint = redactUrlEndpoint(source.endpoint).endpoint;
      }
      return safe;
    }),
    metadata: redactSecrets(spec.metadata) as Record<string, JsonValue>,
    ...(spec.extra ? { extra: redactSecrets(spec.extra) as Record<string, JsonValue> } : {}),
  };
}

/**
 * Save an executed build's spec keyed to its run_id.
 *
 * Overwrites if saved under the same run_id again. When the item count exceeds the limit,
 * discard the oldest by `savedAt`. Before storage, redact credential-like values via
 * `redactSpecForStorage`.
 *
 * @param runId - Build execution identifier.
 * @param spec - BuildSpec used in execution.
 */
export function saveBuildSpec(runId: string, spec: BuildSpec): void {
  if (!runId) return;

  const envelope = readEnvelope();
  envelope.entries[runId] = { spec: redactSpecForStorage(spec), savedAt: new Date().toISOString() };

  const keys = Object.keys(envelope.entries);
  if (keys.length > SPEC_STORE_LIMIT) {
    // Sort by savedAt ascending, remove oldest items first.
    const ordered = keys.sort(
      (a, b) => envelope.entries[a].savedAt.localeCompare(envelope.entries[b].savedAt),
    );
    for (const key of ordered.slice(0, keys.length - SPEC_STORE_LIMIT)) {
      delete envelope.entries[key];
    }
  }

  writeEnvelope(envelope);
}

/**
 * Load a spec saved under a run_id.
 *
 * Since spec schema may change after storage, re-validate with zod. Discard items
 * that fail validation before they corrupt the edit form.
 *
 * S07 review §2: Old versions (before redaction was introduced) may retain plaintext
 * credentials in stored items. After loading a valid item, reapply the current
 * persistence boundary policy (`redactSpecForStorage`). If the result differs from
 * the original, immediately rewrite with the sanitized value and return that —
 * never restore raw credentials to in-memory. Already-sanitized items are deep-equal
 * checked to avoid unnecessary rewrites.
 *
 * @param runId - Build execution identifier.
 * @returns Saved spec, or null if missing or no longer valid.
 */
export function loadBuildSpec(runId: string): BuildSpec | null {
  if (!runId) return null;

  const envelope = readEnvelope();
  const entry = envelope.entries[runId];
  if (!entry) return null;

  const result = buildSpecSchema.safeParse(entry.spec);
  if (!result.success) {
    delete envelope.entries[runId];
    writeEnvelope(envelope);
    return null;
  }

  const sanitized = redactSpecForStorage(result.data);
  if (JSON.stringify(sanitized) !== JSON.stringify(result.data)) {
    envelope.entries[runId] = { ...entry, spec: sanitized };
    writeEnvelope(envelope);
    return sanitized;
  }
  return result.data;
}

/**
 * Check if a saved spec exists for a run_id.
 *
 * @param runId - Build execution identifier.
 * @returns Whether an editable spec is available.
 */
export function hasBuildSpec(runId: string): boolean {
  return loadBuildSpec(runId) !== null;
}

/**
 * Clear the entire store.
 */
export function clearBuildSpecs(): void {
  try {
    localStorage.removeItem(ownedStorageKey(SPEC_STORE_KEY));
  } catch {
    // ignore.
  }
}
