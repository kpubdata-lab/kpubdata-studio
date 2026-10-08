/**
 * What the review step says about a table that is already there, and when it holds the
 * build (#837). The page's side — which id is submitted — is in
 * `__tests__/addDataExistingTable.test.tsx`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildSpecFromDraft, INITIAL_DRAFT, type AddDataDraft } from "@/features/add-data/model";
import type { ExistingTableChoice, ExistingTables } from "@/features/add-data/existingTables";
import { ReviewBuildStep } from "./ReviewBuildStep";

const DRAFT: AddDataDraft = {
  ...INITIAL_DRAFT,
  sourceKind: "public_api",
  publicApi: { provider: "datago", dataset: "air_station", sourceParams: JSON.stringify({ station: "B" }) },
  datasetId: "datago-air-station",
  title: "Air stations",
  description: "Measuring stations",
};

const THERE = [
    {
      table_id: "tbl_1",
      logical_name: "datago-air-station.datago.air_station",
      current_snapshot_id: "snap_1",
      revision: 1,
      current_snapshot: { snapshot_id: "snap_1", row_count: 22, committed_at: "2026-10-08T01:00:00Z", coverage: null },
      dataset_id: "datago-air-station",
    },
    {
      table_id: "tbl_2",
      logical_name: "datago-air-station.never-committed",
      current_snapshot_id: null,
      revision: 0,
      current_snapshot: null,
      dataset_id: "datago-air-station",
    },
];

/** The build would commit to the first of them: same name. */
const FOUND: ExistingTables = {
  status: "found",
  freeId: "datago-air-station-2",
  freeNumber: 2,
  tables: THERE,
  replaced: [THERE[0]],
};
/** The build makes a table of another name under the same id — a second upload. */
const BESIDE: ExistingTables = { ...FOUND, replaced: [] };

/** The review step, ready to build but for what `existing` says. */
function renderReview(existing: ExistingTables, choice: ExistingTableChoice = "new") {
  const handlers = { onChooseTable: vi.fn(), onRecheckExisting: vi.fn(), onBuild: vi.fn() };
  render(
    <ReviewBuildStep
      draft={DRAFT}
      spec={buildSpecFromDraft(DRAFT).spec}
      validation={{ status: "validated", valid: true, errors: [] }}
      previewSources={[]}
      previewLimit={5}
      previewSampleMode="first"
      isStale={false}
      existing={existing}
      tableChoice={choice}
      onChooseTable={handlers.onChooseTable}
      onRecheckExisting={handlers.onRecheckExisting}
      jobStatus="idle"
      onBuild={handlers.onBuild}
      onCancel={vi.fn()}
    />,
  );
  return handlers;
}

function buildButton(): HTMLElement {
  return screen.getByRole("button", { name: "테이블 만들기" });
}

describe("ReviewBuildStep — a table of this id is already there (#837)", () => {
  it("builds without a word when there is none", () => {
    renderReview({ status: "none" });

    expect(document.querySelector("[data-existing-table]")).toBeNull();
    expect(buildButton()).toBeEnabled();
  });

  it("holds the build until it has been told", () => {
    renderReview({ status: "checking" });

    expect(document.querySelector('[data-existing-table="checking"]')).not.toBeNull();
    expect(buildButton()).toBeDisabled();
  });

  it("holds the build when it could not be told, and offers to ask again", () => {
    const handlers = renderReview({ status: "unknown" });

    expect(buildButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(handlers.onRecheckExisting).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("names the tables that are there, with the rows it knows of", () => {
    renderReview(FOUND);

    const notice = document.querySelector<HTMLElement>('[data-existing-table="found"]');
    expect(notice?.textContent).toContain("datago-air-station.datago.air_station · 22행");
    // A table with no committed snapshot has no row count to state — not 0.
    expect(notice?.textContent).toContain("datago-air-station.never-committed");
    expect(notice?.textContent).not.toContain("0행");
    expect(notice?.textContent).toContain("datago-air-station-2");
    expect(buildButton()).toBeEnabled();
  });

  it.each<[ExistingTableChoice, RegExp, RegExp]>([
    ["new", /새 테이블로 만들기/, /기존 테이블 갱신/],
    ["same", /기존 테이블 갱신/, /새 테이블로 만들기/],
  ])("shows %s as the choice in force and reports the other when picked", (choice, checked, other) => {
    const handlers = renderReview(FOUND, choice);

    expect(screen.getByRole("radio", { name: checked })).toBeChecked();
    expect(screen.getByRole("radio", { name: other })).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: other }));
    expect(handlers.onChooseTable).toHaveBeenCalledWith(choice === "new" ? "same" : "new");
  });

  it("does not say a table is replaced, or call it a refresh, when the build only shares its id", () => {
    // A file: every upload is a table of its own, so the same id adds one beside the other.
    const handlers = renderReview(BESIDE);

    const notice = document.querySelector<HTMLElement>('[data-existing-table="found"]');
    expect(notice?.getAttribute("data-existing-table-replaces")).toBe("false");
    expect(notice?.textContent).toContain("바꾸지는 않습니다");
    expect(notice?.textContent).not.toContain("바뀝니다");
    expect(screen.queryByRole("radio", { name: /기존 테이블 갱신/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /새 테이블로 만들기/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /같은 ID 아래에 추가/ }));
    expect(handlers.onChooseTable).toHaveBeenCalledWith("same");
  });

  it("says it of the table that would be replaced when one would be", () => {
    renderReview(FOUND);

    const notice = document.querySelector<HTMLElement>('[data-existing-table="found"]');
    expect(notice?.getAttribute("data-existing-table-replaces")).toBe("true");
    expect(notice?.textContent).toContain("바뀝니다");
    expect(screen.queryByRole("radio", { name: /같은 ID 아래에 추가/ })).toBeNull();
  });
});
