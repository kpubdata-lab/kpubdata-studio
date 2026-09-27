/**
 * URL source secret redaction — Review UI regression tests (PR #283 review,
 * Epic #246).
 *
 * When `draft.url.endpoint` contains secret query parameters like `api_key`,
 * `serviceKey`, `token`, verify that Review DOM (Source/Query summary,
 * "actual canonical BuildSpec to submit" preview) doesn't expose originals.
 * Simultaneously confirm actual Build submission value (in-memory `spec`
 * that `onBuild` receives) keeps original endpoint regardless of display
 * redaction by this component.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewBuildStep } from "./ReviewBuildStep";
import { INITIAL_DRAFT, buildSpecFromDraft, type AddDataDraft } from "@/features/add-data/model";

function urlDraft(endpoint: string): AddDataDraft {
  return {
    ...INITIAL_DRAFT,
    sourceKind: "url",
    url: { endpoint, format: null },
    datasetId: "d",
    title: "t",
    description: "desc",
  };
}

function publicApiDraft(sourceParams: string): AddDataDraft {
  return {
    ...INITIAL_DRAFT,
    sourceKind: "public_api",
    publicApi: { provider: "datago", dataset: "apt_trade", sourceParams },
    datasetId: "d",
    title: "t",
    description: "desc",
  };
}

function renderReview(draft: AddDataDraft) {
  const specResult = buildSpecFromDraft(draft);
  return {
    specResult,
    ...render(
      <ReviewBuildStep
        draft={draft}
        spec={specResult.spec}
        specError={specResult.error}
        validation={{ status: "idle", valid: false, errors: [] }}
        previewSources={[]}
        previewLimit={5}
        previewSampleMode="first"
        isStale={false}
        jobStatus="idle"
        onBuild={vi.fn()}
        onCancel={vi.fn()}
      />,
    ),
  };
}

describe("ReviewBuildStep — URL source secret redaction (#283)", () => {
  it("Original ?api_key=<secret> not in Review DOM", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    renderReview(urlDraft(`https://api.example.org/data?api_key=${secret}`));
    expect(document.body.textContent ?? "").not.toContain(secret);
    expect(screen.getAllByText(/REDACTED/).length).toBeGreaterThan(0);
  });

  it("Original ?serviceKey=<secret> not in Review DOM", () => {
    const secret = "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e";
    renderReview(urlDraft(`https://api.data.go.kr/openapi?serviceKey=${secret}`));
    expect(document.body.textContent ?? "").not.toContain(secret);
  });

  it("Original ?token=<secret> not in Review DOM", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz012345";
    renderReview(urlDraft(`https://api.example.org/v1/data?token=${secret}`));
    expect(document.body.textContent ?? "").not.toContain(secret);
  });

  it("High-entropy value hidden in Review DOM regardless of key name", () => {
    const secret = "Zx8pQ2vR7mK4nL9wT1yB6cU3sD0fH5jA8gE2rN7iM4x";
    renderReview(urlDraft(`https://api.example.org/v1/data?auth=${secret}`));
    expect(document.body.textContent ?? "").not.toContain(secret);
  });

  it("Non-sensitive query parameters remain as-is in Review DOM", () => {
    renderReview(urlDraft("https://api.example.org/data?region=seoul&year=2024"));
    expect(document.body.textContent ?? "").toContain("region=seoul");
    expect(document.body.textContent ?? "").toContain("year=2024");
  });

  it("Display redaction doesn't change actual in-memory submission spec (endpoint original)", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const draft = urlDraft(`https://api.example.org/data?api_key=${secret}&region=seoul`);
    const { specResult } = renderReview(draft);

    // Hidden in Review DOM
    expect(document.body.textContent ?? "").not.toContain(secret);

    // But AddDataPage's onBuild receives specResult.spec with original endpoint,
    // independent of this component's rendering and redaction.
    expect(specResult.spec?.sources[0]).toMatchObject({
      kind: "url",
      endpoint: `https://api.example.org/data?api_key=${secret}&region=seoul`,
    });
  });
});

describe("ReviewBuildStep — sync build client-side interruption wording (MAJOR)", () => {
  function renderWithJob(props: { jobStatus: "idle" | "cancelled"; jobInterrupted?: boolean }) {
    const draft = publicApiDraft(JSON.stringify({ region: "seoul" }));
    const specResult = buildSpecFromDraft(draft);
    render(
      <ReviewBuildStep
        draft={draft}
        spec={specResult.spec}
        specError={specResult.error}
        validation={{ status: "validated", valid: true, errors: [] }}
        previewSources={[]}
        previewLimit={5}
        previewSampleMode="first"
        isStale={false}
        jobStatus={props.jobStatus}
        jobInterrupted={props.jobInterrupted}
        onBuild={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  }

  it("Client-side abort shows only 'request stopped' not 'cancelled' confirmation", () => {
    renderWithJob({ jobStatus: "idle", jobInterrupted: true });
    expect(screen.getByText(/요청을 중단했습니다\. 서버 빌드 결과는 확인되지 않았습니다\./)).toBeInTheDocument();
    expect(screen.queryByText("실행이 취소되었습니다.")).not.toBeInTheDocument();
  });

  it("Shows 'cancelled' message only on actual async cancelled terminal", () => {
    renderWithJob({ jobStatus: "cancelled" });
    expect(screen.getByText("실행이 취소되었습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/요청을 중단했습니다/)).not.toBeInTheDocument();
  });
});

describe("ReviewBuildStep — public_api sourceParams secret redaction (#283 follow-up §1)", () => {
  it("Original serviceKey not in Review DOM", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    renderReview(publicApiDraft(JSON.stringify({ page: 1, serviceKey: secret })));
    expect(document.body.textContent ?? "").not.toContain(secret);
  });

  it("Original api_key not in Review DOM, region preserved", () => {
    const secret = "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e";
    renderReview(publicApiDraft(JSON.stringify({ api_key: secret, region: "seoul" })));
    expect(document.body.textContent ?? "").not.toContain(secret);
    expect(document.body.textContent ?? "").toContain("seoul");
  });

  it("High-entropy value hidden in Review DOM regardless of key name", () => {
    const secret = "Zx8pQ2vR7mK4nL9wT1yB6cU3sD0fH5jA8gE2rN7iM4x";
    renderReview(publicApiDraft(JSON.stringify({ auth: secret })));
    expect(document.body.textContent ?? "").not.toContain(secret);
  });

  it("Non-sensitive parameters remain as-is in Review DOM", () => {
    renderReview(publicApiDraft(JSON.stringify({ region: "seoul", year: 2024 })));
    expect(document.body.textContent ?? "").toContain("seoul");
    expect(document.body.textContent ?? "").toContain("2024");
  });

  it("Display redaction doesn't change actual in-memory submission spec (params original)", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const draft = publicApiDraft(JSON.stringify({ serviceKey: secret, region: "seoul" }));
    const { specResult } = renderReview(draft);

    expect(document.body.textContent ?? "").not.toContain(secret);
    expect(specResult.spec?.sources[0]).toMatchObject({
      provider: "datago",
      dataset: "apt_trade",
      params: { serviceKey: secret, region: "seoul" },
    });
  });
});
