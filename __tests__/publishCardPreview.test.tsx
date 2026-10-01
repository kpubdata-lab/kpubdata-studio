/**
 * The data card preview on the publish page (#646, kpubdata-builder#906, contract 1.71.0):
 * the card Builder wrote as `gold/<key>/card.json` is read through the artifact routes and
 * rendered section by section; a licence that differs from kpubdata's declaration is
 * flagged; an explicit "no transformation" is told apart from an empty section.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cardPaths, classifyProcessingStep, splitCardLicence } from "@/features/publish/card";
import { BuildPublishPage } from "@/pages/BuildPublishPage";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";

const READINESS = { run_id: "run-7", target: "huggingface", ready: true, blockers: [], warnings: [] };

/** A card exactly as Builder's `card_sections` writes it (kpubdata-builder#906). */
const SINGLE_CARD = {
  card_version: 1,
  title: "Air quality",
  provenance: [
    {
      source: "airkorea.pm",
      institution: "Korea Environment Corporation",
      url: "https://www.data.go.kr/data/15073861/openapi.do",
      license: "cc-by-4.0; the provider declares: KOGL type 1",
      collected_at: "2026-09-30 12:00 UTC",
    },
  ],
  processing: ["No transformation declared: values are as the source gave them."],
  personal_information:
    "No column was declared personal information. Values were not scanned for personal information (no pii policy).",
};

const JOINED_CARD = {
  card_version: 1,
  title: "Joined",
  provenance: [
    { source: "left", institution: "A", url: "https://a.example", license: "KOGL type 1", collected_at: "2026-09-30 12:00 UTC" },
    { source: "right", institution: "B", url: "uploaded file", license: "KOGL type 1", collected_at: "" },
  ],
  processing: [
    "left: Renamed SIDO to sido",
    "right: No transformation declared: values are as the source gave them.",
    "Joined left and right (inner join)",
  ],
  personal_information: "",
};

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

function file(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    blob: async () => new Blob([JSON.stringify(body)], { type: "application/octet-stream" }),
  } as unknown as Response;
}

function stubBuilder(files: string[], cards: Record<string, unknown>) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path.endsWith("/artifacts/run-7")) return Promise.resolve(json(200, { run_id: "run-7", files }));
    const card = Object.entries(cards).find(([name]) => path.endsWith(`/artifacts/run-7/${name}`));
    if (card) return Promise.resolve(file(card[1]));
    return Promise.resolve(json(200, READINESS));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPublish() {
  return render(
    <MemoryRouter initialEntries={["/refresh-jobs/run-7/publish"]}>
      <Routes><Route path="/refresh-jobs/:buildId/publish" element={<BuildPublishPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("card.json reading (#646)", () => {
  it("finds each Gold output's own card, not the copies in export layouts", () => {
    expect(
      cardPaths([
        "manifest.json",
        "gold/airkorea.pm/card.json",
        "gold/airkorea.pm/README.md",
        "gold/airkorea.pm/hf/card.json",
        "silver/airkorea.pm/card.json",
        "gold/joined/card.json",
      ]),
    ).toEqual([
      { key: "airkorea.pm", path: "gold/airkorea.pm/card.json" },
      { key: "joined", path: "gold/joined/card.json" },
    ]);
  });

  it("splits a licence that differs from the provider's declaration", () => {
    expect(splitCardLicence("cc-by-4.0; the provider declares: KOGL type 1")).toEqual({ declared: "cc-by-4.0", provider: "KOGL type 1" });
    expect(splitCardLicence("KOGL type 1")).toEqual({ declared: "KOGL type 1", provider: null });
  });

  it("recognizes the explicit no-processing step, prefixed or not, and a join step", () => {
    expect(classifyProcessingStep("No transformation declared: values are as the source gave them.").kind).toBe("none");
    expect(classifyProcessingStep("right: No transformation declared: values are as the source gave them.")).toMatchObject({ kind: "none", source: "right" });
    expect(classifyProcessingStep("Joined left and right (inner join)")).toMatchObject({ kind: "join", left: "left", right: "right", joinType: "inner" });
    expect(classifyProcessingStep("Renamed SIDO to sido").kind).toBe("step");
  });
});

describe("publish page card preview (#646)", () => {
  it("renders the real card response section by section", async () => {
    const fetchMock = stubBuilder(["manifest.json", "gold/airkorea.pm/card.json"], { "gold/airkorea.pm/card.json": SINGLE_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 airkorea.pm" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/artifacts/run-7/gold/airkorea.pm/card.json"))).toBe(true);
    for (const label of [ko.publish.card.sections.provenance, ko.publish.card.sections.processing, ko.publish.card.sections.personalInformation]) {
      expect(within(output).getByText(label)).toBeInTheDocument();
    }
    expect(within(output).getByText("Korea Environment Corporation")).toBeInTheDocument();
    expect(within(output).getByRole("link", { name: "https://www.data.go.kr/data/15073861/openapi.do" })).toBeInTheDocument();
    expect(within(output).getByText("2026-09-30 12:00 UTC")).toBeInTheDocument();
    expect(within(output).getByText(/No column was declared personal information/)).toBeInTheDocument();
  });

  it("flags a licence that differs from kpubdata's declaration", async () => {
    stubBuilder(["gold/airkorea.pm/card.json"], { "gold/airkorea.pm/card.json": SINGLE_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 airkorea.pm" });
    const licence = output.querySelector('[data-card-field="licence"]') as HTMLElement;
    expect(within(licence).getByText("cc-by-4.0")).toBeInTheDocument();
    const badge = within(licence).getByText(ko.publish.card.licenceMismatch).closest("[data-status]");
    expect(badge).toHaveAttribute("data-status", "actionable");
    expect(badge).toHaveAttribute("data-tone", "warning");
    expect(within(licence).getByText("KPubData 카탈로그 선언: KOGL type 1")).toBeInTheDocument();
  });

  it("does not flag a licence that matches", async () => {
    stubBuilder(["gold/joined/card.json"], { "gold/joined/card.json": JOINED_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 joined" });
    expect(output.querySelector("[data-licence-mismatch]")).toBeNull();
    expect(within(output).queryByText(ko.publish.card.licenceMismatch)).not.toBeInTheDocument();
  });

  it("says no processing explicitly, apart from an empty section", async () => {
    stubBuilder(["gold/airkorea.pm/card.json", "gold/joined/card.json"], {
      "gold/airkorea.pm/card.json": SINGLE_CARD,
      "gold/joined/card.json": { ...JOINED_CARD, processing: [] },
    });
    renderPublish();

    const none = await screen.findByRole("region", { name: "Gold 출력 airkorea.pm" });
    const step = none.querySelector('[data-processing="none"]') as HTMLElement;
    expect(step).not.toBeNull();
    expect(within(step).getByText(ko.publish.card.noProcessing)).toHaveAttribute("data-status", "normal");
    expect(within(none).queryByText(ko.publish.card.empty)).not.toBeInTheDocument();

    const empty = await screen.findByRole("region", { name: "Gold 출력 joined" });
    expect(empty.querySelector('[data-card-section="processing"]')).toBeNull();
    expect(empty.querySelector('[data-processing="none"]')).toBeNull();
    const blanks = within(empty).getAllByText(ko.publish.card.empty);
    expect(blanks.every((badge) => badge.closest("[data-status]")?.getAttribute("data-tone") === "failure")).toBe(true);
  });

  it("shows a composed Gold's join step and each side's explicit no-processing", async () => {
    stubBuilder(["gold/joined/card.json"], { "gold/joined/card.json": JOINED_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 joined" });
    const join = output.querySelector('[data-processing="join"]') as HTMLElement;
    expect(within(join).getByText(ko.publish.card.joinLabel)).toBeInTheDocument();
    expect(within(join).getByText("Joined left and right (inner join)")).toBeInTheDocument();
    expect(within(output).getByText("right: 처리 없음")).toBeInTheDocument();
    expect(within(output).getByText("left: Renamed SIDO to sido")).toBeInTheDocument();
    // Empty collected date and personal information block publishing, so they are marked, not blank.
    expect(within(output).getAllByText(ko.publish.card.empty)).toHaveLength(2);
    expect(within(output).getByText("uploaded file")).toBeInTheDocument();
  });

  it("says a run has no card when its Gold outputs carry none", async () => {
    stubBuilder(["manifest.json", "gold/airkorea.pm/table.parquet"], {});
    renderPublish();

    expect(await screen.findByText(ko.publish.card.none.title)).toBeInTheDocument();
  });

  it("explains a card Builder withholds by policy, and never echoes an error body", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith("/artifacts/run-7")) return Promise.resolve(json(200, { run_id: "run-7", files: ["gold/a/card.json", "gold/b/card.json"] }));
      if (path.endsWith("/artifacts/run-7/gold/a/card.json")) {
        return Promise.resolve(json(403, { error: "forbidden", code: "redistribution_forbidden", redistribution: { verdict: "forbidden", sources: [] } }));
      }
      if (path.endsWith("/artifacts/run-7/gold/b/card.json")) return Promise.resolve(json(500, { error: "<b>raw secret html</b>" }));
      return Promise.resolve(json(200, READINESS));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();

    const refused = await screen.findByRole("region", { name: "Gold 출력 a" });
    expect(await within(refused).findByText(ko.publish.card.refused.redistribution_forbidden)).toBeInTheDocument();
    const failed = screen.getByRole("region", { name: "Gold 출력 b" });
    expect(within(failed).getByText(/이 카드를 읽지 못했습니다\. \(HTTP 상태 500\)/)).toBeInTheDocument();
    expect(screen.queryByText(/raw secret html/)).not.toBeInTheDocument();
  });

  it("shows nothing invented in demo mode", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    renderPublish();

    expect(await screen.findByText(ko.publish.card.demo)).toHaveAttribute("data-status", "not-evaluated");
  });
});

describe("card preview labels (#646)", () => {
  it("has every card section label in both languages", () => {
    const keys = ["title", "sections", "fields", "licenceMismatch", "noProcessing", "joinLabel", "empty", "none"] as const;
    for (const key of keys) {
      expect(ko.publish.card[key]).toBeTruthy();
      expect(en.publish.card[key]).toBeTruthy();
    }
    expect(Object.keys(ko.publish.card.sections)).toEqual(Object.keys(en.publish.card.sections));
    expect(Object.keys(ko.publish.card.fields)).toEqual(Object.keys(en.publish.card.fields));
    expect(Object.keys(ko.publish.card.refused).sort()).toEqual(["declared_pii_withheld", "pii_declaration_unavailable", "redistribution_forbidden"]);
  });
});
