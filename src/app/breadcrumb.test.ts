import { describe, expect, it } from "vitest";

import { crumbsFor } from "./breadcrumb";

const t = (key: string) => `<${key}>`;

describe("crumbsFor (#423)", () => {
  it("names Home alone at the root", () => {
    expect(crumbsFor("/", t)).toEqual([{ label: "<nav.home>" }]);
  });

  it("names the sidebar section of a top-level page, unlinked", () => {
    expect(crumbsFor("/tables", t)).toEqual([{ label: "<nav.datasets>" }]);
    expect(crumbsFor("/connections", t)).toEqual([{ label: "<nav.provider>" }]);
  });

  it("puts the object being looked at after its section", () => {
    expect(crumbsFor("/tables/air%20quality", t)).toEqual([
      { label: "<nav.datasets>", to: "/tables" },
      { label: "air quality" },
    ]);
  });

  it("walks section → run → run page", () => {
    expect(crumbsFor("/refresh-jobs/run-1/artifacts", t)).toEqual([
      { label: "<nav.builds>", to: "/refresh-jobs" },
      { label: "run-1", to: "/refresh-jobs/run-1" },
      { label: "<router.features.artifacts>" },
    ]);
  });

  it("files table creation under Catalog and Refresh Jobs, not as a run id", () => {
    expect(crumbsFor("/add", t)).toEqual([
      { label: "<nav.discover>", to: "/discover" },
      { label: "<router.features.AddData>" },
    ]);
    expect(crumbsFor("/refresh-jobs/new", t)).toEqual([
      { label: "<nav.builds>", to: "/refresh-jobs" },
      { label: "<router.features.newBuild>" },
    ]);
  });

  it("falls back to the path for an unknown page", () => {
    expect(crumbsFor("/nowhere", t)).toEqual([{ label: "/nowhere" }]);
  });
});
