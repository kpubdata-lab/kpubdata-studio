/**
 * Move focus to the new page after a client-side navigation (#662).
 *
 * A route change in a single-page app leaves focus where it was — usually on the
 * sidebar link that was just clicked — so a screen reader announces nothing and the next
 * Tab starts in the navigation again. After a navigation the shell calls this with its
 * `<main>`: focus goes to the page's `<h1>` (made focusable with `tabindex="-1"`), and a
 * screen reader reads the new page's name. A page with no `<h1>` gets the `<main>` itself.
 *
 * Pages are lazy chunks, so the heading is often not there yet when the route changes
 * (the Suspense fallback is). The `<main>` is watched until a heading appears, and while
 * the watch lasts a heading that is replaced on re-render (a loading header swapped for
 * the loaded one) is focused again. The watch ends as soon as the user moves focus
 * somewhere else — focus is never taken back from them.
 *
 * This is generic on purpose: it knows the shell's `<main>` and `<h1>` only, so a page
 * that manages focus inside itself (a wizard step) is unaffected after the first focus.
 */

/** How long to wait for a lazy page's heading before focusing `<main>` instead. */
export const ROUTE_FOCUS_TIMEOUT_MS = 3000;

function makeFocusable(element: HTMLElement): void {
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
}

/**
 * Focus the page heading inside `main`, waiting for it if the page is still loading.
 *
 * @param main - The shell's `<main>` landmark.
 * @param timeoutMs - How long to wait for an `<h1>` before focusing `main`.
 * @returns A cleanup that stops waiting (call it when the route changes again).
 */
export function focusRouteTarget(main: HTMLElement, timeoutMs = ROUTE_FOCUS_TIMEOUT_MS): () => void {
  // Whatever had focus when the route changed: the link or button that navigated.
  const origin = document.activeElement;
  // A dialog (the first-run tour, the Ask KPubData drawer) keeps its own focus.
  if (origin instanceof HTMLElement && origin.closest("[role='dialog']")) return () => undefined;
  let target: HTMLElement | null = null;
  let done = false;

  /** Focus is still ours to move: on nothing, on our target, or still on the origin. */
  function mayFocus(): boolean {
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    return active === target || (target === null && active === origin);
  }

  function focusHeading(): boolean {
    const heading = main.querySelector<HTMLElement>("h1");
    if (!heading) return false;
    if (heading === target && document.activeElement === heading) return true;
    if (!mayFocus()) {
      stop();
      return true;
    }
    makeFocusable(heading);
    target = heading;
    heading.focus();
    return true;
  }

  // A heading replaced on re-render leaves focus on <body>; the new one is focused again.
  const observer = new MutationObserver(() => {
    if (!done) focusHeading();
  });

  /** The user moved focus elsewhere: stop following the page. */
  function onFocusIn(event: FocusEvent): void {
    if (event.target !== target && event.target !== main) stop();
  }

  const timer = window.setTimeout(() => {
    if (done) return;
    if (!target && mayFocus()) {
      makeFocusable(main);
      target = main;
      main.focus();
    }
    stop();
  }, timeoutMs);

  function stop(): void {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    document.removeEventListener("focusin", onFocusIn);
  }

  focusHeading();
  if (!done) {
    observer.observe(main, { childList: true, subtree: true });
    document.addEventListener("focusin", onFocusIn);
  }
  return stop;
}
