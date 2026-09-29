/**
 * Report Draft local storage (#258).
 *
 * Follows `{version, ...}` envelope contract like `draftStorage.ts`/`specStore.ts`, but unlike those
 * modules storing one per key, **saves multiple Reports each by its own id** (#258 §11 — avoid "one
 * Report per single localStorage key"). Let function signatures depend only on this file, leaving
 * internal representation (localStorage envelope) free to change for later #260 Workspace reuse.
 *
 * Never silently swallow save failures (quota exceeded/storage unavailable/serialization failed) —
 * always return explicit result so caller does not wrongly claim "saved" (#258 §11, §12).
 */
import { i18n } from "@/shared/i18n";
import { REPORT_VERSION, type ReportDraft, type ReportSummary } from "./types";
import { ownedStorageKey } from "@/features/auth/storageOwner";

import { normalizeBlocks } from "./legacy";

const STORE_KEY = "kpubdata-studio:reports";
export const STORE_VERSION = 1;

/** Max Reports storable. Over limit, oldest-unused rejected first (not auto-deleted). */
export const REPORT_STORE_LIMIT = 30;

interface StoreEnvelope {
  version: number;
  reports: Record<string, ReportDraft>;
}

export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: string; conflict?: boolean };

function emptyEnvelope(): StoreEnvelope {
  return { version: STORE_VERSION, reports: {} };
}

function isStorageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Read stored envelope. Return empty envelope if missing/version mismatch/corrupt (clean corrupted values). */
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
      typeof (parsed as StoreEnvelope).reports !== "object" ||
      (parsed as StoreEnvelope).reports === null
    ) {
      localStorage.removeItem(ownedStorageKey(STORE_KEY));
      return emptyEnvelope();
    }
    const envelope = parsed as StoreEnvelope;
    // Blocks saved under older names or shapes (#479); the next save writes them back normalized.
    for (const report of Object.values(envelope.reports)) {
      if (report && typeof report === "object") report.blocks = normalizeBlocks(report.blocks);
    }
    return envelope;
  } catch {
    return emptyEnvelope();
  }
}

/**
 * Save envelope. Report success/failure as-is — distinguish quota exceeded/storage unsupported/serialization failed,
 * return reason, never hide failure as success.
 */
function writeEnvelope(envelope: StoreEnvelope): SaveResult {
  if (!isStorageAvailable()) {
    return { ok: false, reason: i18n.t("reports.storage.noStorage") };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch {
    return { ok: false, reason: i18n.t("reports.storage.serializeFailed") };
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
        ? i18n.t("reports.storage.quotaExceeded")
        : i18n.t("reports.storage.saveFailed"),
    };
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Return summary of saved Reports in most-recently-modified order. */
export function listReportSummaries(): ReportSummary[] {
  const envelope = readEnvelope();
  return Object.values(envelope.reports)
    .map((report) => ({
      id: report.id,
      title: report.title,
      datasetId: report.datasetId,
      baseRunId: report.baseRunId,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Load full Report by id. Return null if not found. */
export function getReport(id: string): ReportDraft | null {
  if (!id) return null;
  return readEnvelope().reports[id] ?? null;
}

/**
 * Save Report (create/update shared). If attempting save with lower revision than stored (different tab saved first),
 * reject by default — avoid complex 3-way merge; use minimal safety model: preserve first save and notify user (#258 §13).
 * Pass `force: true` to overwrite anyway (caller only uses when user explicitly chose to).
 */
export function saveReport(report: ReportDraft, options: { force?: boolean } = {}): SaveResult {
  const envelope = readEnvelope();
  const existing = envelope.reports[report.id];

  if (existing && !options.force && existing.revision > report.revision) {
    return {
      ok: false,
      conflict: true,
      reason: i18n.t("reports.storage.staleWrite"),
    };
  }

  const keys = Object.keys(envelope.reports);
  if (!existing && keys.length >= REPORT_STORE_LIMIT) {
    return {
      ok: false,
      reason: i18n.t("reports.storage.limitExceeded", { limit: REPORT_STORE_LIMIT }),
    };
  }

  const nextRevision = (existing?.revision ?? 0) + 1;
  const toStore: ReportDraft = { ...report, revision: nextRevision, updatedAt: new Date().toISOString() };
  envelope.reports[report.id] = toStore;

  const result = writeEnvelope(envelope);
  if (!result.ok) return result;
  return { ok: true, revision: nextRevision };
}

/** Create and save new Report. On save failure, return Report but mark save as failed in result. */
export function createReport(
  input: Pick<ReportDraft, "title" | "datasetId" | "baseRunId" | "buildSpecDigest" | "evidenceFetchedAt" | "blocks" | "evidenceRefs">,
): { report: ReportDraft; result: SaveResult } {
  const now = new Date().toISOString();
  const report: ReportDraft = {
    id: newId(),
    title: input.title,
    datasetId: input.datasetId,
    baseRunId: input.baseRunId,
    buildSpecDigest: input.buildSpecDigest,
    createdAt: now,
    updatedAt: now,
    evidenceFetchedAt: input.evidenceFetchedAt,
    version: REPORT_VERSION,
    revision: 0,
    blocks: input.blocks,
    evidenceRefs: input.evidenceRefs,
  };
  const result = saveReport(report, { force: true });
  return { report: result.ok ? { ...report, revision: result.revision } : report, result };
}

/** Save with only title changed. */
export function renameReport(id: string, title: string): SaveResult {
  const report = getReport(id);
  if (!report) return { ok: false, reason: i18n.t("reports.storage.notFound") };
  return saveReport({ ...report, title }, { force: true });
}

/** Clone existing Report, save with new id (copy all blocks/evidence, no shared refs). */
export function duplicateReport(id: string, titleOverride?: string): { report: ReportDraft; result: SaveResult } | null {
  const source = getReport(id);
  if (!source) return null;
  const now = new Date().toISOString();
  const cloned: ReportDraft = {
    ...structuredClone(source),
    id: newId(),
    title: titleOverride ?? i18n.t("reports.storage.copyOf", { name: source.title }),
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  const result = saveReport(cloned, { force: true });
  return { report: result.ok ? { ...cloned, revision: result.revision } : cloned, result };
}

/** Delete Report by id. Return false if not found or storage unavailable. */
export function deleteReport(id: string): boolean {
  if (!isStorageAvailable()) return false;
  const envelope = readEnvelope();
  if (!envelope.reports[id]) return false;
  delete envelope.reports[id];
  return writeEnvelope(envelope).ok;
}

/** Check if any Report saved (for empty-state message). */
export function hasAnyReport(): boolean {
  return Object.keys(readEnvelope().reports).length > 0;
}
