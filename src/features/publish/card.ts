/**
 * The data card a publish carries, read before publishing (#646, kpubdata-builder#906,
 * contract 1.71.0).
 *
 * Builder writes `card.json` beside each Gold output's `README.md`, with the sections the
 * published README has: provenance per source (attribution, source URL, licence under its
 * declared name, collection time), processing steps, and a personal-information summary.
 * The contract does not declare a card endpoint or the file's schema: the card reaches a
 * client as a run file — `gold/{source key}/card.json` in `GET /artifacts/{run_id}`,
 * fetched with `GET /artifacts/{run_id}/{file_path}`. The fields read here are the ones
 * Builder's `card_sections` writes; a field this file does not find is shown as missing,
 * never filled in.
 *
 * Two facts ride inside Builder's text rather than in a field of their own, and are read
 * from the exact wording Builder writes:
 *
 * - a licence that differs from what kpubdata declares for the source is written
 *   `"<declared>; the provider declares: <provider's>"`;
 * - a source with no declared transformation gets the single step
 *   `"No transformation declared: values are as the source gave them."` — an explicit
 *   "none", which is not the same as an empty section (that blocks publishing as
 *   `card_incomplete`).
 */
import { z } from "zod";

import { downloadArtifact, listArtifactFiles } from "@/features/artifacts/api";
import { artifactDownloadRefusal, type ArtifactDownloadRefusal } from "@/features/artifacts/downloadRefusal";
import { ApiError } from "@/shared/lib/builderApi";

/** A Gold output's card, as a run-relative path: exactly `gold/<source key>/card.json`. */
const CARD_PATH = /^gold\/([^/]+)\/card\.json$/;

/** Builder's separator between the declared licence and the provider's differing one. */
export const LICENCE_MISMATCH_SEPARATOR = "; the provider declares: ";

/** Builder's explicit statement that a source's values were not transformed. */
export const NO_PROCESSING_STEP = "No transformation declared: values are as the source gave them.";

/** A composed Gold's join step: `Joined <left> and <right> (<type> join)`. */
const JOIN_STEP = /^Joined (.+) and (.+) \((\w+) join\)$/;

const text = z.string().optional().catch(undefined);

const cardSourceSchema = z.object({
  source: text,
  institution: text,
  url: text,
  license: text,
  collected_at: text,
});

/** The sections of `card.json` Studio reads; anything else in the file is ignored. */
export const dataCardSchema = z.object({
  card_version: z.number().optional().catch(undefined),
  title: text,
  provenance: z.array(cardSourceSchema).optional().catch(undefined),
  processing: z.array(z.string()).optional().catch(undefined),
  personal_information: text,
});

export type DataCard = z.infer<typeof dataCardSchema>;
export type DataCardSource = z.infer<typeof cardSourceSchema>;

/** A licence split into what the build declares and, when it differs, what the provider does. */
export interface CardLicence {
  declared: string;
  provider: string | null;
}

export function splitCardLicence(value: string): CardLicence {
  const at = value.lastIndexOf(LICENCE_MISMATCH_SEPARATOR);
  if (at === -1) return { declared: value, provider: null };
  return { declared: value.slice(0, at), provider: value.slice(at + LICENCE_MISMATCH_SEPARATOR.length) };
}

export type CardProcessingStep =
  | { kind: "none"; source: string | null; text: string }
  | { kind: "join"; left: string; right: string; joinType: string; text: string }
  | { kind: "step"; text: string };

/**
 * Classifies one processing step. A composed Gold prefixes each side's steps with its
 * source key (`"<key>: <step>"`), so the explicit "none" is recognized there too.
 */
export function classifyProcessingStep(step: string): CardProcessingStep {
  if (step === NO_PROCESSING_STEP) return { kind: "none", source: null, text: step };
  const suffix = `: ${NO_PROCESSING_STEP}`;
  if (step.endsWith(suffix)) return { kind: "none", source: step.slice(0, -suffix.length), text: step };
  const join = JOIN_STEP.exec(step);
  if (join) return { kind: "join", left: join[1], right: join[2], joinType: join[3], text: step };
  return { kind: "step", text: step };
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
    const parsed = dataCardSchema.safeParse(JSON.parse(await blob.text()));
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
