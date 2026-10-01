/**
 * The data card a publish carries, read before publishing (#646, kpubdata-builder#906 and
 * #955, contract 1.75.0).
 *
 * Builder writes `card.json` (`DatasetCard`) beside each Gold output's `README.md`, with
 * the sections the published README has: provenance per source (attribution, source URL,
 * licence under its declared name, collection time), processing steps, and a
 * personal-information summary. The contract has no card endpoint: the card reaches a
 * client as a run file — `gold/{source key}/card.json` in `GET /artifacts/{run_id}`,
 * fetched with `GET /artifacts/{run_id}/{file_path}`, whose JSON body for that path the
 * contract declares as `DatasetCard`.
 *
 * Two facts are read from structured fields (contract 1.75.0): a licence that differs from
 * what kpubdata declares for the source (`license_mismatch`, `license_declared`,
 * `license_provider`) and a source with no declared transformation
 * (`processing_declared: false`). A card written before 1.75.0 lacks those fields; only
 * then are they read from Builder's sentences, the only place such a card says them:
 *
 * - `"<declared>; the provider declares: <provider's>"` for a licence mismatch;
 * - the single step `"No transformation declared: values are as the source gave them."`
 *   for no processing — an explicit "none", which is not the same as an empty section
 *   (that blocks publishing as `card_incomplete`).
 */
import { downloadArtifact, listArtifactFiles } from "@/features/artifacts/api";
import { artifactDownloadRefusal, type ArtifactDownloadRefusal } from "@/features/artifacts/downloadRefusal";
import { ApiError } from "@/shared/lib/builderApi";
import { datasetCardSchema, type DatasetCard, type DatasetCardSource } from "@/shared/lib/builderApi.schema";

/** A Gold output's card, as a run-relative path: exactly `gold/<source key>/card.json`. */
const CARD_PATH = /^gold\/([^/]+)\/card\.json$/;

/** Builder's separator between the declared licence and the provider's differing one (pre-1.75.0 cards). */
export const LICENCE_MISMATCH_SEPARATOR = "; the provider declares: ";

/** Builder's explicit statement that a source's values were not transformed (pre-1.75.0 cards). */
export const NO_PROCESSING_STEP = "No transformation declared: values are as the source gave them.";

/** A composed Gold's join step in a pre-1.75.0 card: `Joined <left> and <right> (<type> join)`. */
const JOIN_STEP = /^Joined (.+) and (.+) \((\w+) join\)$/;

export type DataCard = DatasetCard;
export type DataCardSource = DatasetCardSource;

/** A licence as shown: the text to show and, when it differs, the provider's licence. */
export interface CardLicence {
  declared: string;
  provider: string | null;
  mismatch: boolean;
}

/** Splits Builder's licence sentence (pre-1.75.0 cards only). */
export function splitCardLicence(value: string): CardLicence {
  const at = value.lastIndexOf(LICENCE_MISMATCH_SEPARATOR);
  if (at === -1) return { declared: value, provider: null, mismatch: false };
  return { declared: value.slice(0, at), provider: value.slice(at + LICENCE_MISMATCH_SEPARATOR.length), mismatch: true };
}

/**
 * A source's licence, or null when the card leaves it empty (`card_incomplete`). From
 * `license_mismatch` and its two licences when the card has them; from the sentence when
 * it predates them.
 */
export function cardLicence(source: DataCardSource): CardLicence | null {
  if (!source.license.trim()) return null;
  if (typeof source.license_mismatch === "boolean") {
    // Without a mismatch the sentence is the licence itself (or the provider's terms alone
    // when nothing is declared), so it is shown as written.
    if (!source.license_mismatch) return { declared: source.license, provider: null, mismatch: false };
    return { declared: source.license_declared ?? source.license, provider: source.license_provider ?? null, mismatch: true };
  }
  return splitCardLicence(source.license);
}

export type CardProcessingStep =
  | { kind: "none"; source: string | null; text: string }
  | { kind: "join"; text: string }
  | { kind: "step"; text: string };

/**
 * Classifies one step of a pre-1.75.0 card from its wording. A composed Gold prefixes each
 * side's steps with its source key (`"<key>: <step>"`), so the explicit "none" is
 * recognized there too.
 */
export function classifyProcessingStep(step: string): CardProcessingStep {
  if (step === NO_PROCESSING_STEP) return { kind: "none", source: null, text: step };
  const suffix = `: ${NO_PROCESSING_STEP}`;
  if (step.endsWith(suffix)) return { kind: "none", source: step.slice(0, -suffix.length), text: step };
  if (JOIN_STEP.test(step)) return { kind: "join", text: step };
  return { kind: "step", text: step };
}

/**
 * The processing section as shown: `empty` blocks publishing; otherwise each step.
 *
 * With `processing_declared` (1.75.0+), `false` makes the section one explicit "none" and
 * no step is matched by its wording; a composed output (two provenance entries) ends with
 * its join, as the contract says. Without it, each step is classified from its sentence.
 */
export function cardProcessing(card: DataCard): { kind: "empty" } | { kind: "steps"; steps: CardProcessingStep[] } {
  if (card.processing.length === 0) return { kind: "empty" };
  if (typeof card.processing_declared === "boolean") {
    if (!card.processing_declared) return { kind: "steps", steps: card.processing.map((text) => ({ kind: "none", source: null, text })) };
    const composed = card.provenance.length > 1;
    const last = card.processing.length - 1;
    return {
      kind: "steps",
      steps: card.processing.map((text, index) => (composed && index === last ? { kind: "join", text } : { kind: "step", text })),
    };
  }
  return { kind: "steps", steps: card.processing.map(classifyProcessingStep) };
}

export type CardOutput =
  | { key: string; path: string; status: "loaded"; card: DataCard }
  | { key: string; path: string; status: "refused"; refusal: ArtifactDownloadRefusal }
  // Only the HTTP status is kept: an error body is never echoed to the screen.
  | { key: string; path: string; status: "error"; httpStatus: number | null };

/** The HTTP status of a failed read, or null when there was none (network, parse). */
export function failureStatus(cause: unknown): number | null {
  return cause instanceof ApiError && cause.status > 0 ? cause.status : null;
}

/** Every Gold output's card path in a run's file list, in list order. */
export function cardPaths(files: readonly string[]): { key: string; path: string }[] {
  return files.flatMap((path) => {
    const match = CARD_PATH.exec(path);
    return match ? [{ key: match[1], path }] : [];
  });
}

async function loadOne(runId: string, key: string, path: string, signal?: AbortSignal): Promise<CardOutput> {
  try {
    const { blob } = await downloadArtifact(runId, path, signal);
    const parsed = datasetCardSchema.safeParse(JSON.parse(await blob.text()));
    if (!parsed.success) return { key, path, status: "error", httpStatus: null };
    return { key, path, status: "loaded", card: parsed.data };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const refusal = artifactDownloadRefusal(cause);
    if (refusal) return { key, path, status: "refused", refusal };
    return { key, path, status: "error", httpStatus: failureStatus(cause) };
  }
}

/**
 * Reads every Gold output's card of a run. An empty list means the run has no card —
 * the state Builder reports as `card_missing`.
 */
export async function loadDataCards(runId: string, signal?: AbortSignal): Promise<CardOutput[]> {
  const files = await listArtifactFiles(runId, signal);
  return Promise.all(cardPaths(files).map(({ key, path }) => loadOne(runId, key, path, signal)));
}
