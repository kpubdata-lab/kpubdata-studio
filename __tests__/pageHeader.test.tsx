/**
 * The shared page header is compact (#522).
 *
 * The header used to stack an eyebrow label, a 30px title and a multi-line description,
 * which pushed the object and the work area below the first viewport. It is now a title,
 * an optional metadata line and an optional one-line description. Class names are not
 * the contract (the issue says so) — these tests pin the structure: nothing above the
 * heading, the metadata line, and a description that exposes its full text when cut.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/shared/ui";

describe("PageHeader (#522)", () => {
  it("puts the title first, with nothing above the heading", () => {
    const { container } = render(<PageHeader title="Tables" description="All tables" />);
    const heading = screen.getByRole("heading", { level: 1, name: "Tables" });
    expect(heading.previousElementSibling).toBeNull();
    expect(container.textContent?.startsWith("Tables")).toBe(true);
  });

  it("does not render an eyebrow label even when one is passed", () => {
    // `eyebrow` is no longer part of the props; a stale caller must not bring it back.
    const legacy = { eyebrow: "Runs", title: "Refresh history" } as unknown as Parameters<typeof PageHeader>[0];
    render(<PageHeader {...legacy} />);
    expect(screen.queryByText("Runs")).toBeNull();
  });

  it("renders a metadata line under the title", () => {
    render(<PageHeader title="Air quality" meta="air_quality.station_daily" />);
    const heading = screen.getByRole("heading", { level: 1, name: "Air quality" });
    const meta = screen.getByText("air_quality.station_daily");
    expect(heading.nextElementSibling).toBe(meta);
  });

  it("keeps the full description available when it is cut to one line", () => {
    const long = "Configure data source, parameters, and output format step by step.";
    render(<PageHeader title="Create" description={long} />);
    expect(screen.getByText(long)).toHaveAttribute("title", long);
  });

  it("renders a section header as h2", () => {
    render(<PageHeader title="Recent runs" level={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "Recent runs" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
