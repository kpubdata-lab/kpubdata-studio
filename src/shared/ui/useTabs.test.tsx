/**
 * useTabs: the WAI-ARIA tabs keyboard model and ARIA relations (#795). Real Tab-key
 * movement needs a browser and is covered in e2e/keyboard-tabs.spec.ts.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useTabs } from "./useTabs";

const IDS = ["overview", "schema", "preview", "quality"] as const;
type Id = (typeof IDS)[number];

function Tabs({ initial = "overview", onSelect }: { initial?: Id; onSelect?: (id: Id) => void }) {
  const [selected, setSelected] = useState<Id>(initial);
  const tabs = useTabs({
    ids: IDS,
    selected,
    onSelect: (id) => {
      onSelect?.(id);
      setSelected(id);
    },
  });
  return (
    <div>
      <button type="button">before</button>
      <div {...tabs.tabListProps} aria-label="Sections">
        {IDS.map((id) => (
          <button key={id} type="button" {...tabs.tabProps(id)} onClick={() => setSelected(id)}>
            {id}
          </button>
        ))}
      </div>
      <section {...tabs.panelProps}>
        <p>{selected} content</p>
        <button type="button">inside panel</button>
      </section>
    </div>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
/** Key events go to the focused element, as in a browser. */
const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });

describe("useTabs", () => {
  it("puts only the selected tab in the Tab order", () => {
    render(<Tabs initial="schema" />);

    expect(IDS.map((id) => tab(id).tabIndex)).toEqual([-1, 0, -1, -1]);
    fireEvent.click(tab("quality"));
    expect(IDS.map((id) => tab(id).tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it("moves, selects and keeps focus with the arrow keys, wrapping at both ends", () => {
    render(<Tabs />);
    tab("overview").focus();

    press("ArrowRight");
    expect(tab("schema")).toHaveFocus();
    expect(tab("schema")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("schema content")).toBeInTheDocument();

    press("ArrowLeft");
    press("ArrowLeft");
    expect(tab("quality")).toHaveFocus();
    expect(tab("quality")).toHaveAttribute("aria-selected", "true");

    press("ArrowRight");
    expect(tab("overview")).toHaveFocus();
  });

  it("goes to the first and last tab with Home and End", () => {
    render(<Tabs initial="schema" />);
    tab("schema").focus();

    press("End");
    expect(tab("quality")).toHaveFocus();
    expect(tab("quality")).toHaveAttribute("tabindex", "0");
    press("Home");
    expect(tab("overview")).toHaveFocus();
    expect(tab("overview")).toHaveAttribute("aria-selected", "true");
  });

  it("does not select again on Home at the first tab, and ignores other keys", () => {
    const onSelect = vi.fn();
    render(<Tabs onSelect={onSelect} />);
    tab("overview").focus();

    press("Home");
    press("ArrowUp");
    press("ArrowDown");
    press("a");
    expect(onSelect).not.toHaveBeenCalled();
    expect(tab("overview")).toHaveFocus();
  });

  it("ties every tab to the panel and labels the panel with the selected tab", () => {
    render(<Tabs />);
    const panel = screen.getByRole("tabpanel");

    for (const id of IDS) expect(tab(id)).toHaveAttribute("aria-controls", panel.id);
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getByRole("tabpanel", { name: "overview" })).toBe(panel);

    fireEvent.click(tab("preview"));
    expect(panel).toHaveAttribute("aria-labelledby", tab("preview").id);
    expect(screen.getByRole("tabpanel", { name: "preview" })).toBe(panel);
  });

  it("gives two tab lists on one page distinct ids", () => {
    render(
      <>
        <Tabs />
        <Tabs />
      </>,
    );
    const ids = screen.getAllByRole("tab").map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
