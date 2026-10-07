import { useCallback, useId, useRef, type KeyboardEvent } from "react";

/**
 * Keyboard and ARIA wiring for a tab list (#795), following the WAI-ARIA tabs pattern
 * with automatic activation.
 *
 * - Roving tabindex: only the selected tab is in the Tab order, so Tab enters the list
 *   on the selected tab and the next Tab leaves it for the panel.
 * - ArrowRight / ArrowLeft move to the next / previous tab from the focused one,
 *   wrapping at the ends; Home and End go to the first and last. Moving selects the tab
 *   and keeps focus on it — the re-render does not drop focus to the page.
 * - Every tab names the one panel it controls (`aria-controls`), and the panel is
 *   labelled by the selected tab (`aria-labelledby`). The screens render only the
 *   selected tab's content, so there is one panel element and its id is stable.
 *
 * The caller owns the selection (a URL parameter or component state); `onSelect` is
 * called with the id to select, exactly as a click would.
 */
export interface TabsOptions<T extends string> {
  ids: readonly T[];
  selected: T;
  onSelect: (id: T) => void;
}

export interface TabProps {
  id: string;
  role: "tab";
  "aria-selected": boolean;
  "aria-controls": string;
  tabIndex: 0 | -1;
  ref: (element: HTMLElement | null) => void;
}

export function useTabs<T extends string>({ ids, selected, onSelect }: TabsOptions<T>) {
  const base = useId();
  const elements = useRef(new Map<T, HTMLElement>());
  const panelId = `${base}-panel`;
  const tabId = (id: T) => `${base}-tab-${id}`;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (ids.length === 0) return;
      // Move from the tab that has focus, not from `selected`: a selection kept in the
      // URL lands a render later, and a second key pressed before it would otherwise
      // count from the stale tab.
      const focused = ids.find((id) => elements.current.get(id)?.contains(event.target as Node));
      const current = Math.max(0, ids.indexOf(focused ?? selected));
      const last = ids.length - 1;
      let next: number;
      switch (event.key) {
        case "ArrowRight":
          next = current === last ? 0 : current + 1;
          break;
        case "ArrowLeft":
          next = current === 0 ? last : current - 1;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = last;
          break;
        default:
          return;
      }
      event.preventDefault();
      const target = ids[next];
      if (target !== selected) onSelect(target);
      elements.current.get(target)?.focus();
    },
    [ids, selected, onSelect],
  );

  return {
    tabListProps: { role: "tablist" as const, "aria-orientation": "horizontal" as const, onKeyDown },
    tabProps: (id: T): TabProps => ({
      id: tabId(id),
      role: "tab",
      "aria-selected": id === selected,
      "aria-controls": panelId,
      tabIndex: id === selected ? 0 : -1,
      ref: (element) => {
        if (element) elements.current.set(id, element);
        else elements.current.delete(id);
      },
    }),
    panelProps: { id: panelId, role: "tabpanel" as const, "aria-labelledby": tabId(selected) },
  };
}
