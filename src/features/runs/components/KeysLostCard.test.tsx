/**
 * The lost-keys card sends the user somewhere that can load (#846).
 *
 * A run that lost its keys while it waited never started, so Builder has nothing of it
 * but the job. The card's link went to the edit page whatever was known of the spec,
 * and that page could not load: with no spec it said the run was not found.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
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

/** A Builder that has, or has not, a spec snapshot of the run. Counts how often it is asked. */
function builderWithSnapshot(answer: "has it" | "has none" | "cannot be reached" | "never answers") {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input), "http://builder.test").pathname;
    asked.push(path);
    if (answer === "never answers") return new Promise<Response>(() => {});
    if (answer === "cannot be reached") throw new TypeError("network down");
    if (answer === "has none") {
      return new Response(JSON.stringify({ error: "run not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ run_id: "air-quality-1", spec: "dataset_id: air-quality\n", spec_digest: `sha256:${"a".repeat(64)}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return asked;
}

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  window.__KPUBDATA_CONFIG__ = { useRealBuilder: "true" };
});

afterEach(() => {
  vi.restoreAllMocks();
  clearBuildSpecs();
  delete window.__KPUBDATA_CONFIG__;
});

describe("KeysLostCard", () => {
  it("links to the edit page when this browser kept the run's spec, without asking Builder", () => {
    const asked = builderWithSnapshot("has none");
    saveBuildSpec("air-quality-1", SPEC);

    renderCard("air-quality-1");

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/refresh-jobs/air-quality-1/edit");
    expect(link.getAttribute("data-keys-lost-next")).toBe("edit");
    expect(asked).toEqual([]);
  });

  it("links to the edit page when Builder has a snapshot of the run", async () => {
    // A run interrupted after it started: Builder snapshotted its spec, so the edit
    // page loads although this browser never submitted it.
    builderWithSnapshot("has it");

    renderCard("air-quality-1");

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/refresh-jobs/air-quality-1/edit");
    expect(link.getAttribute("data-keys-lost-next")).toBe("edit");
  });

  it("links to Add Data, and says why, when the spec is nowhere", async () => {
    saveBuildSpec("another-run", SPEC);
    const asked = builderWithSnapshot("has none");

    const { container } = renderCard("air-quality-1");

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/add");
    expect(link.getAttribute("data-keys-lost-next")).toBe("add");
    // The retry wording, which promises a retry of this run, is not shown.
    expect(container.querySelector('[href$="/edit"]')).toBeNull();
    expect(asked.some((path) => path.endsWith("/builds/air-quality-1/spec"))).toBe(true);
  });

  it("does not promise a retry when Builder could not be asked", async () => {
    builderWithSnapshot("cannot be reached");

    renderCard("air-quality-1");

    await waitFor(() => expect(screen.getByRole("link").getAttribute("href")).toBe("/add"), { timeout: 5000 });
  });

  it("offers no way on until it knows which one loads", () => {
    builderWithSnapshot("never answers");

    const { container } = renderCard("air-quality-1");

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("[data-keys-lost]")).not.toBeNull();
  });

  it("names the run it is about, and keeps a run id safe in the link", () => {
    saveBuildSpec("a b/c", SPEC);

    const { container } = renderCard("a b/c");

    expect(container.querySelector("[data-keys-lost]")?.getAttribute("data-keys-lost")).toBe("a b/c");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/refresh-jobs/a%20b%2Fc/edit");
  });
});
