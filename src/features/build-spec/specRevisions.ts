/**
 * Server-side revision history of a table's BuildSpec (#649, kpubdata-builder#820).
 *
 * Builder keeps every save of a spec as an immutable revision under `kind: spec`:
 *
 * - **Optimistic concurrency.** A save names the revision the edit was based on
 *   (`expected_revision`, 0 for a document with none). If someone saved first, Builder
 *   answers 409 `revision_conflict` with `current_revision` and stores nothing.
 * - **Idempotent retries.** A save carries an `idempotency_key`; a repeat returns the
 *   revision the first attempt made. Studio keeps the key for as long as the same save
 *   has not had a definite answer, so a retry after a lost response never adds a second
 *   revision.
 * - **Server-decided author and time.** Studio never sends either.
 *
 * Credentials never reach a revision. The spec goes through the run spec store's
 * persistence rule (`redactSpecForStorage`, #601/#616/#623/#626) before it is serialized,
 * and when that rule had anything to redact the save is refused here, before any
 * request: a `[REDACTED]` marker in a stored revision would only come back as a spec
 * that fails closed, and Builder refuses a credential-named field with any value anyway
 * (400 `credential_in_content`, which is still shown when it happens). A revision read
 * back goes through the same rule, so a marker in it fails closed in `toBuildSpec`.
 */
import { jsonValueHasRedactedSecret } from "@/features/add-data/paramsRedaction";
import { redactSpecForStorage } from "@/features/build-spec/specStore";
import { fromYamlText, toYamlText } from "@/features/build-spec/yamlText";
import { i18n } from "@/shared/i18n";
import {
  ApiError,
  ContractMismatchError,
  builderApi,
  isRealBuilderEnabled,
  type DocumentRevision,
  type RevertRevisionRequest,
  type RevisionHistoryResponse,
  type RevisionKind,
  type SaveRevisionRequest,
} from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

/** The revision kind a BuildSpec is kept under. */
export const SPEC_REVISION_KIND: RevisionKind = "spec";

/** Builder's limit on a document id (contract `doc_id` maxLength). */
const MAX_DOC_ID_LENGTH = 200;

/** The revision endpoints Studio uses: Builder's own, or the demo's in-memory copy. */
export interface RevisionApi {
  saveRevision(kind: RevisionKind, docId: string, request: SaveRevisionRequest): Promise<DocumentRevision>;
  getRevision(kind: RevisionKind, docId: string): Promise<DocumentRevision>;
  getRevisionHistory(kind: RevisionKind, docId: string): Promise<RevisionHistoryResponse>;
  revertRevision(kind: RevisionKind, docId: string, request: RevertRevisionRequest): Promise<DocumentRevision>;
}

/** Builder's endpoints when one is connected; the demo's otherwise. */
export function revisionApi(): RevisionApi {
  return isRealBuilderEnabled() ? builderApi : demoRevisionApi;
}

/**
 * The document id a table's spec revisions are kept under: the table id (`dataset_id`)
 * of the spec that was opened, so renaming the table in the form does not move the
 * history. `null` when Builder would refuse it as a path segment.
 */
export function specRevisionDocId(spec: Pick<BuildSpec, "datasetId">): string | null {
  const id = spec.datasetId.trim();
  if (!id || id.length > MAX_DOC_ID_LENGTH || id.includes("/")) return null;
  return id;
}

/** Revision content for a spec, or why it may not be saved. */
export type SpecRevisionContent =
  | { ok: true; content: { yaml: string } }
  | { ok: false; reason: "credential" };

/**
 * The `content` of a spec revision: `{"yaml": <canonical BuildSpec YAML>}` of the spec
 * after the persistence redaction rule. Refused when that rule redacted anything (or a
 * marker was already there), so neither a credential nor its marker is ever sent.
 */
export function specRevisionContent(spec: BuildSpec): SpecRevisionContent {
  const redacted = redactSpecForStorage(spec);
  if (jsonValueHasRedactedSecret(redacted)) return { ok: false, reason: "credential" };
  return { ok: true, content: { yaml: toYamlText(redacted) } };
}

/**
 * The spec a revision holds, through the same redaction rule as every other restored
 * spec — a credential-like value comes back as a marker the form refuses to submit.
 * `null` when the revision has no spec content Studio can read.
 */
export function specFromRevision(revision: DocumentRevision): BuildSpec | null {
  const content = revision.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const yaml = (content as Record<string, unknown>).yaml;
  if (typeof yaml !== "string") return null;
  try {
    return redactSpecForStorage(fromYamlText(yaml));
  } catch {
    return null;
  }
}

/** How a save or revert ended, for the screen to say. */
export type RevisionOutcome =
  | { status: "saved"; revision: DocumentRevision }
  | { status: "conflict"; currentRevision: number | null }
  | { status: "credential"; message: string }
  | { status: "error"; message: string };

/** Read Builder's error body: its `code`, message and, on a conflict, `current_revision`. */
export function revisionErrorOutcome(cause: unknown): Exclude<RevisionOutcome, { status: "saved" }> {
  if (cause instanceof ApiError) {
    const details = cause.details && typeof cause.details === "object" ? (cause.details as Record<string, unknown>) : {};
    if (cause.status === 409) {
      const current = details.current_revision;
      return {
        status: "conflict",
        currentRevision: typeof current === "number" && Number.isInteger(current) ? current : null,
      };
    }
    if (cause.status === 400 && details.code === "credential_in_content") {
      return { status: "credential", message: cause.message };
    }
    return { status: "error", message: cause.message };
  }
  return {
    status: "error",
    message: cause instanceof Error ? cause.message : i18n.t("specRevisions.errors.saveFailed"),
  };
}

/**
 * Whether a failure left the outcome unknown, so the same save may be retried.
 *
 * A response Studio could not read (#791) counts as unknown too: Builder may well have
 * saved — a 2xx whose body did not match — and keeping the key makes the person's retry
 * a replay of that save instead of a second revision.
 */
function isUndecided(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return true;
  if (cause instanceof ContractMismatchError) return true;
  return cause.status === 0 || cause.status === 408 || cause.status >= 500;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `spec-save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Idempotency keys for one edit session. The same save — same document, base revision,
 * content and note — keeps its key until Builder gives a definite answer, so a retry
 * after a timeout or 5xx is recognized as the same save. A different save, or the same
 * one after a definite answer, gets a new key.
 */
export function createIdempotencyKeys() {
  let pending: { fingerprint: string; key: string } | null = null;
  return {
    keyFor(fingerprint: string): string {
      if (pending?.fingerprint !== fingerprint) pending = { fingerprint, key: newIdempotencyKey() };
      return pending.key;
    },
    settle(fingerprint: string): void {
      if (pending?.fingerprint === fingerprint) pending = null;
    },
  };
}

export type IdempotencyKeys = ReturnType<typeof createIdempotencyKeys>;

export interface SaveSpecRevisionInput {
  docId: string;
  spec: BuildSpec;
  expectedRevision: number;
  note?: string;
  keys: IdempotencyKeys;
  api?: RevisionApi;
}

/**
 * Save a spec as a new revision on top of `expectedRevision`.
 *
 * Never throws: a refused or failed save comes back as an outcome. A spec that still
 * carries a credential is refused before any request.
 */
export async function saveSpecRevision(input: SaveSpecRevisionInput): Promise<RevisionOutcome> {
  const prepared = specRevisionContent(input.spec);
  if (!prepared.ok) {
    return { status: "credential", message: i18n.t("specRevisions.errors.credentialLocal") };
  }
  const note = input.note?.trim() || undefined;
  const fingerprint = JSON.stringify([input.docId, input.expectedRevision, prepared.content.yaml, note ?? null]);
  const request: SaveRevisionRequest = {
    content: prepared.content,
    expected_revision: input.expectedRevision,
    idempotency_key: input.keys.keyFor(fingerprint),
    ...(note ? { note } : {}),
  };
  try {
    const revision = await (input.api ?? revisionApi()).saveRevision(SPEC_REVISION_KIND, input.docId, request);
    input.keys.settle(fingerprint);
    return { status: "saved", revision };
  } catch (cause) {
    if (!isUndecided(cause)) input.keys.settle(fingerprint);
    return revisionErrorOutcome(cause);
  }
}

/**
 * Revert to `toRevision` as a new revision on top of `expectedRevision`. Never throws.
 */
export async function revertSpecRevision(
  docId: string,
  toRevision: number,
  expectedRevision: number,
  api: RevisionApi = revisionApi(),
): Promise<RevisionOutcome> {
  try {
    const revision = await api.revertRevision(SPEC_REVISION_KIND, docId, {
      to_revision: toRevision,
      expected_revision: expectedRevision,
    });
    return { status: "saved", revision };
  } catch (cause) {
    return revisionErrorOutcome(cause);
  }
}

/** The latest revision of a document, or `null` when it has none yet (404). */
export async function latestSpecRevision(docId: string, api: RevisionApi = revisionApi()): Promise<DocumentRevision | null> {
  try {
    return await api.getRevision(SPEC_REVISION_KIND, docId);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** The history of a document; empty when it has no revision yet (404). */
export async function specRevisionHistory(docId: string, api: RevisionApi = revisionApi()): Promise<RevisionHistoryResponse> {
  try {
    return await api.getRevisionHistory(SPEC_REVISION_KIND, docId);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { revisions: [], audit: [] };
    throw cause;
  }
}

// --- Demo (no Builder connected) ---

interface DemoDocument {
  revisions: DocumentRevision[];
  audit: RevisionHistoryResponse["audit"];
  keys: Map<string, DocumentRevision>;
}

const demoDocuments = new Map<string, DemoDocument>();
const DEMO_AUTHOR = "demo";

function demoDocument(kind: RevisionKind, docId: string): DemoDocument {
  const id = `${kind}/${docId}`;
  let doc = demoDocuments.get(id);
  if (!doc) {
    doc = { revisions: [], audit: [], keys: new Map() };
    demoDocuments.set(id, doc);
  }
  return doc;
}

function demoAppend(
  kind: RevisionKind,
  docId: string,
  doc: DemoDocument,
  entry: { content: DocumentRevision["content"]; expected: number; note: string | null; revertedFrom: number | null },
): DocumentRevision {
  const current = doc.revisions.length;
  if (entry.expected !== current) {
    throw new ApiError(409, i18n.t("specRevisions.errors.demoConflict", { current }), {
      error: `the document is at revision ${current}`,
      code: "revision_conflict",
      current_revision: current,
    });
  }
  const at = new Date().toISOString();
  const revision: DocumentRevision = {
    kind,
    doc_id: docId,
    revision: current + 1,
    content: entry.content,
    note: entry.note,
    author: DEMO_AUTHOR,
    created_at: at,
    reverted_from: entry.revertedFrom,
  };
  doc.revisions.push(revision);
  doc.audit.push({ revision: revision.revision, action: entry.revertedFrom === null ? "save" : "revert", author: DEMO_AUTHOR, at });
  return revision;
}

function demoNotFound(docId: string): ApiError {
  return new ApiError(404, i18n.t("api.http.404"), { error: `no such spec: ${docId}`, code: "revision_not_found" });
}

/** In-memory revisions for the demo, gone on reload. Mirrors Builder's answers. */
export const demoRevisionApi: RevisionApi = {
  async saveRevision(kind, docId, request) {
    const doc = demoDocument(kind, docId);
    const replay = request.idempotency_key ? doc.keys.get(request.idempotency_key) : undefined;
    if (replay) return replay;
    const revision = demoAppend(kind, docId, doc, {
      content: request.content,
      expected: request.expected_revision,
      note: request.note ?? null,
      revertedFrom: null,
    });
    if (request.idempotency_key) doc.keys.set(request.idempotency_key, revision);
    return revision;
  },
  async getRevision(kind, docId) {
    const latest = demoDocument(kind, docId).revisions.at(-1);
    if (!latest) throw demoNotFound(docId);
    return latest;
  },
  async getRevisionHistory(kind, docId) {
    const doc = demoDocument(kind, docId);
    if (doc.revisions.length === 0) throw demoNotFound(docId);
    return {
      // A history lists revisions without their content, as Builder's does.
      revisions: doc.revisions.map((revision) => ({
        kind: revision.kind,
        doc_id: revision.doc_id,
        revision: revision.revision,
        note: revision.note,
        author: revision.author,
        created_at: revision.created_at,
        reverted_from: revision.reverted_from,
      })),
      audit: [...doc.audit],
    };
  },
  async revertRevision(kind, docId, request) {
    const doc = demoDocument(kind, docId);
    const old = doc.revisions[request.to_revision - 1];
    if (!old) throw demoNotFound(docId);
    return demoAppend(kind, docId, doc, {
      content: old.content,
      expected: request.expected_revision,
      note: `revert to revision ${request.to_revision}`,
      revertedFrom: request.to_revision,
    });
  },
};

/** Forget the demo's revisions (tests). */
export function clearDemoRevisions(): void {
  demoDocuments.clear();
}
