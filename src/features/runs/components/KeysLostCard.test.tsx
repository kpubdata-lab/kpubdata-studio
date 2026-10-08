/**
 * The lost-keys card sends the user somewhere that can load (#846).
 *
 * A run that lost its keys while it waited never started, so Builder has nothing of it
 * but the job. The card's link went to the edit page whatever was known of the spec,
 * and that page could not load: with no spec it said the run was not found.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import type { BuildSpec } from "@/shared/lib/types";
import { KeysLostCard } from "./KeysLostCard";

const SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "Air quality",
  description: "Hourly air quality by region",
  sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

function renderCard(runId: string) {
  return render(
    <MemoryRouter>
      <KeysLostCard runId={runId} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearBuildSpecs();
});

describe("KeysLostCard", () => {
  it("links to the edit page when this browser kept the run's spec", () => {
    saveBuildSpec("air-quality-1", SPEC);

    renderCard("air-quality-1");

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/refresh-jobs/air-quality-1/edit");
    expect(link.getAttribute("data-keys-lost-next")).toBe("edit");
  });

  it("links to Add Data, and says why, when no spec of the run is here", () => {
    saveBuildSpec("another-run", SPEC);

    const { container } = renderCard("air-quality-1");

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/add");
    expect(link.getAttribute("data-keys-lost-next")).toBe("add");
    // The retry wording, which promises a retry of this run, is not shown.
    expect(container.querySelector('[href$="/edit"]')).toBeNull();
    expect(container.textContent).not.toBe("");
  });

  it("names the run it is about, and keeps a run id safe in the link", () => {
    saveBuildSpec("a b/c", SPEC);

    const { container } = renderCard("a b/c");

    expect(container.querySelector("[data-keys-lost]")?.getAttribute("data-keys-lost")).toBe("a b/c");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/refresh-jobs/a%20b%2Fc/edit");
  });
});
