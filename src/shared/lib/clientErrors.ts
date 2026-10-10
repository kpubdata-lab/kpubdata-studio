/**
 * Client error reports (#839).
 *
 * A render error used to end in `console.error` and nothing else, so a beta user's
 * report ("the screen went blank") could not be matched to anything. Each caught error
 * now gets an id that the fallback shows and the console line carries, and the fallback
 * offers the deployment's support contact, so a user can say which error it was.
 */
import { runtimeOr } from "@/shared/config/runtime";

/** Where a user reports an error: a mail address or an https page. */
export interface SupportContact {
  /** `mailto:` or `https:` link. */
  href: string;
  /** What the link shows: the address, or the page's host. */
  label: string;
}

const EMAIL = /^[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+$/;

/**
 * Reads a support contact setting.
 *
 * A bare address becomes a `mailto:` link; an `https:` or `mailto:` URL is kept. Any
 * other value — another scheme, a relative path, text — gives no link: the value is
 * written into an `href`, and a `javascript:` contact would run in the error screen.
 */
export function resolveSupportContact(raw: string | undefined): SupportContact | null {
  const value = raw?.trim();
  if (!value) return null;
  if (EMAIL.test(value)) return { href: `mailto:${value}`, label: value };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return { href: url.href, label: url.host };
  if (url.protocol === "mailto:" && EMAIL.test(decodeURIComponent(url.pathname))) {
    return { href: url.href, label: decodeURIComponent(url.pathname) };
  }
  return null;
}

/**
 * The deployment's support contact, or null when unset or unusable: `SUPPORT_CONTACT`
 * in the container (#838), else the build's `VITE_SUPPORT_CONTACT`.
 */
export function getSupportContact(): SupportContact | null {
  return resolveSupportContact(runtimeOr("supportContact", import.meta.env.VITE_SUPPORT_CONTACT));
}

/**
 * The link a user follows to report error `id`.
 *
 * A mail link gets the id as its subject, so the report names the error without the
 * user copying it. A page link is used as it is: its form is unknown.
 */
export function reportHref(contact: SupportContact, id: string): string {
  if (!contact.href.startsWith("mailto:") || contact.href.includes("?")) return contact.href;
  return `${contact.href}?subject=${encodeURIComponent(`KPubData Studio error ${id}`)}`;
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < bytes; i += 1) values[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(values, (v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * A new error id: `E-<UTC date>-<6 hex digits>`, e.g. `E-20261008-3F9A2C`.
 *
 * Short enough to read out over the phone; the date narrows where to look, and the
 * random part tells apart errors of the same day.
 */
export function newErrorId(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `E-${date}-${randomHex(3)}`;
}

/** Where in Studio an error was caught. */
export type ClientErrorKind = "render" | "route" | "feature";

/**
 * Records a caught error under its id.
 *
 * The console line starts with the id the fallback shows, so a user's report and the
 * browser's log name the same error. This is the one place an external collector
 * would be connected.
 */
export function reportClientError(
  id: string,
  kind: ClientErrorKind,
  error: unknown,
  detail?: string,
): void {
  console.error(`[${id}] ${kind} error:`, error, ...(detail ? [detail] : []));
}
