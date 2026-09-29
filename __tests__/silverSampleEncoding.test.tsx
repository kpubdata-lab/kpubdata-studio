/**
 * A decimal_string column in a silver sample stays exact text on Table Detail (#484).
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/datasets/api", async (importActual) => {
  const actual = await importActual<typeof import("@/features/datasets/api")>();
  return {
    ...actual,
    getBuildStageDetail: async (runId: string, stage: "bronze" | "silver" | "gold", sourceKey: string) => {
      if (stage !== "silver") return actual.getBuildStageDetail(runId, stage, sourceKey);
      return {
        run_id: runId,
        source_key: sourceKey,
        stage: "silver",
        status: "completed",
        available: true,
        row_count: 1,
        schema: [
          { name: "trade_id", dtype: "Int64", nullable: false, unique_count: 1, logical_type: "int64", wire_encoding: "decimal_string" },
          { name: "price", dtype: "Decimal", nullable: false, unique_count: 1, logical_type: "decimal", wire_encoding: "decimal_string" },
        ],
        statistics: null,
        validation: null,
        sample: [{ trade_id: "9007199254740993", price: "123456789.10" }],
      };
    },
  };
});

import { DatasetDetailPage } from "@/pages/DatasetDetailPage";

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "false"));

describe("silver sample on Table Detail (#484)", () => {
  it("shows decimal_string values exactly as sent", async () => {
    render(
      <MemoryRouter initialEntries={["/tables/air-quality?tab=preview&source=datago__air&stage=silver"]}>
        <Routes>
          <Route element={<DatasetDetailPage />} path="/tables/:datasetId" />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("9007199254740993")).toBeInTheDocument();
    expect(screen.getByText("123456789.10")).toBeInTheDocument();
  });
});
