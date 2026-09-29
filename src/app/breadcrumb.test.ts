import { describe, expect, it } from "vitest";

import { crumbsFor } from "./breadcrumb";

const t = (key: string) => `<${key}>`;

describe("crumbsFor (#423)", () => {
  it("names Home alone at the root", () => {
    expect(crumbsFor("/", t)).toEqual([{ label: "<nav.home>" }]);
  });

  it("names the sidebar section of a top-level page, unlinked", () => {
    expect(crumbsFor("/datasets", t)).toEqual([{ label: "<nav.datasets>" }]);
    expect(crumbsFor("/provider", t)).toEqual([{ label: "<nav.provider>" }]);
  });

  it("puts the object being looked at after its section", () => {
    expect(crumbsFor("/datasets/air%20quality", t)).toEqual([
      { label: "<nav.datasets>", to: "/datasets" },
      { label: "air quality" },
    ]);
  });

  it("walks section → run → run page", () => {
    expect(crumbsFor("/builds/run-1/artifacts", t)).toEqual([
      { label: "<nav.builds>", to: "/builds" },
      { label: "run-1", to: "/builds/run-1" },
      { label: "<router.features.artifacts>" },
    ]);
  });

  it("files table creation under Catalog and Refresh Jobs, not as a run id", () => {
    expect(crumbsFor("/add", t)).toEqual([
      { label: "<nav.discover>", to: "/discover" },
      { label: "<router.features.AddData>" },
    ]);
    expect(crumbsFor("/builds/new", t)).toEqual([
      { label: "<nav.builds>", to: "/builds" },
      { label: "<router.features.newBuild>" },
    ]);
  });

  it("falls back to the path for an unknown page", () => {
    expect(crumbsFor("/nowhere", t)).toEqual([{ label: "/nowhere" }]);
  });
});
