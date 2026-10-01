import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/lib/builderApi";

import { ArtifactRow } from "./ArtifactRow";

const api = vi.hoisted(() => ({
  downloadArtifact: vi.fn(),
  saveBlobAsFile: vi.fn(),
}));

vi.mock("@/features/artifacts/api", () => api);

function renderRow(path: string) {
  render(
    <ul>
      <ArtifactRow runId="run-1" path={path} />
    </ul>,
  );
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
}

beforeEach(() => {
  api.downloadArtifact.mockReset();
  api.saveBlobAsFile.mockReset();
});

describe("ArtifactRow explains policy refusals of a download (#643)", () => {
  it("names the declared PII columns and points to the Gold files", async () => {
    api.downloadArtifact.mockRejectedValue(
      new ApiError(403, "silver files hold the declared PII columns siteTel in plain text", {
        error: "silver files hold the declared PII columns siteTel in plain text",
        code: "declared_pii_withheld",
        columns: ["siteTel", "ownerName"],
      }),
    );
    renderRow("silver/datago__air/part-0.parquet");

    const notice = await screen.findByRole("status");
    expect(notice).toHaveAttribute("data-refusal", "declared_pii_withheld");
    expect(notice).toHaveTextContent("선언된 개인정보 컬럼(siteTel, ownerName)");
    expect(notice).toHaveTextContent("Gold 파일을 내려받으세요");
    // A policy notice, not the failure alert with Builder's raw message.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains an unreadable PII declaration (503) with a retry", async () => {
    api.downloadArtifact.mockRejectedValue(
      new ApiError(503, "the PII declaration of example.dataset could not be read", {
        error: "the PII declaration of example.dataset could not be read",
        code: "pii_declaration_unavailable",
        dataset: "example.dataset",
      }),
    );
    renderRow("bronze/example/raw.jsonl");

    const notice = await screen.findByRole("status");
    expect(notice).toHaveAttribute("data-refusal", "pii_declaration_unavailable");
    expect(notice).toHaveTextContent("example.dataset의 kpubdata 개인정보(PII) 선언을 확인할 수 없어");
    expect(notice).toHaveTextContent("잠시 후 다시 시도");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains forbidden redistribution and names the sources that forbid it", async () => {
    api.downloadArtifact.mockRejectedValue(
      new ApiError(403, "the source terms forbid redistribution", {
        error: "the source terms forbid redistribution",
        code: "redistribution_forbidden",
        redistribution: {
          verdict: "forbidden",
          sources: [
            { source: "example.dataset", verdict: "forbidden", reason: "the dataset declares redistribution: forbidden" },
            { source: "other.dataset", verdict: "allowed", reason: "allowed" },
          ],
        },
      }),
    );
    renderRow("gold/table.parquet");

    const notice = await screen.findByRole("status");
    expect(notice).toHaveAttribute("data-refusal", "redistribution_forbidden");
    expect(notice).toHaveTextContent("재배포를 금지해 이 파일은 Builder 밖으로 내보낼 수 없습니다(재배포 금지 소스: example.dataset)");
    expect(notice).not.toHaveTextContent("other.dataset");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps any other 403 a plain error", async () => {
    api.downloadArtifact.mockRejectedValue(new ApiError(403, "접근 권한이 없습니다.", { error: "forbidden" }));
    renderRow("silver/datago__air/part-0.parquet");

    expect(await screen.findByRole("alert")).toHaveTextContent("접근 권한이 없습니다.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still downloads a Gold file with no notice", async () => {
    const blob = new Blob(["a,b\n"]);
    api.downloadArtifact.mockResolvedValue({ blob, filename: "table.csv" });
    renderRow("gold/table.csv");

    await waitFor(() => expect(api.saveBlobAsFile).toHaveBeenCalledWith(blob, "table.csv"));
    expect(api.downloadArtifact).toHaveBeenCalledWith("run-1", "gold/table.csv");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
