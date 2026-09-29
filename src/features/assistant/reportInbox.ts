/**
 * Local queue for approved ADD_REPORT_BLOCK items (#256).
 *
 * The full Reports editing/publishing UI under `/reports` is implemented in #258 — here we
 * provide only the minimal handoff: securely store user-approved Assistant notes somewhere and
 * link into the Reports entrypoint. Use the same `{version, data, savedAt}` envelope format as
 * `draftStorage.ts`.
 */
import { ownedStorageKey } from "@/features/auth/storageOwner";

export interface AssistantReportNote {
  note: string;
  reason: string;
  context: { datasetId?: string; runId?: string; stage?: string };
  savedAt: string;
}

const INBOX_KEY = "kpubdata-studio:assistant-report-inbox";
const INBOX_VERSION = 1;
const INBOX_LIMIT = 20;

interface InboxEnvelope {
  version: number;
  notes: AssistantReportNote[];
}

function readEnvelope(): InboxEnvelope {
  const empty: InboxEnvelope = { version: INBOX_VERSION, notes: [] };
  try {
    const raw = localStorage.getItem(ownedStorageKey(INBOX_KEY));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as InboxEnvelope).version !== INBOX_VERSION ||
      !Array.isArray((parsed as InboxEnvelope).notes)
    ) {
      return empty;
    }
    return parsed as InboxEnvelope;
  } catch {
    return empty;
  }
}

/** Queue an approved Assistant report note. Silently ignore failures (do not block approval flow). */
export function queueAssistantReportNote(note: AssistantReportNote): void {
  try {
    const envelope = readEnvelope();
    envelope.notes.push(note);
    if (envelope.notes.length > INBOX_LIMIT) {
      envelope.notes = envelope.notes.slice(envelope.notes.length - INBOX_LIMIT);
    }
    localStorage.setItem(ownedStorageKey(INBOX_KEY), JSON.stringify(envelope));
  } catch {
    // If localStorage is unavailable, silently ignore.
  }
}

/** Return queued notes in oldest-first order. */
export function listAssistantReportNotes(): AssistantReportNote[] {
  return readEnvelope().notes;
}

/**
 * Remove a note from the queue (#258 — called after the Reports editor accepts and converts a
 * note into an ASSISTANT_INTERPRETATION block). Locate by value rather than index to avoid races
 * where another tab added notes and shifted indices. If the note is already gone, silently
 * ignore it.
 */
export function removeAssistantReportNote(note: AssistantReportNote): void {
  try {
    const envelope = readEnvelope();
    const index = envelope.notes.findIndex(
      (candidate) =>
        candidate.savedAt === note.savedAt && candidate.note === note.note && candidate.reason === note.reason,
    );
    if (index === -1) return;
    envelope.notes.splice(index, 1);
    localStorage.setItem(ownedStorageKey(INBOX_KEY), JSON.stringify(envelope));
  } catch {
    // If localStorage is unavailable, silently ignore.
  }
}
