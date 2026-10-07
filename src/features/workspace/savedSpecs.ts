/**
 * Saved BuildSpec local storage (#260).
 *
 * Reuses the same storage layer as `reports/repository.ts` (#258) — doesn't swallow
 * save failures silently but signals them explicitly via `SaveResult`, rejects saves
 * (rather than auto-deleting old items) when exceeding count ceiling since these are
 * user-owned assets, and uses optimistic concurrency (revision) to detect conflicts
 * across multiple tabs.
 *
 * Applies `redactSecrets()` (#206, assistant/scrub.ts) before saving to ensure API
 * keys/tokens don't remain as plaintext in local storage.
 */
import { i18n } from "@/shared/i18n";
import { redactSecrets } from "@/features/assistant/scrub";
import { ownedStorageKey } from "@/features/auth/storageOwner";
import type { BuildSpec } from "@/shared/lib/types";
import {
  SAVED_SPEC_VERSION,
  type SavedBuildSpec,
  type SavedBuildSpecSummary,
  type SavedSpecValidation,
} from "./types";

const STORE_KEY = "kpubdata-studio:saved-build-specs";
export const STORE_VERSION = 1;

/** Maximum number of savable Saved BuildSpecs. If exceeded, refuse save for the least
    recently modified one (don't auto-delete). */
export const SAVED_SPEC_LIMIT = 30;

interface StoreEnvelope {
  version: number;
  specs: Record<string, SavedBuildSpec>;
}

export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: string; conflict?: boolean };

function emptyEnvelope(): StoreEnvelope {
  return { version: STORE_VERSION, specs: {} };
}

function isStorageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Read saved envelope. Return empty envelope if missing, version mismatch, or corrupt
    (corrupt value gets cleaned up). */
function readEnvelope(): StoreEnvelope {
  if (!isStorageAvailable()) return emptyEnvelope();
  try {
    const raw = localStorage.getItem(ownedStorageKey(STORE_KEY));
    if (!raw) return emptyEnvelope();
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as StoreEnvelope).version !== STORE_VERSION ||
      typeof (parsed as StoreEnvelope).specs !== "object" ||
      (parsed as StoreEnvelope).specs === null
    ) {
      localStorage.removeItem(ownedStorageKey(STORE_KEY));
      return emptyEnvelope();
    }
    return parsed as StoreEnvelope;
  } catch {
    return emptyEnvelope();
  }
}

/**
 * Save envelope. Report success/failure directly — distinguish quota exceeded, storage
 * unsupported, serialization failure, and return the reason without appearing to save
 * when actually failed.
 */
function writeEnvelope(envelope: StoreEnvelope): SaveResult {
  if (!isStorageAvailable()) {
    return { ok: false, reason: i18n.t("workspace.storage.noStorage") };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch {
    return { ok: false, reason: i18n.t("workspace.storage.serializeFailed") };
  }
  try {
    localStorage.setItem(ownedStorageKey(STORE_KEY), serialized);
    return { ok: true, revision: 0 };
  } catch (cause) {
    const isQuota =
      cause instanceof DOMException &&
      (cause.name === "QuotaExceededError" || cause.name === "NS_ERROR_DOM_QUOTA_REACHED" || cause.code === 22);
    return {
      ok: false,
      reason: isQuota
        ? i18n.t("workspace.storage.quotaExceeded")
        : i18n.t("workspace.storage.saveFailed"),
    };
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `saved-spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function firstSourceProvider(spec: BuildSpec): string {
  return spec.sources[0]?.provider ?? "";
}

function outputPath(spec: BuildSpec): string {
   // metadata is a JsonValue dict (#250), so read narrowed to string only (for summary display).
  const value = spec.metadata.outputPath;
  return typeof value === "string" ? value : "";
}

/**
 * Most recently modified first (#781). `updatedAt` has millisecond resolution, so two
 * saves in a row can share it; the order then falls to `createdAt` (newer first) and
 * finally to `id`, so it never depends on the order entries were stored in.
 */
function byMostRecent(a: SavedBuildSpec, b: SavedBuildSpec): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** List saved Saved BuildSpec summaries sorted by recent modification. */
export function listSavedSpecSummaries(): SavedBuildSpecSummary[] {
  const envelope = readEnvelope();
  return Object.values(envelope.specs)
    .sort(byMostRecent)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      provider: firstSourceProvider(entry.spec),
      outputPath: outputPath(entry.spec),
      validationStatus: entry.validation.status,
      updatedAt: entry.updatedAt,
    }));
}

/** Load entire Saved BuildSpec by id. Return null if not found. */
export function getSavedSpec(id: string): SavedBuildSpec | null {
  if (!id) return null;
  return readEnvelope().specs[id] ?? null;
}

/**
 * Save a Saved BuildSpec (create/update shared). If save is attempted with revision
 * lower than already saved (another tab saved first), deny by default — follows the
 * minimal safety model "preserve saved-first content and notify user". Pass
 * `force: true` to override (call sites use only when user explicitly chose).
 */
export function saveSpec(entry: SavedBuildSpec, options: { force?: boolean } = {}): SaveResult {
  const envelope = readEnvelope();
  const existing = envelope.specs[entry.id];

  if (existing && !options.force && existing.revision > entry.revision) {
    return {
      ok: false,
      conflict: true,
      reason: i18n.t("workspace.storage.staleWrite"),
    };
  }

  const keys = Object.keys(envelope.specs);
  if (!existing && keys.length >= SAVED_SPEC_LIMIT) {
    return {
      ok: false,
      reason: i18n.t("workspace.storage.limitExceeded", { limit: SAVED_SPEC_LIMIT }),
    };
  }

  const nextRevision = (existing?.revision ?? 0) + 1;
  const toStore: SavedBuildSpec = {
    ...entry,
    spec: redactSecrets(entry.spec) as BuildSpec,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
  };
  envelope.specs[entry.id] = toStore;

  const result = writeEnvelope(envelope);
  if (!result.ok) return result;
  return { ok: true, revision: nextRevision };
}

export interface CreateSavedSpecInput {
  name: string;
  spec: BuildSpec;
  validation: SavedSpecValidation;
}

/** Create and save a new Saved BuildSpec. On save failure, entry returned but result signals
    no save occurred. */
export function createSavedSpec(input: CreateSavedSpecInput): { entry: SavedBuildSpec; result: SaveResult } {
  const now = new Date().toISOString();
  const entry: SavedBuildSpec = {
    id: newId(),
    name: input.name,
    spec: input.spec,
    validation: input.validation,
    createdAt: now,
    updatedAt: now,
    version: SAVED_SPEC_VERSION,
    revision: 0,
  };
  const result = saveSpec(entry, { force: true });
  if (!result.ok) return { entry, result };
   // saveSpec stamps the save time, so return the stored original — if creation and
   // save timestamps diverge, caller can't trust updatedAt.
  const stored = getSavedSpec(entry.id);
  return { entry: stored ?? { ...entry, revision: result.revision }, result };
}

/** Rename only. */
export function renameSavedSpec(id: string, name: string): SaveResult {
  const entry = getSavedSpec(id);
  if (!entry) return { ok: false, reason: i18n.t("workspace.storage.notFound") };
  return saveSpec({ ...entry, name }, { force: true });
}

/**
 * Duplicate an existing Saved BuildSpec to a new id. Assign new name ("(copy of)")
 * and new creation/modification timestamps; reset validation results (don't mark copy
 * as validated just because original was).
 */
export function duplicateSavedSpec(id: string, nameOverride?: string): { entry: SavedBuildSpec; result: SaveResult } | null {
  const source = getSavedSpec(id);
  if (!source) return null;
  const now = new Date().toISOString();
  const cloned: SavedBuildSpec = {
    ...structuredClone(source),
    id: newId(),
    name: nameOverride ?? i18n.t("workspace.storage.copyOf", { name: source.name }),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    validation: { status: "not_validated", errors: [] },
  };
  const result = saveSpec(cloned, { force: true });
  return { entry: result.ok ? { ...cloned, revision: result.revision } : cloned, result };
}

/** Delete Saved BuildSpec by id. Return false if not found or storage unavailable. */
export function deleteSavedSpec(id: string): boolean {
  if (!isStorageAvailable()) return false;
  const envelope = readEnvelope();
  if (!envelope.specs[id]) return false;
  delete envelope.specs[id];
  return writeEnvelope(envelope).ok;
}

/**
 * Delete all Saved BuildSpecs for the current owner (logged-in user or anonymous)
 * (#293). Other owner buckets untouched.
 */
export function clearAllSavedSpecs(): boolean {
  if (!isStorageAvailable()) return false;
  try {
    localStorage.removeItem(ownedStorageKey(STORE_KEY));
    return true;
  } catch {
    return false;
  }
}

/** Check if any Saved BuildSpec exists (for empty state guidance). */
export function hasAnySavedSpec(): boolean {
  return Object.keys(readEnvelope().specs).length > 0;
}
