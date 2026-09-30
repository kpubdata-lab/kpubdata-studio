/**
 * The New Build wizard refuses to open a spec whose first source it cannot express (#496).
 *
 * The form rebuilds `sources[0]` from provider/dataset/params only, so opening a file or
 * URL source in it would turn that source into a public API source on the next save.
 * Build Edit must stop and say why. "Open Saved BuildSpec" now opens in the one creation
 * flow at /add, which expresses file and URL sources (#534, createTableFlow.test.tsx).
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NewBuildPage } from "@/pages/NewBuildPage";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import type { BuildSpec } from "@/shared/lib/types";

const URL_SPEC: BuildSpec = {
  datasetId: "stations",
  title: "측정소",
  description: "설명",
  sources: [
    {
      kind: "url",
      params: {},
      format: "csv",
      endpoint: "https://example.com/stations.csv",
      method: "GET",
    },
  ],
  exports: [{ format: "jsonl" }],
  metadata: { outputPath: "artifacts/builds/stations" },
};

const RUN_ID = "stations-url-run";

beforeEach(() => {
  localStorage.clear();
  clearBuildSpecs();
});

afterEach(() => {
  clearBuildSpecs();
  localStorage.clear();
});

describe("New Build wizard — unsupported first source (#496)", () => {
  it("blocks Build Edit and explains why", async () => {
    saveBuildSpec(RUN_ID, URL_SPEC);
    render(
      <MemoryRouter initialEntries={[`/refresh-jobs/${RUN_ID}/edit`]}>
        <Routes>
          <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert", {}, { timeout: 8000 });
    expect(alert).toHaveTextContent(/url 소스라 마법사로 편집할 수 없습니다/);
    // The wizard itself is not rendered — no step heading, no navigation.
    expect(screen.queryByRole("heading", { name: "기본 정보" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
  });
});
